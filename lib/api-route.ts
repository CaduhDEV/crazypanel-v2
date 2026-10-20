import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { ActionError } from "@/lib/action";
import type { Profile } from "@/lib/types";

/**
 * Rota da API para membros ativos: confere a sessão e converte os erros como o
 * runAction (ActionError vai para a tela como está; o resto vira mensagem genérica).
 */
export async function memberRoute<T>(fn: (profile: Profile) => Promise<T>): Promise<NextResponse> {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sua sessão expirou. Entre novamente." }, { status: 401 });
  try {
    return NextResponse.json((await fn(profile)) ?? null, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[api]", e);
    return NextResponse.json({ error: "Não foi possível concluir. Tente novamente." }, { status: 500 });
  }
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
