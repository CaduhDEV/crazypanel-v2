import type { createClient } from "@/lib/supabase/server";

// Admin → Mensagens: todas as mensagens dos grupos, com filtros pela URL.

export type MessagePeriod = "7" | "30" | "90" | "intervalo" | "tudo";
const PERIODS: MessagePeriod[] = ["7", "30", "90", "intervalo", "tudo"];

/** Tipos filtráveis (kind da mensagem) e a nota interna da equipe. */
export const MESSAGE_KINDS = [
  { value: "text", label: "Texto" },
  { value: "image", label: "Imagem" },
  { value: "audio", label: "Áudio" },
  { value: "video", label: "Vídeo" },
  { value: "document", label: "Documento" },
  { value: "sticker", label: "Figurinha" },
  { value: "location", label: "Localização" },
  { value: "contact", label: "Contato" },
  { value: "poll", label: "Enquete" },
  { value: "other", label: "Outro" },
  { value: "nota", label: "Nota interna" },
] as const;

export interface MessageFilters {
  q: string;
  period: MessagePeriod;
  from: string; // AAAA-MM-DD (período "intervalo")
  to: string;
  category: string;
  topic: string;
  kind: string;
  group: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-z0-9_]{2,40}$/;

export function parseMessageFilters(p: Record<string, string | undefined | null>): MessageFilters {
  // Chaves de categoria/subcategoria (tabelas): uma desconhecida só não acha nada.
  const category = KEY_RE.test(p.categoria ?? "") ? p.categoria! : "";
  const topic = category && KEY_RE.test(p.subcategoria ?? "") ? p.subcategoria! : "";
  return {
    q: p.q?.trim().slice(0, 80) ?? "",
    period: (PERIODS.includes(p.periodo as MessagePeriod) ? p.periodo : "30") as MessagePeriod,
    from: DATE_RE.test(p.de ?? "") ? p.de! : "",
    to: DATE_RE.test(p.ate ?? "") ? p.ate! : "",
    category,
    topic,
    kind: MESSAGE_KINDS.some((k) => k.value === p.tipo) ? p.tipo! : "",
    group: p.grupo?.endsWith("@g.us") ? p.grupo : "",
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

// messages ↔ tickets tem duas ligações (ticket_id e resolution_message_id): a chave diz qual.
const TICKET_EMBED = "tickets!messages_ticket_id_fkey";

export const MESSAGE_COLUMNS =
  "id, wa_id, group_jid, ticket_id, contact_id, author_id, from_me, is_note, sender_name, kind, body, media_path, media_store, media_name, media_mime, media_size, media_duration, media_status, quoted_wa_id, status, edited_at, deleted_at, sent_at, legacy_id, category, topic, category_source, " +
  "contact:contacts!contact_id(id, name, phone, lid, kind, avatar_url, company:companies(name)), group:wa_groups(name)";

/**
 * Uma página de mensagens. A busca por nome ou telefone do contato resolve os
 * contatos antes (o filtro em tabela relacionada não entra no "ou"); a categoria
 * é a da própria mensagem (a do atendimento ou, fora dele, por regras).
 */
export async function fetchMessages(supabase: Supabase, f: MessageFilters, range: [number, number], opts: { count?: boolean } = {}) {
  const ticket = `ticket:${TICKET_EMBED}(number, category, topic, status)`;
  let query = supabase.from("messages").select(`${MESSAGE_COLUMNS}, ${ticket}`, opts.count ? { count: "exact" } : undefined);

  if (f.period === "intervalo") {
    // Datas no fuso de Brasília (o dia inteiro do "até").
    if (f.from) query = query.gte("sent_at", `${f.from}T00:00:00-03:00`);
    if (f.to) query = query.lte("sent_at", `${f.to}T23:59:59.999-03:00`);
  } else if (f.period !== "tudo") {
    query = query.gte("sent_at", new Date(Date.now() - Number(f.period) * 86_400_000).toISOString());
  }
  if (f.group) query = query.eq("group_jid", f.group);
  if (f.kind === "nota") query = query.eq("is_note", true);
  else if (f.kind) query = query.eq("kind", f.kind).eq("is_note", false);
  if (f.category) query = query.eq("category", f.category);
  if (f.topic) query = query.eq("topic", f.topic);

  if (f.q) {
    const term = f.q.replace(/[%,()*]/g, " ").trim();
    const digits = f.q.replace(/\D/g, "");
    const byName = supabase.from("contacts").select("id").ilike("name", `%${term}%`).limit(300);
    const byPhone = digits.length >= 4 ? supabase.from("contacts").select("id").or(`phone.like.%${digits}%,lid.like.%${digits}%`).limit(300) : null;
    const [names, phones] = await Promise.all([byName, byPhone]);
    const ids = [...new Set([...(names.data ?? []), ...(phones?.data ?? [])].map((c) => c.id as string))];
    query = query.or(
      [`body.ilike.%${term}%`, `sender_name.ilike.%${term}%`, ids.length && `contact_id.in.(${ids.join(",")})`].filter(Boolean).join(","),
    );
  }

  return query.order("sent_at", { ascending: false }).order("id", { ascending: false }).range(range[0], range[1]);
}
