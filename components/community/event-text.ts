import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPhone } from "@/lib/utils";

/** Linha do log da comunidade (solicitações e entradas/saídas). */
export interface CommunityEventRow {
  id: number;
  type: string;
  group_jid: string | null;
  phone: string | null;
  name: string | null;
  actor_phone: string | null;
  actor_name: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  group?: { name: string | null } | null;
  actor?: { name: string | null } | null;
}

/** Colunas do log; o grupo não tem chave estrangeira (pode já ter saído do painel), então o nome vem à parte por withGroupNames. */
export const COMMUNITY_EVENT_SELECT = "*, actor:profiles(name)";

/** Completa o nome do grupo de cada evento. */
export async function withGroupNames<T extends { group_jid: string | null }>(db: SupabaseClient, rows: T[]): Promise<(T & { group: { name: string | null } | null })[]> {
  const jids = [...new Set(rows.map((r) => r.group_jid).filter((j): j is string => !!j))];
  const { data } = jids.length ? await db.from("wa_groups").select("jid, name").in("jid", jids) : { data: [] };
  const names = new Map(((data ?? []) as { jid: string; name: string | null }[]).map((g) => [g.jid, g.name]));
  return rows.map((r) => ({ ...r, group: r.group_jid ? { name: names.get(r.group_jid) ?? null } : null }));
}

const PV_KIND: Record<string, string> = {
  no_company: "empresa não encontrada",
  rejected: "recusa",
  accepted: "boas-vindas",
  invite_link: "link do grupo",
};

export function communityEventText(e: CommunityEventRow): string {
  const who = e.name || (e.phone ? formatPhone(e.phone) : "Alguém");
  const group = e.group?.name ? ` em ${e.group.name}` : "";
  const panel = e.actor?.name ?? "um admin";
  const waActor = e.actor_name || (e.actor_phone ? formatPhone(e.actor_phone) : "alguém");
  const d = e.data ?? {};
  switch (e.type) {
    case "request_created":
      return `${who} pediu para entrar${d.source === "whatsapp" ? `${group} pelo WhatsApp` : " pelo formulário"}`;
    case "request_accepted":
      return `${panel} aceitou ${who}`;
    case "request_rejected":
      return `${panel} recusou ${who}`;
    case "request_expired":
      return `O pedido de ${who}${group} foi resolvido pelo celular`;
    case "invite_sent":
      return `Privacidade bloqueou a adição: convite enviado no privado de ${who}${group}`;
    case "add_failed":
      return `Falha ao adicionar ${who}${group}`;
    case "approve_failed":
      return `Falha ao ${d.action === "reject" ? "recusar" : "aprovar"} ${who} no WhatsApp${group}`;
    case "added_by_admin":
      return `${waActor} adicionou ${who}${group}`;
    case "invited_by_member":
      return `${waActor} convidou ${who}${group}`;
    case "joined_via_link":
      return `${who} entrou${group}`;
    case "left":
      return `${who} saiu${group}`;
    case "removed":
      return `${waActor} removeu ${who}${group}`;
    case "pv_sent":
      return `Mensagem de ${PV_KIND[String(d.kind)] ?? "aviso"} enviada no privado`;
    case "pv_failed":
      return `Falha ao enviar a mensagem de ${PV_KIND[String(d.kind)] ?? "aviso"} no privado`;
    default:
      return e.type;
  }
}
