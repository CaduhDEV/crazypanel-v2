import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino dos links de e-mail (convite e recuperação de senha).
 * - token_hash + type: templates do projeto (funciona em qualquer navegador/dispositivo).
 * - code: fluxo PKCE (só no navegador que pediu).
 * - nada disso: o acesso veio depois do # (fluxo implicit, links antigos) ou o
 *   Supabase mandou um erro; /auth/callback lê o # no navegador e mostra o
 *   que aconteceu (o navegador mantém o # no redirecionamento).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), type);

  if (searchParams.get("error") || searchParams.get("error_code")) {
    return NextResponse.redirect(`${origin}/auth/callback?erro=${encodeURIComponent(searchParams.get("error_code") ?? "invalido")}`);
  }

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/auth/callback?erro=${encodeURIComponent(error.code ?? "invalido")}`);
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/auth/callback?erro=outro-navegador`);
  }

  return NextResponse.redirect(`${origin}/auth/callback`);
}

// Convite e recuperação sempre terminam definindo a senha. Só aceita caminhos
// internos (evita open redirect).
function safeNext(next: string | null, type: EmailOtpType | null): string {
  if (type === "invite" || type === "recovery") return "/definir-senha";
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
