import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { getTaxonomy } from "@/lib/taxonomy-server";
import { activeCategories, isActivePair, topicsOf, type Taxonomy } from "@/lib/taxonomy";
import type { AppSettings, ResolvedBy } from "@/lib/types";

// Somente servidor. Classificação dos atendimentos pelo agente de IA do CRM
// DataCrazy, por webhook de ida e volta:
//   ida:   POST AI_AGENT_WEBHOOK_URL (um atendimento por chamada), assinado com
//          X-CrazyPanel-Signature = sha256=HMAC(corpo, AI_WEBHOOK_SECRET)
//   volta: o agente chama o callback_url que vai no corpo (/api/ai/classificacoes?key=…)
// O retorno vira sugestão no atendimento e, quando é seguro, encerra.

type Admin = ReturnType<typeof createAdminClient>;

const MAX_MESSAGES = 40;
const MAX_TEXT = 1200;
const PER_RUN = 30;
const CONCURRENCY = 4;
/** Atendimento enviado há menos que isso e sem resposta não vai de novo. */
const RESEND_AFTER_MS = 30 * 60 * 1000;

export function aiConfigured(): boolean {
  return !!process.env.AI_AGENT_WEBHOOK_URL && !!process.env.AI_WEBHOOK_SECRET;
}

const KIND_LABEL: Record<string, string> = {
  image: "imagem",
  video: "vídeo",
  audio: "áudio",
  document: "documento",
  sticker: "figurinha",
  location: "localização",
  contact: "contato",
  poll: "enquete",
};

type TicketRow = {
  id: string;
  number: number;
  group_jid: string;
  contact_id: string;
  subject: string | null;
  opened_at: string;
  group: { name: string | null } | null;
};

type MessageRow = {
  sent_at: string;
  body: string | null;
  kind: string;
  from_me: boolean;
  author_id: string | null;
  contact_id: string | null;
  sender_name: string | null;
  contact: { name: string | null; kind: string } | null;
};

function taxonomyForAgent(t: Taxonomy) {
  return activeCategories(t).map((c) => ({
    category: c.key,
    label: c.label,
    topics: topicsOf(t, c.key).map((x) => ({ key: x.key, label: x.label })),
  }));
}

/** Corpo do webhook de ida para um atendimento. */
async function buildPayload(db: Admin, ticket: TicketRow, requestId: string, taxonomy: Taxonomy, callbackUrl: string) {
  const [{ data: rows }, { data: participants }] = await Promise.all([
    db
      .from("messages")
      .select("sent_at, body, kind, from_me, author_id, contact_id, sender_name, contact:contacts!contact_id(name, kind)")
      .eq("ticket_id", ticket.id)
      .eq("is_note", false)
      .is("deleted_at", null)
      .order("sent_at", { ascending: false })
      .limit(MAX_MESSAGES),
    db.from("ticket_participants").select("contact_id").eq("ticket_id", ticket.id).is("removed_at", null),
  ]);
  const leads = new Set([ticket.contact_id, ...((participants ?? []) as { contact_id: string }[]).map((p) => p.contact_id)]);

  const messages = ((rows ?? []) as unknown as MessageRow[])
    .reverse()
    .map((m) => {
      const team = m.from_me || !!m.author_id || m.contact?.kind === "team";
      const role = team ? "equipe" : m.contact_id && leads.has(m.contact_id) ? "lead" : "comunidade";
      const media = m.kind !== "text" ? `[${KIND_LABEL[m.kind] ?? "mídia"}] ` : "";
      const text = `${media}${(m.body ?? "").trim()}`.trim().slice(0, MAX_TEXT);
      return { at: m.sent_at, role, name: m.contact?.name ?? m.sender_name ?? null, text };
    })
    .filter((m) => m.text);

  return {
    request_id: requestId,
    callback_url: callbackUrl,
    ticket: {
      ticket_id: ticket.id,
      number: ticket.number,
      group: ticket.group?.name ?? null,
      opened_at: ticket.opened_at,
      subject: ticket.subject,
    },
    taxonomy: taxonomyForAgent(taxonomy),
    messages,
  };
}

async function postToAgent(body: string): Promise<{ ok: boolean; error?: string }> {
  const signature = createHmac("sha256", process.env.AI_WEBHOOK_SECRET!).update(body).digest("hex");
  try {
    const res = await fetch(process.env.AI_AGENT_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CrazyPanel-Signature": `sha256=${signature}` },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, error: `agente respondeu ${res.status}` };
    // Se o agente já devolver o resultado na mesma resposta, processa na hora.
    const text = await res.text().catch(() => "");
    if (text.trim()) await handleAgentResult(text).catch(() => undefined);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha ao chamar o agente" };
  }
}

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Manda para o agente os atendimentos abertos, sem responsável e parados (sem
 * mensagem há ai_idle_minutes) que ainda não foram classificados depois da
 * última mensagem.
 */
export async function dispatchIdleTickets(
  opts: {
    actorId?: string | null;
    /** Atendimentos escolhidos (teste): vão mesmo com responsável ou mensagem recente. */
    ticketIds?: string[];
    /** false: o retorno só deixa a sugestão, não encerra. */
    allowClose?: boolean;
  } = {},
): Promise<DispatchResult> {
  if (!aiConfigured()) throw new Error("Defina AI_AGENT_WEBHOOK_URL e AI_WEBHOOK_SECRET para usar o agente de IA.");
  const db = createAdminClient();
  const [settings, taxonomy, base] = await Promise.all([getSettings(), getTaxonomy(), siteUrl()]);
  const idleBefore = new Date(Date.now() - settings.ai_idle_minutes * 60_000).toISOString();

  let query = db
    .from("tickets")
    .select("id, number, group_jid, contact_id, subject, opened_at, last_message_at, ai_classified_at, group:wa_groups(name)")
    .eq("status", "open")
    .order("last_message_at", { ascending: true })
    .limit(PER_RUN * 3);
  query = opts.ticketIds?.length ? query.in("id", opts.ticketIds) : query.is("assignee_id", null).lt("last_message_at", idleBefore);
  const { data, error } = await query;
  if (error) throw error;

  // Já classificado depois da última mensagem: não manda de novo (o teste manda sempre).
  const candidates = ((data ?? []) as unknown as (TicketRow & { last_message_at: string; ai_classified_at: string | null })[]).filter(
    (t) => !!opts.ticketIds?.length || !t.ai_classified_at || Date.parse(t.ai_classified_at) < Date.parse(t.last_message_at),
  );
  // Enviado há pouco e sem resposta: espera.
  const { data: pending } = candidates.length
    ? await db
        .from("ai_classification_requests")
        .select("ticket_id")
        .eq("status", "sent")
        .in("ticket_id", candidates.map((t) => t.id))
        .gte("sent_at", new Date(Date.now() - RESEND_AFTER_MS).toISOString())
    : { data: [] };
  const waiting = new Set(opts.ticketIds?.length ? [] : ((pending ?? []) as { ticket_id: string }[]).map((p) => p.ticket_id));
  const batch = candidates.filter((t) => !waiting.has(t.id)).slice(0, PER_RUN);

  const result: DispatchResult = { sent: 0, failed: 0, skipped: candidates.length - batch.length };
  const callbackUrl = `${base}/api/ai/classificacoes?key=${encodeURIComponent(process.env.AI_WEBHOOK_SECRET!)}`;

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    await Promise.all(
      batch.slice(i, i + CONCURRENCY).map(async (ticket) => {
        const { data: req, error: reqError } = await db
          .from("ai_classification_requests")
          .insert({ ticket_id: ticket.id, created_by: opts.actorId ?? null, allow_close: opts.allowClose ?? true })
          .select("id")
          .single();
        if (reqError || !req) {
          result.failed++;
          return;
        }
        const payload = await buildPayload(db, ticket, req.id as string, taxonomy, callbackUrl);
        if (!payload.messages.length) {
          await db.from("ai_classification_requests").update({ status: "failed", error: "sem mensagens de texto" }).eq("id", req.id);
          result.skipped++;
          return;
        }
        const sent = await postToAgent(JSON.stringify(payload));
        if (sent.ok) result.sent++;
        else {
          result.failed++;
          await db.from("ai_classification_requests").update({ status: "failed", error: sent.error }).eq("id", req.id);
        }
      }),
    );
  }
  return result;
}

// =============================================================================
// Retorno do agente
// =============================================================================

export interface AgentResult {
  request_id?: string;
  ticket_id?: string;
  category: string;
  topic: string;
  resolved_by: ResolvedBy | null;
  needs_team: boolean;
  summary: string | null;
  confidence: number;
}

export type ApplyOutcome =
  | { ok: true; ticket_id: string; outcome: "closed" | "suggested"; reason?: string }
  | { ok: false; request_id?: string; ticket_id?: string; error: string };

/** O agente pode mandar JSON puro, o JSON dentro de um campo de texto ou texto com o JSON no meio. */
export function extractResults(raw: unknown): unknown[] {
  const parse = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    const s = v.trim();
    try {
      return JSON.parse(s);
    } catch {
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(s.slice(start, end + 1));
        } catch {
          return null;
        }
      }
      return null;
    }
  };
  const visit = (v: unknown, depth = 0): unknown[] => {
    const value = parse(v);
    if (!value || typeof value !== "object" || depth > 3) return [];
    if (Array.isArray(value)) return value.flatMap((x) => visit(x, depth + 1));
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.results)) return o.results.flatMap((x) => visit(x, depth + 1));
    if ("category" in o && ("request_id" in o || "ticket_id" in o)) return [o];
    // Envelope do agente: { output: "…json…" }, { data: {…} }, { message: "…" }…
    return Object.values(o).flatMap((x) => (typeof x === "string" || (x && typeof x === "object") ? visit(x, depth + 1) : []));
  };
  return visit(raw);
}

const RESOLVED = new Set(["community", "team", "both"]);
const RESOLVED_ALIASES: Record<string, ResolvedBy> = { comunidade: "community", equipe: "team", ambos: "both", os_dois: "both" };

function normalize(item: unknown, taxonomy: Taxonomy): AgentResult | string {
  if (!item || typeof item !== "object") return "item inválido";
  const o = item as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const category = str(o.category).toLowerCase();
  const topic = str(o.topic ?? o.subcategory).toLowerCase();
  if (!isActivePair(taxonomy, category, topic)) return `categoria/subcategoria fora da lista: ${category || "?"}/${topic || "?"}`;
  const rb = str(o.resolved_by).toLowerCase();
  const resolvedBy = RESOLVED.has(rb) ? (rb as ResolvedBy) : (RESOLVED_ALIASES[rb] ?? null);
  let confidence = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  if (Number.isFinite(confidence) && confidence > 1) confidence = confidence / 100; // 0–100 → 0–1
  if (!Number.isFinite(confidence)) confidence = 0;
  const needs = o.needs_team;
  return {
    request_id: str(o.request_id) || undefined,
    ticket_id: str(o.ticket_id) || undefined,
    category,
    topic,
    resolved_by: resolvedBy,
    // Na dúvida, precisa da equipe (não encerra).
    needs_team: needs === false || needs === "false" || needs === "nao" || needs === "não" ? false : true,
    summary: str(o.summary).slice(0, 600) || null,
    confidence: Math.min(1, Math.max(0, confidence)),
  };
}

/** Grava a sugestão e, quando é seguro, encerra o atendimento. */
async function applyOne(db: Admin, r: AgentResult, settings: AppSettings): Promise<ApplyOutcome> {
  const { data: req } = r.request_id
    ? await db.from("ai_classification_requests").select("id, ticket_id, sent_at, allow_close").eq("id", r.request_id).maybeSingle()
    : await db.from("ai_classification_requests").select("id, ticket_id, sent_at, allow_close").eq("ticket_id", r.ticket_id!).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (!req) return { ok: false, request_id: r.request_id, ticket_id: r.ticket_id, error: "envio não encontrado" };
  const ticketId = req.ticket_id as string;

  const { data: ticket } = await db
    .from("tickets")
    .select("id, status, assignee_id, last_customer_message_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return { ok: false, ticket_id: ticketId, error: "atendimento não encontrado" };

  const now = new Date().toISOString();
  await db
    .from("tickets")
    .update({
      ai_category: r.category,
      ai_topic: r.topic,
      ai_resolved_by: r.resolved_by,
      ai_needs_team: r.needs_team,
      ai_summary: r.summary,
      ai_confidence: r.confidence,
      ai_classified_at: now,
    })
    .eq("id", ticketId);

  // Só encerra quando é seguro.
  let reason: string | undefined;
  if (ticket.status !== "open") reason = "já estava finalizado";
  else if (req.allow_close === false) reason = "teste: só sugestão";
  else if (!settings.ai_auto_close) reason = "encerramento automático desligado";
  else if (r.needs_team) reason = "a IA indicou que precisa da equipe";
  else if (r.confidence < settings.ai_min_confidence) reason = `confiança ${Math.round(r.confidence * 100)}% abaixo do mínimo`;
  else if (ticket.assignee_id) reason = "alguém assumiu o atendimento";
  else if (ticket.last_customer_message_at && Date.parse(ticket.last_customer_message_at as string) > Date.parse(req.sent_at as string)) {
    reason = "o lead mandou mensagem depois do envio";
  }

  let outcome: "closed" | "suggested" = "suggested";
  if (!reason) {
    const parallel = r.topic === "offtopic" || !r.resolved_by;
    const { data: closed } = await db
      .from("tickets")
      .update({
        status: "closed",
        closed_at: now,
        closed_by: null,
        closed_by_ai: true,
        close_reason: parallel ? "parallel" : "resolved",
        category: r.category,
        topic: r.topic,
        resolved_by: parallel ? null : r.resolved_by,
        close_note: r.summary ? `Encerrado pela IA: ${r.summary}` : "Encerrado pela IA",
        waiting_since: null,
      })
      .eq("id", ticketId)
      .eq("status", "open")
      .is("assignee_id", null)
      .select("id");
    if (closed?.length) {
      outcome = "closed";
      await db.from("ticket_events").insert({
        ticket_id: ticketId,
        type: "closed",
        actor_id: null,
        data: { reason: parallel ? "parallel" : "resolved", category: r.category, topic: r.topic, resolved_by: r.resolved_by, ai: true, confidence: r.confidence },
      });
    } else reason = "mudou enquanto a IA respondia";
  }

  await db
    .from("ai_classification_requests")
    .update({ status: "done", received_at: now, outcome, response: r, error: reason ?? null })
    .eq("id", req.id);
  return { ok: true, ticket_id: ticketId, outcome, reason };
}

/** Processa o corpo do webhook de volta (um ou vários resultados). */
export async function handleAgentResult(raw: unknown): Promise<ApplyOutcome[]> {
  const db = createAdminClient();
  const [settings, taxonomy] = await Promise.all([getSettings(), getTaxonomy()]);
  const items = extractResults(raw);
  if (!items.length) return [{ ok: false, error: "nenhum resultado no corpo (esperado: request_id, category, topic…)" }];

  const out: ApplyOutcome[] = [];
  for (const item of items) {
    const r = normalize(item, taxonomy);
    if (typeof r === "string") {
      const o = item as Record<string, unknown>;
      const requestId = typeof o?.request_id === "string" ? o.request_id : undefined;
      if (requestId) await db.from("ai_classification_requests").update({ status: "rejected", received_at: new Date().toISOString(), error: r, response: o }).eq("id", requestId);
      out.push({ ok: false, request_id: requestId, error: r });
      continue;
    }
    if (!r.request_id && !r.ticket_id) {
      out.push({ ok: false, error: "faltou request_id" });
      continue;
    }
    out.push(await applyOne(db, r, settings));
  }
  return out;
}
