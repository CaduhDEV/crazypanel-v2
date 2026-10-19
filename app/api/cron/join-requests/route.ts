import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { syncWhatsAppJoinRequests } from "@/lib/community/sync";

export const maxDuration = 60;

// Rotina frequente: lê os pedidos de entrada feitos pelo WhatsApp nos grupos da
// comunidade. Vercel Cron envia "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  try {
    return NextResponse.json(await syncWhatsAppJoinRequests());
  } catch (e) {
    console.error("[cron] join-requests:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "falhou" }, { status: 500 });
  }
}
