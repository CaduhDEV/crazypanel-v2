"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { getSettings } from "@/lib/settings";
import { getUazapi } from "@/lib/uazapi/instance";
import { sendPrivate, type PrivateResult } from "@/lib/community/core";
import { applyFlag, fillModeration, loadContact, logModeration, revertFlag } from "@/lib/moderation/core";
import { dispatchModeration, moderationConfigured, type ModerationDispatch } from "@/lib/ai/moderate";

// Moderação (admin): flags, advertência no privado e remoção da comunidade.
// Com o limite de flags das Configurações (3), o lead fica inapto.

const reason = z.string().trim().max(500).optional();

function done() {
  revalidatePath("/moderacao");
  revalidatePath("/leads");
}

const flagSchema = z
  .object({ contactId: z.uuid().optional(), messageId: z.uuid().optional(), reason, warn: z.boolean().default(true) })
  .refine((v) => v.contactId || v.messageId, { error: "Informe o lead ou a mensagem." });

/**
 * +1 flag, no lead ou numa mensagem dele. Com warn, manda a advertência no
 * privado (se a mensagem estiver configurada). Devolve as flags e o limite.
 */
export async function addFlag(input: z.input<typeof flagSchema>): Promise<ActionResult<{ strikes: number; limit: number; message: PrivateResult | null }>> {
  return runAction(flagSchema, input, async ({ contactId, messageId, reason: why, warn }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    let target = contactId;
    if (messageId) {
      const { data: msg } = await db.from("messages").select("id, contact_id, from_me, is_note").eq("id", messageId).maybeSingle();
      if (!msg || msg.from_me || msg.is_note || !msg.contact_id) throw new ActionError("Essa mensagem não é de um lead.");
      if (contactId && contactId !== msg.contact_id) throw new ActionError("A mensagem é de outro lead.");
      target = msg.contact_id as string;
    }
    const res = await applyFlag(db, { contactId: target!, messageId, reason: why, actorId: admin.id, warn });
    if (!res.ok) {
      if (res.error === "duplicate") throw new ActionError("Essa mensagem já tem flag.");
      if (res.error === "not_found") throw new ActionError("Lead não encontrado.");
      throw new ActionError("Não foi possível dar a flag.");
    }
    done();
    return { strikes: res.strikes, limit: res.limit, message: res.message };
  });
}

const unflagSchema = z.object({ contactId: z.uuid(), eventId: z.number().int().positive().optional(), reason });

/** -1 flag: desfaz a flag indicada (ou a mais recente). Nunca abaixo de 0. */
export async function removeFlag(input: z.input<typeof unflagSchema>): Promise<ActionResult<{ strikes: number }>> {
  return runAction(unflagSchema, input, async ({ contactId, eventId, reason: why }) => {
    const admin = await requireAdmin();
    const res = await revertFlag(createAdminClient(), { contactId, eventId, reason: why, actorId: admin.id });
    if ("error" in res) throw new ActionError(res.error);
    done();
    return res;
  });
}

export interface LeadFlag {
  id: number;
  created_at: string;
  reason: string | null;
  rule: string | null;
  by_ai: boolean;
  confidence: number | null;
  strikes_after: number | null;
  reverted_at: string | null;
  actor: { name: string } | null;
  reverter: { name: string } | null;
  msg: { id: string; body: string | null; kind: string; sent_at: string; ticket_id: string | null; deleted_at: string | null; group: { name: string | null } | null } | null;
}

/** Flags do lead (ativas e retiradas), com a mensagem marcada. */
export async function listLeadFlags(input: { contactId: string }): Promise<ActionResult<LeadFlag[]>> {
  return runAction(z.object({ contactId: z.uuid() }), input, async ({ contactId }) => {
    await requireAdmin();
    const { data, error } = await createAdminClient()
      .from("moderation_events")
      .select(
        "id, created_at, reason, rule, by_ai, confidence, strikes_after, reverted_at, actor:profiles!moderation_events_actor_id_fkey(name), reverter:profiles!moderation_events_reverted_by_fkey(name), msg:messages(id, body, kind, sent_at, ticket_id, deleted_at, group:wa_groups(name))",
      )
      .eq("contact_id", contactId)
      .eq("type", "flag_added")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as unknown as LeadFlag[];
  });
}

const noteSchema = z.object({ contactId: z.uuid(), reason: z.string().trim().min(2, { error: "Escreva a anotação." }).max(500) });

/** Anotação no histórico de moderação (não mexe nas flags). */
export async function addModerationNote(input: z.input<typeof noteSchema>): Promise<ActionResult<void>> {
  return runAction(noteSchema, input, async ({ contactId, reason: why }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const contact = await loadContact(db, contactId);
    if (!contact) throw new ActionError("Lead não encontrado.");
    await logModeration(db, { contact_id: contactId, type: "note", reason: why, strikes_after: contact.strikes, actor_id: admin.id });
    done();
  });
}

const removeSchema = z.object({ contactId: z.uuid(), reason, notify: z.boolean().default(true) });

export interface RemovalResult {
  removed: string[];
  failed: { group: string; error: string }[];
  message: PrivateResult | null;
}

/**
 * Tira o lead de todos os grupos da comunidade em que ele está (o número do
 * painel precisa ser admin do grupo) e, com notify, avisa no privado.
 */
export async function removeFromCommunity(input: z.input<typeof removeSchema>): Promise<ActionResult<RemovalResult>> {
  return runAction(removeSchema, input, async ({ contactId, reason: why, notify }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const [contact, settings] = await Promise.all([loadContact(db, contactId), getSettings()]);
    if (!contact) throw new ActionError("Lead não encontrado.");
    const who = contact.phone ?? (contact.lid ? `${contact.lid}@lid` : null);
    if (!who) throw new ActionError("Este lead não tem telefone nem identificador do WhatsApp.");

    const { data: memberships } = await db
      .from("group_members")
      .select("group_jid, group:wa_groups(name)")
      .eq("contact_id", contactId)
      .is("left_at", null);
    const groups = (memberships ?? []) as unknown as { group_jid: string; group: { name: string | null } | null }[];

    // Avisa antes de remover (depois ele não está mais no grupo, mas o privado funciona igual).
    let message: PrivateResult | null = null;
    if (notify) {
      const text = fillModeration(settings.mod_msg_removed, { nome: contact.name, motivo: why, flags: contact.strikes, limite: settings.mod_strike_limit, grupo: groups.map((g) => g.group?.name).filter(Boolean).join(", ") });
      message = await sendPrivate(db, { id: null, phone: contact.phone, contact_id: contact.id, name: contact.name }, text, "moderation_removed");
    }

    const result: RemovalResult = { removed: [], failed: [], message };
    if (groups.length) {
      const uaz = await getUazapi();
      for (const g of groups) {
        const name = g.group?.name ?? g.group_jid;
        try {
          const res = await uaz.updateParticipants(g.group_jid, "remove", [who]);
          const r = res.groupUpdated?.[0];
          if (r?.Error) throw new Error(r.Error === 403 || r.Error === 401 ? "o número do painel não é admin do grupo" : `erro ${r.Error}`);
          result.removed.push(name);
          await db.from("group_members").update({ left_at: new Date().toISOString() }).eq("group_jid", g.group_jid).eq("contact_id", contactId);
        } catch (e) {
          result.failed.push({ group: name, error: e instanceof Error ? e.message : "falhou" });
        }
      }
    }

    const now = new Date().toISOString();
    if (result.removed.length || !groups.length) {
      await db.from("contacts").update({ removed_from_community_at: now, left_community_at: now }).eq("id", contactId);
    }
    await logModeration(db, { contact_id: contactId, type: "removed", reason: why, strikes_after: contact.strikes, message: message ?? undefined, actor_id: admin.id, data: { removed: result.removed, failed: result.failed } });
    done();
    return result;
  });
}

const settingsSchema = z.object({
  limit: z.number().int().min(1, { error: "O limite mínimo é 1 flag." }).max(10, { error: "O limite máximo é 10 flags." }),
  // Vazia = mensagem desligada (não é enviada).
  warning: z.string().trim().max(1000),
  removed: z.string().trim().max(1000),
  rules: z.string().trim().max(3000),
  aiEnabled: z.boolean(),
  aiMinConfidence: z.number().min(0).max(1),
  aiWarn: z.boolean(),
});

export async function updateModerationSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult<void>> {
  return runAction(settingsSchema, input, async ({ limit, warning, removed, rules, aiEnabled, aiMinConfidence, aiWarn }) => {
    if (aiEnabled && !rules) throw new ActionError("Escreva as regras da comunidade antes de ligar a moderação por IA.");
    const admin = await requireAdmin();
    const { error } = await createAdminClient()
      .from("app_settings")
      .update({
        mod_strike_limit: limit,
        mod_msg_warning: warning,
        mod_msg_removed: removed,
        community_rules: rules,
        ai_moderation_enabled: aiEnabled,
        ai_moderation_min_confidence: aiMinConfidence,
        ai_moderation_warn: aiWarn,
        updated_by: admin.id,
      })
      .eq("id", 1);
    if (error) {
      if (/mod_|community_rules|ai_moderation/.test(error.message)) throw new ActionError("Rode as migrations novas (npx supabase db push) antes de salvar.");
      throw error;
    }
    revalidatePath("/", "layout");
  });
}

/** Configurações → Moderação: manda agora as mensagens novas para a IA (sem esperar a rotina). */
export async function runAiModerationNow(): Promise<ActionResult<ModerationDispatch>> {
  return runAction(z.object({}), {}, async () => {
    await requireAdmin();
    if (!moderationConfigured()) throw new ActionError("Falta configurar AI_MODERATION_WEBHOOK_URL nas variáveis do painel.");
    return dispatchModeration();
  });
}
