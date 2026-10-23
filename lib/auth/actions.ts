"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendPasswordLink } from "@/lib/auth/recovery";
import { loginSchema, resetSchema, setPasswordSchema } from "@/lib/auth/validation";

export type FormState =
  | {
      error?: string;
      success?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      values?: Record<string, string>;
    }
  | undefined;

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const values = { email: String(formData.get("email") ?? "") };
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { error: "Seu convite ainda não foi aceito. Abra o link enviado por e-mail.", values };
    }
    return { error: "E-mail ou senha inválidos.", values };
  }

  // Conta desativada pelo admin: o perfil não é legível (RLS) e a sessão é encerrada.
  const { data: profile } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return { error: "Seu acesso está desativado. Fale com um administrador.", values };
  }

  redirect("/");
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: { email: String(formData.get("email") ?? "") } };
  }

  const error = await sendPasswordLink(parsed.data.email);
  if (error?.code === "over_email_send_rate_limit") {
    return { error: "Aguarde alguns minutos antes de pedir outro e-mail." };
  }
  // Resposta igual exista ou não a conta: não revela quais e-mails estão cadastrados.
  return { success: "Se o e-mail tiver acesso, você vai receber um link para criar uma nova senha." };
}

export async function setPassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = setPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { error: "Escolha uma senha diferente da atual." };
    if (error.code === "weak_password") return { error: "Senha muito fraca. Escolha uma mais forte." };
    return { error: "Não foi possível salvar a senha. Abra o link do e-mail novamente." };
  }

  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
