import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { findObjects, signedPost } from "@/lib/ai/classify";
import { applyFlag, parseRules } from "@/lib/moderation/core";

// Somente servidor. Moderação pelo agente de IA do CRM DataCrazy, no mesmo
// esquema de ida e volta da classificação, mas com outro agente:
//   ida:   POST AI_MODERATION_WEBHOOK_URL com um lote de mensagens novas dos
//          grupos e as regras da comunidade (assinado como na classificação)
//   volta: /api/ai/moderacao?key=… com as mensagens que violam as regras
// Cada violação vira uma flag "Moderado por IA" presa à mensagem.

type Admin = ReturnType<typeof createAdminClient>;

/** Só mensagens recentes: ligar a moderação não varre o histórico. */
const WINDOW_MS = 6 * 60 * 60 * 1000;
const PER_REQUEST = 50;
const PER_RUN = 200;
const MAX_TEXT = 1200;

export function moderationConfigured(): boolean {
  return !!process.env.AI_MODERATION_WEBHOOK_URL && !!process.env.AI_WEBHOOK_SECRET;
}

type Candidate = {
  id: string;
  sent_at: string;
  body: string | null;
  kind: string;
  contact_id: string | null;
  author_id: string | null;
  sender_name: string | null;
  quoted_wa_id: string | null;
  contact: { name: string | null; kind: string } | null;
  group: { name: string | null } | null;
};

export interface ModerationDispatch {
  sent: number;
  messages: number;
  failed: number;
}

/** Manda as mensagens novas dos leads (texto e legendas) para o agente de moderação. */
export async function dispatchModeration(): Promise<ModerationDispatch> {
  const out: ModerationDispatch = { sent: 0, messages: 0, failed: 0 };
  if (!moderationConfigured()) return out;
  const db = createAdminClient();
  const settings = await getSettings();
  const rules = parseRules(settings.community_rules);
  if (!rules.length) return out;

  const { data } = await db
    .from("messages")
    .select("id, sent_at, body, kind, contact_id, author_id, sender_name, quoted_wa_id, contact:contacts!contact_id(name, kind), group:wa_groups(name)")
    .is("ai_moderated_at", null)
    .eq("from_me", false)
    .eq("is_note", false)
    .is("deleted_at", null)
    .gte("sent_at", new Date(Date.now() - WINDOW_MS).toISOString())
    .order("sent_at", { ascending: true })
    .limit(PER_RUN);
  const rows = (data ?? []) as unknown as Candidate[];
  if (!rows.length) return out;

  // Marca antes de mandar: duas rotinas ao mesmo tempo não mandam a mesma mensagem.
  const { data: claimed } = await db
    .from("messages")
    .update({ ai_moderated_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id))
    .is("ai_moderated_at", null)
    .select("id");
  const mine = new Set(((claimed ?? []) as { id: string }[]).map((r) => r.id));

  // Equipe e mensagens sem texto ficam de fora (já marcadas como lidas).
  const eligible = rows.filter((m) => mine.has(m.id) && m.contact_id && !m.author_id && m.contact?.kind !== "team" && (m.body ?? "").trim().length >= 2);
  if (!eligible.length) return out;

  // A mensagem respondida ajuda a entender o tom (ex.: xingamento em resposta).
  const quotedIds = [...new Set(eligible.map((m) => m.quoted_wa_id).filter((x): x is string => !!x))];
  const quoted = new Map<string, string>();
  if (quotedIds.length) {
    const { data: q } = await db.from("messages").select("wa_id, body").in("wa_id", quotedIds);
    for (const r of (q ?? []) as { wa_id: string; body: string | null }[]) if (r.body) quoted.set(r.wa_id, r.body.slice(0, 300));
  }

  const callbackUrl = `${await siteUrl()}/api/ai/moderacao?key=${encodeURIComponent(process.env.AI_WEBHOOK_SECRET!)}`;
  for (let i = 0; i < eligible.length; i += PER_REQUEST) {
    const batch = eligible.slice(i, i + PER_REQUEST);
    const ids = batch.map((m) => m.id);
    const { data: req, error } = await db.from("ai_moderation_requests").insert({ message_ids: ids }).select("id").single<{ id: string }>();
    if (error || !req) {
      out.failed++;
      await db.from("messages").update({ ai_moderated_at: null }).in("id", ids);
      continue;
    }
    const body = JSON.stringify({
      type: "moderacao",
      request_id: req.id,
      callback_url: callbackUrl,
      rules: rules.map((text, n) => ({ id: n + 1, text })),
      messages: batch.map((m) => ({
        id: m.id,
        at: m.sent_at,
        group: m.group?.name ?? null,
        author: m.contact?.name ?? m.sender_name ?? null,
        text: `${m.kind !== "text" ? "[legenda de mídia] " : ""}${(m.body ?? "").trim()}`.slice(0, MAX_TEXT),
        reply_to: m.quoted_wa_id ? (quoted.get(m.quoted_wa_id) ?? null) : null,
      })),
    });
    try {
      const res = await signedPost(process.env.AI_MODERATION_WEBHOOK_URL!, body);
      if (!res.ok) throw new Error(`agente respondeu ${res.status}`);
      out.sent++;
      out.messages += batch.length;
      // Se o agente já devolver o resultado na mesma resposta, processa na hora.
      const text = await res.text().catch(() => "");
      if (text.trim()) await handleModerationResult(text).catch(() => undefined);
    } catch (e) {
      out.failed++;
      await db.from("ai_moderation_requests").update({ status: "failed", error: e instanceof Error ? e.message : "falhou" }).eq("id", req.id);
      // Volta para a fila: a próxima rotina tenta de novo.
      await db.from("messages").update({ ai_moderated_at: null }).in("id", ids);
    }
  }
  return out;
}

export type ModerationOutcome =
  | { ok: true; request_id: string; flagged: number; skipped: { message_id: string; reason: string }[] }
  | { ok: false; request_id?: string; error: string };

function confidenceOf(v: unknown): number {
  let c = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(c)) return 1; // sem confiança: a IA afirmou a violação
  if (c > 1) c = c / 100;
  return Math.min(1, Math.max(0, c));
}

function parseViolations(v: unknown): Record<string, unknown>[] {
  if (typeof v === "string") {
    try {
      return parseViolations(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

/** Processa o retorno do agente de moderação: cada violação vira uma flag na mensagem. */
export async function handleModerationResult(raw: unknown): Promise<ModerationOutcome[]> {
  const items = findObjects(raw, (o) => "violations" in o && "request_id" in o);
  if (!items.length) return [{ ok: false, error: "nenhum resultado no corpo (esperado: request_id e violations)" }];
  const db = createAdminClient();
  const settings = await getSettings();
  const rules = parseRules(settings.community_rules);
  const out: ModerationOutcome[] = [];

  for (const item of items) {
    const requestId = typeof item.request_id === "string" ? item.request_id.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
      out.push({ ok: false, error: "request_id inválido" });
      continue;
    }
    // Só um retorno por envio (o agente pode chamar duas vezes).
    const { data: req } = await db
      .from("ai_moderation_requests")
      .update({ status: "done", received_at: new Date().toISOString(), response: item })
      .eq("id", requestId)
      .neq("status", "done")
      .select("id, message_ids")
      .maybeSingle<{ id: string; message_ids: string[] }>();
    if (!req) {
      out.push({ ok: false, request_id: requestId, error: "envio não encontrado ou já processado" });
      continue;
    }
    out.push(await applyViolations(db, req, parseViolations(item.violations), rules, settings.ai_moderation_min_confidence, settings.ai_moderation_warn));
  }
  return out;
}

async function applyViolations(
  db: Admin,
  req: { id: string; message_ids: string[] },
  violations: Record<string, unknown>[],
  rules: string[],
  minConfidence: number,
  warn: boolean,
): Promise<ModerationOutcome> {
  const allowed = new Set(req.message_ids);
  const skipped: { message_id: string; reason: string }[] = [];
  const warned = new Set<string>();
  let flagged = 0;

  for (const v of violations) {
    const messageId = typeof v.message_id === "string" ? v.message_id.trim() : "";
    if (!allowed.has(messageId)) {
      skipped.push({ message_id: messageId, reason: "mensagem fora deste envio" });
      continue;
    }
    const confidence = confidenceOf(v.confidence);
    if (confidence < minConfidence) {
      skipped.push({ message_id: messageId, reason: `confiança ${Math.round(confidence * 100)}% abaixo do mínimo` });
      continue;
    }
    // Regra pelo número (1, 2…) ou pelo texto.
    const n = Number(v.rule);
    const rule = Number.isInteger(n) && n >= 1 && n <= rules.length ? rules[n - 1] : typeof v.rule === "string" && v.rule.trim() ? v.rule.trim().slice(0, 300) : null;
    const reason = typeof v.reason === "string" ? v.reason.trim().slice(0, 500) : null;

    const { data: msg } = await db.from("messages").select("contact_id").eq("id", messageId).maybeSingle<{ contact_id: string | null }>();
    if (!msg?.contact_id) {
      skipped.push({ message_id: messageId, reason: "mensagem sem lead" });
      continue;
    }
    // No máximo uma advertência no privado por lead em cada lote.
    const sendWarning = warn && !warned.has(msg.contact_id);
    const res = await applyFlag(db, { contactId: msg.contact_id, messageId, reason, rule, confidence, byAi: true, actorId: null, warn: sendWarning });
    if (res.ok) {
      flagged++;
      if (sendWarning) warned.add(msg.contact_id);
    } else skipped.push({ message_id: messageId, reason: res.error === "duplicate" ? "já tinha flag" : "falhou" });
  }

  await db.from("ai_moderation_requests").update({ flagged, error: skipped.length ? skipped.map((s) => s.reason).join("; ").slice(0, 500) : null }).eq("id", req.id);
  return { ok: true, request_id: req.id, flagged, skipped };
}
