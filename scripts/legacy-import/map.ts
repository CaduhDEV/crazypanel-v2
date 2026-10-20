// Mapeamento do sistema antigo (groups) para o modelo do painel.

export interface OldMessage {
  id: number;
  group_id: string;
  number: string | null;
  sender: string | null;
  sender_jid: string | null;
  name: string | null;
  content: string | null;
  type: string | null;
  created_at: string;
  attendance_id: string | null;
  category: string | null;
  id_message: string | null;
  quoted_message_id: string | null;
}

export interface OldAttendance {
  id: string;
  group_id: string;
  lead_number: string;
  started_at: string;
  last_message_at: string;
  ended_at: string | null;
  status: "open" | "closed";
  finished_by: string | null;
  finished_note: string | null;
  finished_reason: string | null;
  title: string | null;
  avg_response_seconds: number | null;
}

export interface OldReply {
  id: string;
  attendance_id: string;
  text: string | null;
  author: string | null;
  status: string | null;
  created_at: string;
  is_internal: boolean;
  wa_message_id: string | null;
}

export const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** 14+ dígitos é LID (o WhatsApp não tem telefone tão longo); 8–13 é telefone. */
export const isLid = (d: string) => d.length >= 14;
export const isPhone = (d: string) => d.length >= 8 && d.length <= 13;

export interface Identity {
  phone: string | null;
  lid: string | null;
}

/** Telefone e LID de uma mensagem antiga: `number` costuma ser o telefone e `sender` o LID. */
export function identityOf(m: Pick<OldMessage, "number" | "sender" | "sender_jid">): Identity | null {
  const cands = [digits(m.number), digits(m.sender)].filter(Boolean);
  if (m.sender_jid?.endsWith("@lid")) cands.push(digits(m.sender_jid));
  const phone = cands.find(isPhone) ?? null;
  const lid = cands.find(isLid) ?? null;
  return phone || lid ? { phone, lid } : null;
}

export function identityOfNumber(n: string | null | undefined): Identity | null {
  const d = digits(n);
  if (!d) return null;
  return isLid(d) ? { phone: null, lid: d } : isPhone(d) ? { phone: d, lid: null } : null;
}

export const identityKey = (i: Identity) => `${i.phone ?? ""}|${i.lid ?? ""}`;

/** O número antigo (lead_number, telefone ou LID) aparece nesta mensagem? */
export function sameIdentity(a: Identity, b: Identity) {
  return (!!a.phone && a.phone === b.phone) || (!!a.lid && a.lid === b.lid);
}

const CAPTION_PREFIX: Record<string, string> = { imageMessage: "📷", videoMessage: "🎥", documentMessage: "📄" };
const TEXT_TYPES = new Set(["conversation", "text", "extendedTextMessage"]);

export type SkipReason = "reação" | "figurinha" | "áudio" | "mídia sem legenda" | "texto vazio" | "tipo desconhecido";

/** Corpo da mensagem no painel, ou o motivo de ficar de fora. */
export function bodyOf(m: Pick<OldMessage, "type" | "content">): { body: string } | { skip: SkipReason } {
  const type = m.type ?? "";
  const text = m.content?.trim() ? m.content : null;
  if (TEXT_TYPES.has(type)) return text ? { body: text } : { skip: "texto vazio" };
  if (type in CAPTION_PREFIX) return text ? { body: `${CAPTION_PREFIX[type]} ${text}` } : { skip: "mídia sem legenda" };
  if (type === "reactionMessage") return { skip: "reação" };
  if (type === "stickerMessage") return { skip: "figurinha" };
  if (type === "audioMessage" || type === "ptvMessage") return { skip: "áudio" };
  return { skip: "tipo desconhecido" };
}

export const waIdOf = (m: Pick<OldMessage, "id" | "id_message">) => m.id_message?.trim() || `legacy:${m.id}`;
export const replyWaIdOf = (r: Pick<OldReply, "id" | "wa_message_id">) => r.wa_message_id?.trim() || `legacy-reply:${r.id}`;

export const REPLY_STATUS: Record<string, "sent" | "delivered" | "failed"> = { delivered: "delivered", failed: "failed", pending: "sent" };

/** Nome sem acento, minúsculo, "_" vira espaço. */
export const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** finished_reason antigo → close_reason do painel. */
export function closeReasonOf(a: OldAttendance): "resolved" | "parallel" | "sla_cleared" {
  if (a.status === "open") return "sla_cleared";
  if (a.finished_reason === "parallel") return "parallel";
  if (a.finished_reason === "sla_cleared") return "sla_cleared";
  return "resolved"; // attendant ou sem motivo (anterior ao campo)
}

export const preview = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
