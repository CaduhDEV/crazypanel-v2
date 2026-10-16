import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Definir senha" };

// Chega aqui pelo link de convite ou de recuperação (/auth/confirm já criou a sessão).
export default async function DefinirSenhaPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login?erro=link-invalido");

  const meta = (data.claims.user_metadata ?? {}) as { name?: string };
  const firstName = meta.name?.split(" ")[0];

  return <SetPasswordForm firstName={firstName} email={String(data.claims.email ?? "")} />;
}
