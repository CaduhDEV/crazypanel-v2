import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { aiConfigured, dispatchIdleTickets } from "@/lib/ai/classify";

export const maxDuration = 60;

// Rotina: manda os atendimentos parados para o agente de IA (pg_cron a cada 30 min).
// Chamada com "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  const settings = await getSettings();
  if (!settings.ai_enabled || !aiConfigured()) return NextResponse.json({ skipped: true });
  try {
    return NextResponse.json(await dispatchIdleTickets());
  } catch (e) {
    console.error("[cron] ai-classify:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "falhou" }, { status: 500 });
  }
}
