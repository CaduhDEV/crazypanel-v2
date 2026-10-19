import type { createClient } from "@/lib/supabase/server";
import { TICKET_CATEGORIES } from "@/lib/types";

// Histórico de atendimentos: filtros da tela (via URL) e a consulta.

export type HistoryStatus = "todos" | "abertos" | "finalizados";
const STATUSES: HistoryStatus[] = ["todos", "abertos", "finalizados"];

export interface HistoryFilters {
  q: string;
  status: HistoryStatus;
  group: string;
  assignee: string; // uuid, "sem" (sem responsável) ou ""
  category: string;
  from: string; // AAAA-MM-DD
  to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export function parseHistoryFilters(p: Record<string, string | undefined | null>): HistoryFilters {
  const category = p.categoria ?? "";
  return {
    q: p.q?.trim().slice(0, 80) ?? "",
    status: (STATUSES.includes(p.status as HistoryStatus) ? p.status : "todos") as HistoryStatus,
    group: p.grupo?.endsWith("@g.us") ? p.grupo : "",
    assignee: p.responsavel === "sem" || UUID_RE.test(p.responsavel ?? "") ? p.responsavel! : "",
    category: TICKET_CATEGORIES.some((c) => c.value === category) ? category : "",
    from: DATE_RE.test(p.de ?? "") ? p.de! : "",
    to: DATE_RE.test(p.ate ?? "") ? p.ate! : "",
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const HISTORY_COLUMNS =
  "id, number, status, subject, group_jid, contact_id, assignee_id, category, topic, close_reason, opened_at, closed_at, first_response_at, message_count, contact:contacts!contact_id(id, name, phone, lid, kind, avatar_url, company:companies(name)), group:wa_groups(name)";

/**
 * Busca uma página de atendimentos com os filtros. A busca por nome do lead
 * resolve os contatos antes (o filtro em tabela relacionada não combina com o
 * "ou"). Devolve o resultado já executado: uma função async não pode devolver
 * o construtor da consulta, porque o await o executaria antes do range.
 */
export async function fetchHistory(supabase: Supabase, f: HistoryFilters, range: [number, number], opts: { count?: boolean } = {}) {
  let query = supabase.from("tickets").select(HISTORY_COLUMNS, opts.count ? { count: "exact" } : undefined);

  if (f.status === "abertos") query = query.eq("status", "open");
  if (f.status === "finalizados") query = query.eq("status", "closed");
  if (f.group) query = query.eq("group_jid", f.group);
  if (f.assignee === "sem") query = query.is("assignee_id", null);
  else if (f.assignee) query = query.eq("assignee_id", f.assignee);
  if (f.category) query = query.eq("category", f.category);
  // Datas no fuso de Brasília (o dia inteiro do "até").
  if (f.from) query = query.gte("opened_at", `${f.from}T00:00:00-03:00`);
  if (f.to) query = query.lte("opened_at", `${f.to}T23:59:59.999-03:00`);

  if (f.q) {
    const number = f.q.replace(/^#/, "");
    if (/^\d+$/.test(number)) {
      query = query.eq("number", Number(number));
    } else {
      const term = f.q.replace(/[%,()]/g, " ");
      const { data: people } = await supabase.from("contacts").select("id").ilike("name", `%${term}%`).limit(200);
      const ids = (people ?? []).map((p) => p.id as string);
      query = query.or([`subject.ilike.%${term}%`, ids.length && `contact_id.in.(${ids.join(",")})`].filter(Boolean).join(","));
    }
  }

  return query.order("opened_at", { ascending: false }).order("number", { ascending: false }).range(range[0], range[1]);
}
