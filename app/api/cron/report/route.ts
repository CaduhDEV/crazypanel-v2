import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { issueScheduledReport } from "@/lib/reports/issue";

export const maxDuration = 120;

// De hora em hora: emite e envia o relatório oficial no dia e hora configurados.
// Vercel Cron envia "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await issueScheduledReport());
  } catch (e) {
    console.error("[cron] report:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "falhou" }, { status: 500 });
  }
}
