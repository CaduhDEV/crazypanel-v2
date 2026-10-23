"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
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

  // Suporte a login em ambiente de desenvolvimento local quando não há banco conectado
  if (!process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("dummy")) {
    const cookieStore = await cookies();
    cookieStore.set("dev_demo_session", "1", { path: "/", httpOnly: true });
    cookieStore.set("dev_demo_email", parsed.data.email, { path: "/", httpOnly: true });
    redirect("/atendimento");
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

  redirect("/atendimento");
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    await sendPasswordLink(parsed.data.email);
    return { success: "Se o e-mail estiver cadastrado, você receberá um link em instantes." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao enviar e-mail." };
  }
}

export async function setPassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = setPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: "Não foi possível definir a senha. Tente novamente." };
  }

  redirect("/atendimento");
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete("dev_demo_session");
  cookieStore.delete("dev_demo_email");
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Modo demo local sem Supabase
  }
  redirect("/login");
}
