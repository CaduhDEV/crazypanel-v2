import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActionError } from "@/lib/action";
import type { Profile } from "@/lib/types";

/**
 * Perfil do usuário logado (uma leitura por request). Retorna null sem sessão
 * ou com a conta desativada (a RLS de profiles só libera membros ativos).
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle<Profile>();

  return profile?.active ? profile : null;
});

/** Páginas: exige membro ativo; senão encerra a sessão e volta ao login. */
export async function requireMemberPage(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/sair?motivo=sem-acesso");
  return profile;
}

/** Páginas de administração: atendente volta para o atendimento. */
export async function requireAdminPage(): Promise<Profile> {
  const profile = await requireMemberPage();
  if (profile.role !== "admin") redirect("/atendimento");
  return profile;
}

/** Server Actions: lança ActionError (vira mensagem na tela). */
export async function requireMember(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) throw new ActionError("Sua sessão expirou. Entre novamente.");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireMember();
  if (profile.role !== "admin") throw new ActionError("Apenas administradores podem fazer isso.");
  return profile;
}
