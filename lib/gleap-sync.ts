import { createAdminClient } from "@/lib/supabase/admin";
import { exportAllGleapLeads, listActiveGleapTickets, listRecentGleapLeads, type GleapLeadRow } from "@/lib/gleap";

// Somente servidor. Grava os leads do Gleap em gleap_leads e vincula os
// contatos dos grupos cujo telefone leva a um único tenant.

const CHUNK = 1000;
export const RECENT_COUNT = 500;

export interface GleapSyncResult {
  rows: number;
  linked: number;
}

/** Uma linha por usuário: fica a sessão mais recente, completando campos vazios com as outras. */
function dedupe(rows: GleapLeadRow[]): GleapLeadRow[] {
  const byUser = new Map<string, GleapLeadRow>();
  const time = (r: GleapLeadRow) => (r.last_activity_at ? Date.parse(r.last_activity_at) : 0);
  for (const r of rows) {
    const prev = byUser.get(r.user_id);
    if (!prev) {
      byUser.set(r.user_id, r);
      continue;
    }
    const [newer, older] = time(r) >= time(prev) ? [r, prev] : [prev, r];
    byUser.set(r.user_id, {
      ...newer,
      name: newer.name ?? older.name,
      email: newer.email ?? older.email,
      phone: newer.phone ?? older.phone,
      company_tenant_id: newer.company_tenant_id ?? older.company_tenant_id,
      company_name: newer.company_name ?? older.company_name,
      gleap_created_at: older.gleap_created_at ?? newer.gleap_created_at,
    });
  }
  return [...byUser.values()];
}

async function store(rows: GleapLeadRow[], actorId: string | null): Promise<GleapSyncResult> {
  const db = createAdminClient();
  const unique = dedupe(rows);
  const now = new Date().toISOString();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { error } = await db
      .from("gleap_leads")
      .upsert(unique.slice(i, i + CHUNK).map((r) => ({ ...r, synced_at: now })), { onConflict: "user_id" });
    if (error) throw new Error(`gravar leads do Gleap: ${error.message}`);
  }
  const { data: linked, error } = await db.rpc("link_contacts_from_gleap", { p_actor_id: actorId });
  if (error) throw new Error(`vincular contatos: ${error.message}`);
  // Quantas empresas cada lead tem (etiqueta "N empresas" em Leads).
  await db.rpc("refresh_contact_companies_count", {});
  // E-mail da DataCrazy no Gleap: o lead com o mesmo telefone vira equipe.
  await db.rpc("mark_team_by_email");
  return { rows: unique.length, linked: (linked as number) ?? 0 };
}

async function recordState(patch: Record<string, unknown>) {
  await createAdminClient()
    .from("gleap_sync_state")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

/** Importa a base inteira (export CSV do Gleap). */
export async function importAllGleapLeads(actorId: string | null): Promise<GleapSyncResult> {
  try {
    const result = await store(await exportAllGleapLeads(), actorId);
    await recordState({ last_full_import_at: new Date().toISOString(), last_full_import_rows: result.rows, last_error: null });
    return result;
  } catch (e) {
    await recordState({ last_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Atualiza com as sessões criadas mais recentemente (rotina diária). */
export async function syncRecentGleapLeads(actorId: string | null, count = RECENT_COUNT): Promise<GleapSyncResult> {
  try {
    const result = await store(await listRecentGleapLeads(count), actorId);
    await recordState({ last_recent_sync_at: new Date().toISOString(), last_recent_sync_rows: result.rows, last_error: null });
    return result;
  } catch (e) {
    await recordState({ last_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

// =============================================================================
// Chamados ativos do Gleap
// =============================================================================
export const TICKETS_MIN_INTERVAL_MS = 60_000;

/**
 * Substitui a cópia local dos chamados ativos. Com `ifOlderThanMs`, não faz
 * nada se a última sincronização for mais recente (botão na tela).
 */
export async function syncGleapTickets(opts: { ifOlderThanMs?: number } = {}): Promise<{ rows: number; skipped: boolean }> {
  const db = createAdminClient();
  if (opts.ifOlderThanMs) {
    const { data } = await db.from("gleap_sync_state").select("last_tickets_sync_at").eq("id", 1).maybeSingle();
    const last = data?.last_tickets_sync_at ? Date.parse(data.last_tickets_sync_at as string) : 0;
    if (Date.now() - last < opts.ifOlderThanMs) return { rows: 0, skipped: true };
  }

  try {
    const byId = new Map((await listActiveGleapTickets()).map((t) => [t.id, t]));
    const rows = [...byId.values()];
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db
        .from("gleap_tickets")
        .upsert(rows.slice(i, i + CHUNK).map((r) => ({ ...r, synced_at: now })), { onConflict: "id" });
      if (error) throw new Error(`gravar tickets do Gleap: ${error.message}`);
    }
    // O que não veio mais está finalizado no Gleap.
    const { error } = await db.from("gleap_tickets").delete().lt("synced_at", now);
    if (error) throw new Error(`limpar tickets do Gleap: ${error.message}`);

    await recordState({ last_tickets_sync_at: now, last_tickets_sync_rows: rows.length, last_error: null });
    return { rows: rows.length, skipped: false };
  } catch (e) {
    await recordState({ last_error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
