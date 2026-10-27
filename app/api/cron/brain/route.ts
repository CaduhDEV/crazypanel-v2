import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { brainConfigured, dispatchBrain } from "@/lib/brain/core";

export const maxDuration = 60;

// Rotina de garantia do cérebro (pg_cron a cada 15 min): retoma a leitura se o
// encadeamento (cada retorno manda o próximo lote) parar.
// Chamada com "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  try {
    if (!(await getSettings()).brain_enabled || !brainConfigured()) return NextResponse.json({ skipped: true });
    return NextResponse.json(await dispatchBrain());
  } catch (e) {
    console.error("[cron] brain:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "falhou" }, { status: 500 });
  }
}
