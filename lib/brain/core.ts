import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import { getTaxonomy } from "@/lib/taxonomy-server";
import { activeCategories, topicsOf, type Taxonomy } from "@/lib/taxonomy";
import { findObjects, signedPost } from "@/lib/ai/classify";

// Somente servidor. Cérebro da comunidade (privado, só admins), alimentado por
// um agente de IA do CRM DataCrazy no esquema de ida e volta dos outros:
//   ida:   POST AI_BRAIN_WEBHOOK_URL com um lote de atendimentos RESOLVIDOS (em
//          ordem de encerramento) e os itens parecidos que o cérebro já tem
//   volta: /api/ai/cerebro?key=… com, por atendimento, um item novo, a
//          confirmação de um item (frequência) ou a resposta nova de um item
// A informação muda com o tempo: um atendimento mais recente atualiza a
// resposta; a anterior fica no histórico. Um lote por vez, para a linha do
// tempo valer: cada retorno manda o próximo.

type Admin = ReturnType<typeof createAdminClient>;

const PER_BATCH = 15;
const MAX_MESSAGES = 30;
const MAX_TEXT = 900;
const MAX_EXISTING = 40;
/** Lote sem retorno há mais que isso: volta para a fila. */
const STALE_MS = 10 * 60 * 1000;
/** Categorias sem conhecimento reaproveitável (papo, elogio…). */
const SKIP_CATEGORIES = new Set(["comunidade"]);

export function brainConfigured(): boolean {
  return !!process.env.AI_BRAIN_WEBHOOK_URL && !!process.env.AI_WEBHOOK_SECRET;
}

/** Tira telefone, e-mail e link do texto que vai para a IA (o cérebro guarda conhecimento, não dado pessoal). */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[telefone]");
}

type TicketRow = {
  id: string;
  number: number;
  contact_id: string;
  subject: string | null;
  category: string | null;
  topic: string | null;
  resolved_by: string | null;
  resolution_message_id: string | null;
  ai_summary: string | null;
  close_note: string | null;
  closed_at: string;
};

type MessageRow = {
  id: string;
  ticket_id: string;
  sent_at: string;
  body: string | null;
  kind: string;
  from_me: boolean;
  author_id: string | null;
  contact_id: string | null;
  contact: { kind: string } | null;
};

export interface ExistingItem {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  topic: string | null;
  status: string;
  occurrences: number;
  last_seen_at: string;
  answer_changed_at: string;
}

function taxonomyForAgent(t: Taxonomy) {
  return activeCategories(t)
    .filter((c) => !SKIP_CATEGORIES.has(c.key))
    .map((c) => ({ category: c.key, label: c.label, topics: topicsOf(t, c.key).map((x) => ({ key: x.key, label: x.label })) }));
}

export interface BrainDispatch {
  sent: boolean;
  tickets: number;
  pending: number;
  reason?: string;
}

/** Atendimentos resolvidos que ainda faltam ler. */
async function pendingCount(db: Admin): Promise<number> {
  const { count } = await db
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("status", "closed")
    .eq("close_reason", "resolved")
    .not("resolved_by", "is", null)
    .is("brain_processed_at", null);
  return count ?? 0;
}

/** Manda o próximo lote de atendimentos resolvidos para o agente do cérebro (um lote por vez). */
export async function dispatchBrain(): Promise<BrainDispatch> {
  if (!brainConfigured()) return { sent: false, tickets: 0, pending: 0, reason: "falta AI_BRAIN_WEBHOOK_URL" };
  const db = createAdminClient();

  // Um lote por vez; o que ficou sem retorno volta para a fila.
  const { data: open } = await db.from("brain_requests").select("id, sent_at, ticket_ids").eq("status", "sent");
  for (const r of (open ?? []) as { id: string; sent_at: string; ticket_ids: string[] }[]) {
    if (Date.now() - Date.parse(r.sent_at) < STALE_MS) return { sent: false, tickets: 0, pending: await pendingCount(db), reason: "aguardando o lote anterior" };
    await db.from("brain_requests").update({ status: "failed", error: "sem retorno do agente em 10 min" }).eq("id", r.id);
    if (r.ticket_ids.length) await db.from("tickets").update({ brain_processed_at: null }).in("id", r.ticket_ids);
  }

  // Papo, elogio e afins não viram conhecimento: marcados como lidos.
  await db
    .from("tickets")
    .update({ brain_processed_at: new Date().toISOString() })
    .eq("status", "closed")
    .eq("close_reason", "resolved")
    .is("brain_processed_at", null)
    .in("category", [...SKIP_CATEGORIES]);

  const { data: rows } = await db
    .from("tickets")
    .select("id, number, contact_id, subject, category, topic, resolved_by, resolution_message_id, ai_summary, close_note, closed_at")
    .eq("status", "closed")
    .eq("close_reason", "resolved")
    .not("resolved_by", "is", null)
    .is("brain_processed_at", null)
    .order("closed_at", { ascending: true })
    .limit(PER_BATCH);
  const candidates = (rows ?? []) as TicketRow[];
  if (!candidates.length) return { sent: false, tickets: 0, pending: 0, reason: "nada para ler" };

  const { data: claimed } = await db
    .from("tickets")
    .update({ brain_processed_at: new Date().toISOString() })
    .in("id", candidates.map((t) => t.id))
    .is("brain_processed_at", null)
    .select("id");
  const mine = new Set(((claimed ?? []) as { id: string }[]).map((t) => t.id));
  const tickets = candidates.filter((t) => mine.has(t.id));
  if (!tickets.length) return { sent: false, tickets: 0, pending: await pendingCount(db), reason: "outro envio pegou o lote" };
  const ids = tickets.map((t) => t.id);

  const { data: msgRows } = await db
    .from("messages")
    .select("id, ticket_id, sent_at, body, kind, from_me, author_id, contact_id, contact:contacts!contact_id(kind)")
    .in("ticket_id", ids)
    .eq("is_note", false)
    .is("deleted_at", null)
    .order("sent_at", { ascending: true })
    .limit(PER_BATCH * MAX_MESSAGES * 2);
  const byTicket = new Map<string, MessageRow[]>();
  for (const m of (msgRows ?? []) as unknown as MessageRow[]) {
    const list = byTicket.get(m.ticket_id) ?? [];
    if (list.length < MAX_MESSAGES) list.push(m);
    byTicket.set(m.ticket_id, list);
  }

  // Itens que o cérebro já tem e parecem com cada atendimento.
  const existing = new Map<string, ExistingItem>();
  for (const t of tickets) {
    const first = byTicket.get(t.id)?.find((m) => m.contact_id === t.contact_id)?.body ?? "";
    const query = [t.subject, t.ai_summary, first].filter(Boolean).join(" ").slice(0, 600);
    if (!query.trim()) continue;
    const { data: found } = await db.rpc("brain_search", { p_query: query, p_category: null, p_limit: 4, p_include_drafts: true });
    for (const it of (found ?? []) as ExistingItem[]) if (existing.size < MAX_EXISTING) existing.set(it.id, it);
  }

  const { data: req, error } = await db.from("brain_requests").insert({ ticket_ids: ids }).select("id").single<{ id: string }>();
  if (error || !req) {
    await db.from("tickets").update({ brain_processed_at: null }).in("id", ids);
    return { sent: false, tickets: 0, pending: await pendingCount(db), reason: "não foi possível registrar o envio" };
  }

  const taxonomy = await getTaxonomy();
  const body = JSON.stringify({
    type: "cerebro",
    request_id: req.id,
    callback_url: `${await siteUrl()}/api/ai/cerebro?key=${encodeURIComponent(process.env.AI_WEBHOOK_SECRET!)}`,
    taxonomy: taxonomyForAgent(taxonomy),
    existing: [...existing.values()].map((i) => ({
      item_id: i.id,
      question: i.question,
      answer: i.answer,
      category: i.category,
      topic: i.topic,
      occurrences: i.occurrences,
      last_seen_at: i.last_seen_at,
      answer_changed_at: i.answer_changed_at,
    })),
    tickets: tickets.map((t) => ({
      ticket_id: t.id,
      resolved_at: t.closed_at,
      category: t.category,
      topic: t.topic,
      resolved_by: t.resolved_by,
      summary: t.ai_summary ? scrub(t.ai_summary) : null,
      messages: (byTicket.get(t.id) ?? [])
        .map((m) => {
          const team = m.from_me || !!m.author_id || m.contact?.kind === "team";
          const role = team ? "equipe" : m.contact_id === t.contact_id ? "lead" : "comunidade";
          const text = scrub(`${m.kind !== "text" ? "[mídia] " : ""}${(m.body ?? "").trim()}`).slice(0, MAX_TEXT);
          return { id: m.id, at: m.sent_at, role, text, resolved: m.id === t.resolution_message_id || undefined };
        })
        .filter((m) => m.text),
    })),
  });

  try {
    const res = await signedPost(process.env.AI_BRAIN_WEBHOOK_URL!, body);
    if (!res.ok) throw new Error(`agente respondeu ${res.status}`);
    const text = await res.text().catch(() => "");
    if (text.trim()) await handleBrainResult(text).catch(() => undefined);
    return { sent: true, tickets: tickets.length, pending: await pendingCount(db) };
  } catch (e) {
    await db.from("brain_requests").update({ status: "failed", error: e instanceof Error ? e.message : "falhou" }).eq("id", req.id);
    await db.from("tickets").update({ brain_processed_at: null }).in("id", ids);
    return { sent: false, tickets: 0, pending: await pendingCount(db), reason: e instanceof Error ? e.message : "falhou" };
  }
}

export type BrainOutcome =
  | { ok: true; request_id: string; created: number; confirmed: number; updated: number; skipped: number; errors: string[] }
  | { ok: false; request_id?: string; error: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Processa o retorno do agente do cérebro. */
export async function handleBrainResult(raw: unknown): Promise<BrainOutcome[]> {
  const found = findObjects(raw, (o) => "request_id" in o && Array.isArray(o.items));
  if (!found.length) return [{ ok: false, error: "nenhum resultado no corpo (esperado: request_id e items)" }];
  const db = createAdminClient();
  const taxonomy = await getTaxonomy();
  const categories = new Set(activeCategories(taxonomy).map((c) => c.key));
  const out: BrainOutcome[] = [];

  for (const obj of found) {
    const requestId = str(obj.request_id, 64);
    if (!UUID.test(requestId)) {
      out.push({ ok: false, error: "request_id inválido" });
      continue;
    }
    const { data: req } = await db
      .from("brain_requests")
      .update({ status: "done", received_at: new Date().toISOString(), response: obj })
      .eq("id", requestId)
      .neq("status", "done")
      .select("id, ticket_ids")
      .maybeSingle<{ id: string; ticket_ids: string[] }>();
    if (!req) {
      out.push({ ok: false, request_id: requestId, error: "envio não encontrado ou já processado" });
      continue;
    }

    const { data: tks } = await db.from("tickets").select("id, closed_at").in("id", req.ticket_ids);
    const closedAt = new Map(((tks ?? []) as { id: string; closed_at: string }[]).map((t) => [t.id, t.closed_at]));
    const res = { created: 0, confirmed: 0, updated: 0, skipped: 0, errors: [] as string[] };

    for (const entry of (obj.items as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === "object")) {
      const ticketId = str(entry.ticket_id, 64);
      const seenAt = closedAt.get(ticketId);
      if (!seenAt) {
        res.errors.push(`atendimento fora do lote: ${ticketId || "?"}`);
        continue;
      }
      const action = str(entry.action, 10).toLowerCase();
      const question = str(entry.question, 500);
      const answer = str(entry.answer, 4000);
      let confidence = Number(entry.confidence);
      if (Number.isFinite(confidence) && confidence > 1) confidence /= 100;
      confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5;

      try {
        if (action === "skip") res.skipped++;
        else if (action === "new") {
          if (question.length < 3 || answer.length < 3) throw new Error("item sem pergunta ou resposta");
          const category = categories.has(str(entry.category, 40)) ? str(entry.category, 40) : null;
          const { data: item, error } = await db
            .from("brain_items")
            .insert({
              question,
              answer,
              category,
              topic: category ? str(entry.topic, 40) || null : null,
              confidence,
              first_seen_at: seenAt,
              last_seen_at: seenAt,
              answer_changed_at: seenAt,
            })
            .select("id")
            .single<{ id: string }>();
          if (error || !item) throw new Error(error?.message ?? "falhou");
          await db.from("brain_sources").insert({ item_id: item.id, ticket_id: ticketId, seen_at: seenAt, action: "new", answer });
          res.created++;
        } else if (action === "same" || action === "update") {
          const itemId = str(entry.item_id, 64);
          if (!UUID.test(itemId)) throw new Error("item_id inválido");
          const kind = await applyToExisting(db, itemId, ticketId, seenAt, action === "update" ? answer : "");
          if (kind === "updated") res.updated++;
          else res.confirmed++;
        } else throw new Error(`ação desconhecida: ${action || "?"}`);
      } catch (e) {
        res.errors.push(`${ticketId}: ${e instanceof Error ? e.message : "falhou"}`);
      }
    }

    await db
      .from("brain_requests")
      .update({ created: res.created, confirmed: res.confirmed, updated: res.updated, skipped: res.skipped, error: res.errors.join("; ").slice(0, 500) || null })
      .eq("id", req.id);
    out.push({ ok: true, request_id: req.id, ...res });
  }
  return out;
}

/**
 * Atendimento que confirma (same) ou muda (update) um item existente. A
 * resposta só muda se o atendimento for mais novo que a resposta atual; em um
 * item revisado pelo admin, a resposta nova fica como sugestão.
 */
async function applyToExisting(db: Admin, itemId: string, ticketId: string, seenAt: string, newAnswer: string): Promise<"confirmed" | "updated"> {
  const { data: item } = await db
    .from("brain_items")
    .select("id, answer, status, edited, occurrences, last_seen_at, answer_changed_at")
    .eq("id", itemId)
    .maybeSingle<{ id: string; answer: string; status: string; edited: boolean; occurrences: number; last_seen_at: string; answer_changed_at: string }>();
  if (!item) throw new Error("item não encontrado");

  const changes = newAnswer.length >= 3 && newAnswer !== item.answer && Date.parse(seenAt) >= Date.parse(item.answer_changed_at);
  const { error: srcError } = await db
    .from("brain_sources")
    .insert({ item_id: item.id, ticket_id: ticketId, seen_at: seenAt, action: changes ? "update" : "same", answer: newAnswer || null });
  // Mesmo atendimento já contado neste item: nada muda.
  if (srcError) return "confirmed";

  const patch: Record<string, unknown> = {
    occurrences: item.occurrences + 1,
    last_seen_at: Date.parse(seenAt) > Date.parse(item.last_seen_at) ? seenAt : item.last_seen_at,
    updated_at: new Date().toISOString(),
  };
  if (changes) {
    if (item.status === "approved" || item.edited) {
      Object.assign(patch, { proposed_answer: newAnswer, proposed_at: seenAt, proposed_ticket_id: ticketId });
    } else {
      await db.from("brain_item_versions").insert({ item_id: item.id, answer: item.answer, valid_until: seenAt, ticket_id: ticketId });
      Object.assign(patch, { answer: newAnswer, answer_changed_at: seenAt });
    }
  }
  await db.from("brain_items").update(patch).eq("id", item.id);
  return changes ? "updated" : "confirmed";
}
