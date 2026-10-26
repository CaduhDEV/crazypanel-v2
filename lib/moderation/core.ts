import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { sendPrivate, type PrivateResult } from "@/lib/community/core";

// Somente servidor. Flags de moderação: dar (pela equipe ou pela IA, numa
// mensagem ou no lead) e desfazer. Usado pelas ações da tela e pela IA.

type Db = ReturnType<typeof createAdminClient>;
type ContactRow = { id: string; name: string | null; phone: string | null; lid: string | null; strikes: number };

export type ModerationEventType = "flag_added" | "flag_removed" | "removed" | "note";

export async function loadContact(db: Db, id: string): Promise<ContactRow | null> {
  const { data } = await db.from("contacts").select("id, name, phone, lid, strikes").eq("id", id).maybeSingle<ContactRow>();
  return data ?? null;
}

/** {nome}, {motivo}, {flags}, {limite}, {grupo}; sem valor vira texto neutro. */
export function fillModeration(template: string, vars: { nome?: string | null; motivo?: string | null; flags?: number; limite?: number; grupo?: string | null }) {
  return template
    .replace(/\{nome\}/g, vars.nome?.trim() || "tudo bem")
    .replace(/\{motivo\}/g, vars.motivo?.trim() || "não seguir as diretrizes da comunidade")
    .replace(/\{flags\}/g, String(vars.flags ?? 0))
    .replace(/\{limite\}/g, String(vars.limite ?? 3))
    .replace(/\{grupo\}/g, vars.grupo?.trim() || "da comunidade");
}

export async function logModeration(
  db: Db,
  ev: {
    contact_id: string;
    type: ModerationEventType;
    reason?: string | null;
    strikes_after?: number;
    message?: PrivateResult;
    actor_id: string | null;
    message_id?: string | null;
    by_ai?: boolean;
    rule?: string | null;
    confidence?: number | null;
    data?: Record<string, unknown>;
  },
): Promise<{ id: number } | null> {
  const { data, error } = await db
    .from("moderation_events")
    .insert({ ...ev, reason: ev.reason || null, data: ev.data ?? {} })
    .select("id")
    .single<{ id: number }>();
  if (error) {
    console.error("[moderação] log:", error.message);
    return null;
  }
  return data;
}

/** Regras das Configurações, uma por linha (numeradas a partir de 1). */
export function parseRules(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export type FlagOutcome =
  | { ok: true; strikes: number; limit: number; message: PrivateResult | null; eventId: number }
  | { ok: false; error: "duplicate" | "not_found" | "failed" };

/**
 * +1 flag no lead, opcionalmente presa a uma mensagem (uma flag ativa por
 * mensagem). Com warn, manda a advertência no privado (se estiver configurada).
 */
export async function applyFlag(
  db: Db,
  input: {
    contactId: string;
    messageId?: string | null;
    reason?: string | null;
    rule?: string | null;
    confidence?: number | null;
    byAi?: boolean;
    actorId: string | null;
    warn: boolean;
  },
): Promise<FlagOutcome> {
  const [contact, settings] = await Promise.all([loadContact(db, input.contactId), getSettings()]);
  if (!contact) return { ok: false, error: "not_found" };

  // Primeiro o evento: o índice único barra a segunda flag na mesma mensagem.
  const { data: ev, error } = await db
    .from("moderation_events")
    .insert({
      contact_id: contact.id,
      type: "flag_added",
      reason: input.reason || null,
      rule: input.rule || null,
      confidence: input.confidence ?? null,
      message_id: input.messageId ?? null,
      by_ai: !!input.byAi,
      actor_id: input.actorId,
      data: { warn: input.warn },
    })
    .select("id")
    .single<{ id: number }>();
  if (error) return { ok: false, error: error.code === "23505" ? "duplicate" : "failed" };

  const { data: strikes, error: rpcError } = await db.rpc("moderation_adjust_strikes", { p_contact_id: contact.id, p_delta: 1 });
  if (rpcError) {
    await db.from("moderation_events").delete().eq("id", ev.id);
    return { ok: false, error: "failed" };
  }
  const now = Number(strikes ?? contact.strikes + 1);
  if (input.messageId) await db.from("messages").update({ flagged_at: new Date().toISOString() }).eq("id", input.messageId);

  let message: PrivateResult | null = null;
  if (input.warn) {
    const text = fillModeration(settings.mod_msg_warning, { nome: contact.name, motivo: input.reason || input.rule, flags: now, limite: settings.mod_strike_limit });
    message = await sendPrivate(db, { id: null, phone: contact.phone, contact_id: contact.id, name: contact.name }, text, "moderation_warning");
  }
  await db.from("moderation_events").update({ strikes_after: now, message }).eq("id", ev.id);
  return { ok: true, strikes: now, limit: settings.mod_strike_limit, message, eventId: ev.id };
}

/**
 * -1 flag. Desfaz a flag indicada (ou a mais recente ainda ativa) e tira a
 * marca da mensagem. Lead com flags antigas sem registro só perde 1.
 */
export async function revertFlag(db: Db, input: { contactId: string; eventId?: number | null; reason?: string | null; actorId: string }): Promise<{ strikes: number } | { error: string }> {
  const contact = await loadContact(db, input.contactId);
  if (!contact) return { error: "Lead não encontrado." };
  if (contact.strikes <= 0) return { error: "Este lead não tem flags." };

  let target = db
    .from("moderation_events")
    .select("id, message_id, by_ai")
    .eq("contact_id", contact.id)
    .eq("type", "flag_added")
    .is("reverted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (input.eventId) target = target.eq("id", input.eventId);
  const { data: rows } = await target;
  const flag = (rows ?? [])[0] as { id: number; message_id: string | null; by_ai: boolean } | undefined;
  if (input.eventId && !flag) return { error: "Essa flag já foi retirada." };

  if (flag) {
    const { data: reverted } = await db
      .from("moderation_events")
      .update({ reverted_at: new Date().toISOString(), reverted_by: input.actorId })
      .eq("id", flag.id)
      .is("reverted_at", null)
      .select("id");
    if (!reverted?.length) return { error: "Essa flag já foi retirada." };
    if (flag.message_id) await db.from("messages").update({ flagged_at: null }).eq("id", flag.message_id);
  }

  const { data: strikes, error } = await db.rpc("moderation_adjust_strikes", { p_contact_id: contact.id, p_delta: -1 });
  if (error) throw error;
  const after = Number(strikes ?? 0);
  await logModeration(db, {
    contact_id: contact.id,
    type: "flag_removed",
    reason: input.reason,
    strikes_after: after,
    actor_id: input.actorId,
    message_id: flag?.message_id ?? null,
    data: flag ? { reverts: flag.id, by_ai: flag.by_ai } : {},
  });
  return { strikes: after };
}
