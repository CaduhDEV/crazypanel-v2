import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino dos links de e-mail (convite e recuperação de senha).
 * - token_hash + type: templates do projeto (funciona em qualquer navegador/dispositivo).
 * - code: template padrão do Supabase (PKCE, mesmo navegador que pediu).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), type);

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?erro=link-invalido`);
}

// Convite e recuperação sempre terminam definindo a senha. Só aceita caminhos
// internos (evita open redirect).
function safeNext(next: string | null, type: EmailOtpType | null): string {
  if (type === "invite" || type === "recovery") return "/definir-senha";
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
