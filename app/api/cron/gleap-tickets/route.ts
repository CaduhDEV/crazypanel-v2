import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { gleapConfigured } from "@/lib/gleap";
import { syncGleapTickets } from "@/lib/gleap-sync";

export const maxDuration = 60;

// Rotina frequente: renova a cópia local dos chamados ativos do Gleap.
// Vercel Cron envia "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  if (!gleapConfigured()) return NextResponse.json({ error: "GLEAP_API_TOKEN ausente" }, { status: 500 });

  try {
    return NextResponse.json(await syncGleapTickets());
  } catch (e) {
    console.error("[cron] gleap-tickets:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "falhou" }, { status: 500 });
  }
}
