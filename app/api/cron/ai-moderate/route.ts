import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { dispatchModeration, moderationConfigured } from "@/lib/ai/moderate";

export const maxDuration = 60;

// Rotina: manda as mensagens novas dos grupos para o agente de moderação
// (pg_cron a cada 10 min; o normal é ir na chegada, pelo webhook). Chamada com "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  try {
    const settings = await getSettings();
    if (!settings.ai_moderation_enabled || !moderationConfigured()) return NextResponse.json({ skipped: true });
    return NextResponse.json(await dispatchModeration());
  } catch (e) {
    console.error("[cron] ai-moderate:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "falhou" }, { status: 500 });
  }
}
