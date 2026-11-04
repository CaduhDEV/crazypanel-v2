"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { emailSchema } from "@/lib/auth/validation";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { siteUrl } from "@/lib/site-url";
import { sendPasswordLink } from "@/lib/auth/recovery";

const roleSchema = z.enum(["admin", "attendant"]);

// --- Números do atendente: toda mensagem desses números conta para ele ------------

function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

export interface AttendantPhones {
  phones: { id: string; phone: string }[];
  /** Contatos ligados a este atendente (inclui os só com @lid). */
  contacts: { id: string; name: string | null; phone: string | null; lid: string | null; message_count: number }[];
  /** Contatos da equipe ainda sem atendente: dá para ligar direto (quem só tem @lid). */
  unlinked: { id: string; name: string | null; phone: string | null; lid: string | null; message_count: number }[];
}

const CONTACT_COLUMNS = "id, name, phone, lid, message_count";

export async function listAttendantPhones(input: { profileId: string }): Promise<ActionResult<AttendantPhones>> {
  return runAction(z.object({ profileId: z.uuid() }), input, async ({ profileId }) => {
    await requireAdmin();
    const db = createAdminClient();
    const [phones, contacts, unlinked] = await Promise.all([
      db.from("profile_phones").select("id, phone").eq("profile_id", profileId).order("created_at"),
      db.from("contacts").select(CONTACT_COLUMNS).eq("attendant_id", profileId).order("message_count", { ascending: false }),
      db.from("contacts").select(CONTACT_COLUMNS).eq("kind", "team").is("attendant_id", null).order("message_count", { ascending: false }).limit(50),
    ]);
    if (phones.error) throw phones.error;
    return {
      phones: (phones.data ?? []) as AttendantPhones["phones"],
      contacts: (contacts.data ?? []) as AttendantPhones["contacts"],
      unlinked: (unlinked.data ?? []) as AttendantPhones["unlinked"],
    };
  });
}

const addPhoneSchema = z.object({ profileId: z.uuid(), phone: z.string().trim().max(40) });

export async function addAttendantPhone(input: z.input<typeof addPhoneSchema>): Promise<ActionResult<void>> {
  return runAction(addPhoneSchema, input, async ({ profileId, phone }) => {
    await requireAdmin();
    const normalized = normalizePhone(phone);
    if (!normalized) throw new ActionError("Confira o número (DDD + número).");
    const { error } = await createAdminClient().from("profile_phones").insert({ profile_id: profileId, phone: normalized });
    if (error) {
      if (error.code === "23505") throw new ActionError("Este número já está vinculado a um atendente.");
      throw error;
    }
    revalidatePath("/metricas");
  });
}

export async function removeAttendantPhone(input: { id: string }): Promise<ActionResult<void>> {
  return runAction(z.object({ id: z.uuid() }), input, async ({ id }) => {
    await requireAdmin();
    const { error } = await createAdminClient().from("profile_phones").delete().eq("id", id);
    if (error) throw error;
  });
}

const linkContactSchema = z.object({ contactId: z.uuid(), profileId: z.uuid().nullable() });

/** Liga um contato direto ao atendente (ou desliga, com profileId nulo). */
export async function linkContactToAttendant(input: z.input<typeof linkContactSchema>): Promise<ActionResult<void>> {
  return runAction(linkContactSchema, input, async ({ contactId, profileId }) => {
    await requireAdmin();
    const { error } = await createAdminClient().from("contacts").update({ attendant_id: profileId }).eq("id", contactId);
    if (error) throw error;
  });
}

const inviteSchema = z.object({
  name: z.string().trim().min(2, { error: "Informe o nome." }).max(80),
  email: emailSchema,
  role: roleSchema,
});

/** Cadastra o atendente: o Supabase envia o convite e ele define a senha pelo link. */
export async function inviteAttendant(input: z.input<typeof inviteSchema>): Promise<ActionResult<void>> {
  return runAction(inviteSchema, input, async ({ name, email, role }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();

    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { name },
      redirectTo: `${await siteUrl()}/auth/callback`,
    });
    if (error) {
      if (error.code === "email_exists" || /already been registered/i.test(error.message)) {
        throw new ActionError("Já existe uma conta com este e-mail.");
      }
      if (error.code === "over_email_send_rate_limit") {
        throw new ActionError("Limite de e-mails atingido. Aguarde alguns minutos.");
      }
      throw error;
    }

    // O trigger criou o perfil como atendente; aplica o papel escolhido.
    await db.from("profiles").update({ name, role, invited_by: admin.id }).eq("id", data.user.id);
    revalidatePath("/admin/atendentes");
  });
}

const profileIdSchema = z.object({ profileId: z.uuid() });

/** Reenvia o acesso: link para (re)definir a senha. */
export async function resendAccess(input: z.input<typeof profileIdSchema>): Promise<ActionResult<void>> {
  return runAction(profileIdSchema, input, async ({ profileId }) => {
    await requireAdmin();
    const { data: profile } = await createAdminClient().from("profiles").select("email, active").eq("id", profileId).maybeSingle();
    if (!profile) throw new ActionError("Atendente não encontrado.");
    if (!profile.active) throw new ActionError("Reative o acesso antes de reenviar.");

    // Link que vale no navegador do atendente (não no do admin que clicou).
    const error = await sendPasswordLink(profile.email);
    if (error?.code === "over_email_send_rate_limit") throw new ActionError("Aguarde alguns minutos antes de reenviar.");
    if (error) throw error;
  });
}

const roleChangeSchema = z.object({ profileId: z.uuid(), role: roleSchema });

export async function changeRole(input: z.input<typeof roleChangeSchema>): Promise<ActionResult<void>> {
  return runAction(roleChangeSchema, input, async ({ profileId, role }) => {
    const admin = await requireAdmin();
    if (profileId === admin.id && role !== "admin") {
      throw new ActionError("Você não pode remover o seu próprio acesso de administrador.");
    }
    await createAdminClient().from("profiles").update({ role }).eq("id", profileId);
    revalidatePath("/admin/atendentes");
  });
}

const activeSchema = z.object({ profileId: z.uuid(), active: z.boolean() });

/**
 * Desativar bloqueia o login (ban no Auth derruba as sessões) e devolve os
 * atendimentos abertos dele para a fila. Reativar desfaz o bloqueio.
 */
export async function setActive(input: z.input<typeof activeSchema>): Promise<ActionResult<void>> {
  return runAction(activeSchema, input, async ({ profileId, active }) => {
    const admin = await requireAdmin();
    if (profileId === admin.id) throw new ActionError("Você não pode desativar a sua própria conta.");

    const db = createAdminClient();
    const { error } = await db.auth.admin.updateUserById(profileId, { ban_duration: active ? "none" : "876000h" });
    if (error) throw error;
    await db.from("profiles").update({ active }).eq("id", profileId);

    if (!active) {
      const { data: released } = await db
        .from("tickets")
        .update({ assignee_id: null })
        .eq("assignee_id", profileId)
        .eq("status", "open")
        .select("id");
      if (released?.length) {
        await db.from("ticket_events").insert(
          released.map((t) => ({ ticket_id: t.id, type: "unassigned", actor_id: admin.id, data: { from: profileId, reason: "deactivated" } })),
        );
      }
    }
    revalidatePath("/admin/atendentes");
  });
}
