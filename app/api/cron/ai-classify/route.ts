import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { aiConfigured, closeStaleClears, dispatchIdleTickets } from "@/lib/ai/classify";

export const maxDuration = 60;

// Rotina: manda os atendimentos parados para o agente de IA (pg_cron a cada 30 min).
// Também finaliza o que o Limpar fila mandou e a IA não devolveu em 15 min
// (?so=limpeza, a cada 5 min, faz só essa parte).
// Chamada com "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  try {
    const cleared = await closeStaleClears();
    if (request.nextUrl.searchParams.get("so") === "limpeza") return NextResponse.json({ cleared });
    const settings = await getSettings();
    if (!settings.ai_enabled || !aiConfigured()) return NextResponse.json({ cleared, skipped: true });
    return NextResponse.json({ cleared, ...(await dispatchIdleTickets()) });
  } catch (e) {
    console.error("[cron] ai-classify:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "falhou" }, { status: 500 });
  }
}
