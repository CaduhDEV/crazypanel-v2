import { createAdminClient } from "@/lib/supabase/admin";
import { clientFromRow, getInstanceRow } from "@/lib/uazapi/instance";
import { splitIdentity, UazapiError } from "@/lib/uazapi/client";
import { phoneKey } from "@/lib/gleap";
import { communityGroups, logCommunityEvent, triageJoinRequest } from "@/lib/community/core";

// Somente servidor. A uazapi não manda evento quando alguém pede para entrar num
// grupo com aprovação: os pedidos são lidos em /group/info (getRequestsParticipants).

export const JOIN_SYNC_MIN_INTERVAL_MS = 60_000;

export interface JoinSyncResult {
  skipped: boolean;
  created: number;
  expired: number;
  /** Grupos em que a conta não conseguiu ler os pedidos (não é admin, por exemplo). */
  unreadable: string[];
  /** WhatsApp fora do ar: nada foi lido (a tela mostra um aviso, não um erro). */
  unavailable?: "not_configured" | "disconnected" | "unreachable";
}

const splitList = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export async function syncWhatsAppJoinRequests(opts: { ifOlderThanMs?: number } = {}): Promise<JoinSyncResult> {
  const db = createAdminClient();
  const result: JoinSyncResult = { skipped: false, created: 0, expired: 0, unreadable: [] };

  if (opts.ifOlderThanMs) {
    const { data } = await db.from("whatsapp_instance").select("join_requests_synced_at").eq("id", 1).maybeSingle();
    const last = data?.join_requests_synced_at ? Date.parse(data.join_requests_synced_at as string) : 0;
    if (Date.now() - last < opts.ifOlderThanMs) return { ...result, skipped: true };
  }
  await db.from("whatsapp_instance").update({ join_requests_synced_at: new Date().toISOString() }).eq("id", 1);

  const row = await getInstanceRow();
  if (!row.base_url || !row.token_encrypted) return { ...result, unavailable: "not_configured" };
  if (row.status !== "connected") return { ...result, unavailable: "disconnected" };
  const uaz = clientFromRow(row);
  for (const group of await communityGroups(db)) {
    let info;
    try {
      info = await uaz.groupInfo(group.jid, { getRequestsParticipants: true });
    } catch (e) {
      // Token inválido, instância fora do ar ou sem rede: para tudo (os outros grupos falhariam igual).
      if (!(e instanceof UazapiError) || e.status === 0 || e.status === 401 || e.status >= 500) {
        return { ...result, unavailable: "unreachable" };
      }
      result.unreadable.push(group.name);
      continue;
    }
    // Campo ausente = sem permissão de admin para ler os pedidos (não dá para expirar nada).
    if (info.request_participants === undefined && info.request_participants_lid === undefined) {
      result.unreadable.push(group.name);
      continue;
    }

    const jids = splitList(info.request_participants);
    const lids = splitList(info.request_participants_lid);
    const people = Array.from({ length: Math.max(jids.length, lids.length) }, (_, i) => splitIdentity(jids[i], lids[i]))
      .filter((p) => p.phone || p.lid);
    const seen = new Set(people.map((p) => (p.phone ? phoneKey(p.phone) : null) ?? p.lid));

    const { data: pending } = await db
      .from("join_requests")
      .select("id, phone_key, lid, contact_id, phone, name")
      .eq("source", "whatsapp")
      .eq("group_jid", group.jid)
      .eq("status", "pending");
    const known = new Set((pending ?? []).map((r) => (r.phone_key as string | null) ?? (r.lid as string | null)));

    for (const p of people) {
      const key = (p.phone ? phoneKey(p.phone) : null) ?? p.lid;
      if (!key || known.has(key)) continue;
      const { data: created, error } = await db
        .from("join_requests")
        .insert({ source: "whatsapp", phone: p.phone, lid: p.lid, group_jid: group.jid })
        .select("id")
        .single();
      if (error || !created) continue; // índice único: outra leitura criou ao mesmo tempo
      result.created += 1;
      await logCommunityEvent(db, { type: "request_created", request_id: created.id as string, group_jid: group.jid, phone: p.phone, data: { source: "whatsapp", lid: p.lid } });
      await triageJoinRequest(db, created.id as string);
    }

    // Sumiu da lista sem decisão no painel: alguém aprovou/recusou pelo celular, ou a pessoa desistiu.
    for (const r of pending ?? []) {
      const key = (r.phone_key as string | null) ?? (r.lid as string | null);
      if (key && seen.has(key)) continue;
      await db.from("join_requests").update({ status: "expired" }).eq("id", r.id).eq("status", "pending");
      result.expired += 1;
      await logCommunityEvent(db, {
        type: "request_expired",
        request_id: r.id as string,
        group_jid: group.jid,
        contact_id: r.contact_id as string | null,
        phone: r.phone as string | null,
        name: r.name as string | null,
      });
    }
  }
  return result;
}
