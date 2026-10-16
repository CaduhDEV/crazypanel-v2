"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { findGleapSessionsByPhone, gleapConfigured } from "@/lib/gleap";
import { importAllGleapLeads, syncRecentGleapLeads, type GleapSyncResult } from "@/lib/gleap-sync";

const BATCH = 25;
const CONCURRENCY = 5;

type Admin = ReturnType<typeof createAdminClient>;

const scanSchema = z.object({
  /** Também reconsulta quem já deu "não encontrado"/"ambíguo". */
  retry: z.boolean().default(false),
  /** Início da varredura (ISO): no retry, quem foi consultado depois disso já passou. */
  since: z.iso.datetime(),
});

export interface GleapScanResult {
  processed: number;
  linked: number;
  ambiguous: number;
  notFound: number;
  failed: number;
  remaining: number;
}

type Candidate = { id: string; phone: string; name: string | null; email: string | null };

/**
 * Processa um lote de contatos sem empresa (com telefone) no Gleap. O cliente
 * chama em sequência até `remaining` zerar. Vincula só quando o telefone leva
 * a exatamente 1 empresa; com várias, fica para o admin decidir.
 */
export async function scanGleapBatch(input: z.input<typeof scanSchema>): Promise<ActionResult<GleapScanResult>> {
  return runAction(scanSchema, input, async ({ retry, since }) => {
    const admin = await requireAdmin();
    if (!gleapConfigured()) throw new ActionError("Defina GLEAP_API_TOKEN no .env.local para usar o Gleap.");
    const db = createAdminClient();

    // Cada contato consultado recebe gleap_checked_at = agora (> since) e sai da fila.
    const pending = (head = false) => {
      const q = db
        .from("contacts")
        .select("id, phone, name, email", { count: "exact", head })
        .is("company_id", null)
        .not("phone", "is", null);
      return retry
        ? q.or("gleap_status.is.null,gleap_status.neq.linked").or(`gleap_checked_at.is.null,gleap_checked_at.lt.${since}`)
        : q.is("gleap_checked_at", null);
    };

    const { data: batch, error } = await pending()
      .order("gleap_checked_at", { ascending: true, nullsFirst: true })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(BATCH);
    if (error) throw error;

    const result: GleapScanResult = { processed: 0, linked: 0, ambiguous: 0, notFound: 0, failed: 0, remaining: 0 };
    const rows = (batch ?? []) as Candidate[];

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      await Promise.all(rows.slice(i, i + CONCURRENCY).map((c) => scanOne(db, admin.id, c, result)));
    }

    const { count } = await pending(true);
    // Falhas (rede/API) não são marcadas; se o lote todo falhou, para o laço do cliente.
    result.remaining = rows.length > 0 && result.failed === rows.length ? 0 : (count ?? 0);

    if (result.linked) revalidatePath("/leads");
    return result;
  });
}

async function scanOne(db: Admin, adminId: string, c: Candidate, result: GleapScanResult) {
  const now = new Date().toISOString();
  let sessions;
  try {
    sessions = await findGleapSessionsByPhone(c.phone);
  } catch (e) {
    console.error(`[gleap] contato ${c.id}:`, e);
    result.failed += 1;
    return;
  }
  result.processed += 1;

  const withCompany = sessions.filter((s) => s.companyId);
  const companyIds = [...new Set(withCompany.map((s) => s.companyId!))];
  const emails = [...new Set(sessions.map((s) => s.email).filter(Boolean))] as string[];
  // E-mail só é gravado quando não há dúvida de qual é.
  const email = c.email ?? (emails.length === 1 ? emails[0] : null);

  if (companyIds.length !== 1) {
    const status = companyIds.length > 1 ? "ambiguous" : "not_found";
    if (status === "ambiguous") result.ambiguous += 1;
    else result.notFound += 1;
    await db
      .from("contacts")
      .update({ email, gleap_session_id: sessions.length === 1 ? sessions[0].id : null, gleap_status: status, gleap_checked_at: now })
      .eq("id", c.id);
    return;
  }

  const session = withCompany.find((s) => s.email === email) ?? withCompany[0];
  try {
    const companyId = await upsertCompany(db, adminId, companyIds[0], session.companyName);
    const { error } = await db
      .from("contacts")
      .update({
        company_id: companyId,
        email: email ?? session.email,
        name: c.name ?? session.name,
        gleap_session_id: session.id,
        gleap_status: "linked",
        gleap_checked_at: now,
        linked_at: now,
        linked_by: adminId,
      })
      .eq("id", c.id)
      .is("company_id", null); // não sobrescreve um vínculo feito à mão no meio da varredura
    if (error) throw error;
    result.linked += 1;
  } catch (e) {
    console.error(`[gleap] vínculo do contato ${c.id}:`, e);
    result.processed -= 1;
    result.failed += 1;
  }
}

/** Empresa pelo tenant id do CRM (external_id); cria se não existir. */
async function upsertCompany(db: Admin, adminId: string, tenantId: string, name: string | null): Promise<string> {
  const { data: existing } = await db.from("companies").select("id").eq("external_id", tenantId).maybeSingle();
  if (existing) return existing.id as string;

  const { error } = await db
    .from("companies")
    .upsert({ external_id: tenantId, name: name || tenantId, created_by: adminId }, { onConflict: "external_id", ignoreDuplicates: true });
  if (error) throw error;
  // Relê: com ignoreDuplicates, outra execução pode ter criado no meio tempo.
  const { data, error: readError } = await db.from("companies").select("id").eq("external_id", tenantId).single();
  if (readError) throw readError;
  return data.id as string;
}

/** Quantos contatos sem empresa ainda não foram consultados (para o botão). */
export async function gleapPendingCount(): Promise<ActionResult<{ pending: number; configured: boolean }>> {
  return runAction(z.object({}), {}, async () => {
    await requireAdmin();
    const { count } = await createAdminClient()
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .not("phone", "is", null)
      .is("gleap_checked_at", null);
    return { pending: count ?? 0, configured: gleapConfigured() };
  });
}

// =============================================================================
// Base do Gleap (lista de convites)
// =============================================================================
/** Importa a base inteira do Gleap e vincula os contatos dos grupos. */
export async function importAllFromGleap(): Promise<ActionResult<GleapSyncResult>> {
  return runAction(z.object({}), {}, async () => {
    const admin = await requireAdmin();
    if (!gleapConfigured()) throw new ActionError("Defina GLEAP_API_TOKEN no .env.local para usar o Gleap.");
    const result = await importAllGleapLeads(admin.id);
    revalidatePath("/convites");
    revalidatePath("/leads");
    return result;
  });
}

/** Puxa as sessões mais recentes (o mesmo que a rotina diária faz). */
export async function syncRecentFromGleap(): Promise<ActionResult<GleapSyncResult>> {
  return runAction(z.object({}), {}, async () => {
    const admin = await requireAdmin();
    if (!gleapConfigured()) throw new ActionError("Defina GLEAP_API_TOKEN no .env.local para usar o Gleap.");
    const result = await syncRecentGleapLeads(admin.id);
    revalidatePath("/convites");
    revalidatePath("/leads");
    return result;
  });
}
