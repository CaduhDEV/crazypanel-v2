import { createClient, type AuthError } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/site-url";

// Somente servidor. Envia o link para (re)definir a senha.
//
// Fluxo "implicit" de propósito: o link traz o acesso no próprio endereço e
// funciona em qualquer navegador ou aparelho. No fluxo padrão do servidor (PKCE)
// o link só vale no navegador que pediu: quem pede no computador e abre o
// e-mail no celular, ou o admin que reenvia o acesso de outro atendente, cairia
// sempre em "link inválido". A página /auth/callback recebe o link e abre a
// sessão.
export async function sendPasswordLink(email: string): Promise<AuthError | null> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${await siteUrl()}/auth/callback` });
  return error;
}
