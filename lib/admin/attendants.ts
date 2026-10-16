"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { emailSchema } from "@/lib/auth/validation";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { siteUrl } from "@/lib/site-url";

const roleSchema = z.enum(["admin", "attendant"]);

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
      redirectTo: `${await siteUrl()}/auth/confirm?next=/definir-senha`,
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

    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${await siteUrl()}/auth/confirm?next=/definir-senha`,
    });
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
