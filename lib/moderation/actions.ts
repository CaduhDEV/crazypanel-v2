"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { getSettings } from "@/lib/settings";
import { getUazapi } from "@/lib/uazapi/instance";
import { sendPrivate, type PrivateResult } from "@/lib/community/core";

// Moderação (admin): flags, advertência no privado e remoção da comunidade.
// Com o limite de flags das Configurações (3), o lead fica inapto.

type Db = ReturnType<typeof createAdminClient>;
type ContactRow = { id: string; name: string | null; phone: string | null; lid: string | null; strikes: number };

const reason = z.string().trim().max(500).optional();
const contactSchema = z.object({ contactId: z.uuid(), reason });

async function loadContact(db: Db, id: string): Promise<ContactRow> {
  const { data } = await db.from("contacts").select("id, name, phone, lid, strikes").eq("id", id).maybeSingle<ContactRow>();
  if (!data) throw new ActionError("Lead não encontrado.");
  return data;
}

/** {nome}, {motivo}, {flags}, {limite}, {grupo}; sem valor vira texto neutro. */
function fill(template: string, vars: { nome?: string | null; motivo?: string | null; flags?: number; limite?: number; grupo?: string | null }) {
  return template
    .replace(/\{nome\}/g, vars.nome?.trim() || "tudo bem")
    .replace(/\{motivo\}/g, vars.motivo?.trim() || "não seguir as diretrizes da comunidade")
    .replace(/\{flags\}/g, String(vars.flags ?? 0))
    .replace(/\{limite\}/g, String(vars.limite ?? 3))
    .replace(/\{grupo\}/g, vars.grupo?.trim() || "da comunidade");
}

async function log(
  db: Db,
  ev: { contact_id: string; type: "flag_added" | "flag_removed" | "removed" | "note"; reason?: string; strikes_after?: number; message?: PrivateResult; actor_id: string; data?: Record<string, unknown> },
) {
  const { error } = await db.from("moderation_events").insert({ ...ev, reason: ev.reason || null, data: ev.data ?? {} });
  if (error) console.error("[moderação] log:", error.message);
}

function done() {
  revalidatePath("/moderacao");
  revalidatePath("/leads");
}

const flagSchema = z.object({ contactId: z.uuid(), reason, warn: z.boolean().default(true) });

/**
 * +1 flag. Com warn, manda a advertência no privado (se a mensagem estiver
 * configurada). Devolve as flags e se o lead ficou inapto.
 */
export async function addFlag(input: z.input<typeof flagSchema>): Promise<ActionResult<{ strikes: number; limit: number; message: PrivateResult | null }>> {
  return runAction(flagSchema, input, async ({ contactId, reason: why, warn }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const [contact, settings] = await Promise.all([loadContact(db, contactId), getSettings()]);
    const { data: strikes, error } = await db.rpc("moderation_adjust_strikes", { p_contact_id: contactId, p_delta: 1 });
    if (error) throw error;
    const now = Number(strikes ?? contact.strikes + 1);

    let message: PrivateResult | null = null;
    if (warn) {
      const text = fill(settings.mod_msg_warning, { nome: contact.name, motivo: why, flags: now, limite: settings.mod_strike_limit });
      message = await sendPrivate(db, { id: null, phone: contact.phone, contact_id: contact.id, name: contact.name }, text, "moderation_warning");
    }
    await log(db, { contact_id: contactId, type: "flag_added", reason: why, strikes_after: now, message: message ?? undefined, actor_id: admin.id, data: { warn } });
    done();
    return { strikes: now, limit: settings.mod_strike_limit, message };
  });
}

/** -1 flag (nunca abaixo de 0). */
export async function removeFlag(input: z.input<typeof contactSchema>): Promise<ActionResult<{ strikes: number }>> {
  return runAction(contactSchema, input, async ({ contactId, reason: why }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const contact = await loadContact(db, contactId);
    if (contact.strikes <= 0) throw new ActionError("Este lead não tem flags.");
    const { data: strikes, error } = await db.rpc("moderation_adjust_strikes", { p_contact_id: contactId, p_delta: -1 });
    if (error) throw error;
    await log(db, { contact_id: contactId, type: "flag_removed", reason: why, strikes_after: Number(strikes ?? 0), actor_id: admin.id });
    done();
    return { strikes: Number(strikes ?? 0) };
  });
}

const noteSchema = z.object({ contactId: z.uuid(), reason: z.string().trim().min(2, { error: "Escreva a anotação." }).max(500) });

/** Anotação no histórico de moderação (não mexe nas flags). */
export async function addModerationNote(input: z.input<typeof noteSchema>): Promise<ActionResult<void>> {
  return runAction(noteSchema, input, async ({ contactId, reason: why }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const contact = await loadContact(db, contactId);
    await log(db, { contact_id: contactId, type: "note", reason: why, strikes_after: contact.strikes, actor_id: admin.id });
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
      const text = fill(settings.mod_msg_removed, { nome: contact.name, motivo: why, flags: contact.strikes, limite: settings.mod_strike_limit, grupo: groups.map((g) => g.group?.name).filter(Boolean).join(", ") });
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
    await log(db, { contact_id: contactId, type: "removed", reason: why, strikes_after: contact.strikes, message: message ?? undefined, actor_id: admin.id, data: { removed: result.removed, failed: result.failed } });
    done();
    return result;
  });
}

const settingsSchema = z.object({
  limit: z.number().int().min(1, { error: "O limite mínimo é 1 flag." }).max(10, { error: "O limite máximo é 10 flags." }),
  // Vazia = mensagem desligada (não é enviada).
  warning: z.string().trim().max(1000),
  removed: z.string().trim().max(1000),
});

export async function updateModerationSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult<void>> {
  return runAction(settingsSchema, input, async ({ limit, warning, removed }) => {
    const admin = await requireAdmin();
    const { error } = await createAdminClient()
      .from("app_settings")
      .update({ mod_strike_limit: limit, mod_msg_warning: warning, mod_msg_removed: removed, updated_by: admin.id })
      .eq("id", 1);
    if (error) {
      if (/mod_/.test(error.message)) throw new ActionError("Rode as migrations novas (npx supabase db push) antes de salvar.");
      throw error;
    }
    revalidatePath("/", "layout");
  });
}
