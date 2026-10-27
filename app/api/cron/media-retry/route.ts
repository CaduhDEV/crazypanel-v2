import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeIncomingMedia } from "@/lib/webhook/process";

export const maxDuration = 60;

/** A fileURL da uazapi vale 2 dias: depois disso não adianta tentar. */
const WINDOW_MS = 47 * 60 * 60 * 1000;
/** "Baixando" há mais que isso: a função foi encerrada no meio. */
const STUCK_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const BUDGET_MS = 45_000;

// Rotina: tenta de novo as mídias recebidas que falharam ou travaram
// (pg_cron a cada 5 min). Chamada com "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });

  const db = createAdminClient();
  const started = Date.now();
  const { data } = await db
    .from("messages")
    .select("id, wa_id, media_mime, media_name, media_status, created_at")
    .in("media_status", ["failed", "pending"])
    .eq("from_me", false)
    .not("wa_id", "is", null)
    .lt("media_attempts", MAX_ATTEMPTS)
    .gte("sent_at", new Date(started - WINDOW_MS).toISOString())
    .order("sent_at", { ascending: false })
    .limit(20);

  const rows = ((data ?? []) as { id: string; wa_id: string; media_mime: string | null; media_name: string | null; media_status: string; created_at: string }[]).filter(
    (m) => m.media_status === "failed" || started - Date.parse(m.created_at) > STUCK_MS,
  );
  let fixed = 0;
  let tried = 0;
  for (const m of rows) {
    if (Date.now() - started > BUDGET_MS) break;
    tried++;
    if (await storeIncomingMedia(db, m.id, { waId: m.wa_id, mime: m.media_mime, fileName: m.media_name }, { attempts: 1 })) fixed++;
  }
  return NextResponse.json({ tried, fixed, waiting: rows.length - tried });
}
