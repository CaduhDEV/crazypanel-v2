import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/crypto";
import { processWebhookEvent } from "@/lib/webhook/process";

// Recebe os eventos da uazapi. Segue a recomendação da API: grava o evento,
// responde 200 na hora e processa depois (after), sem segurar a fila deles.

export const maxDuration = 60;

const MAX_BODY_BYTES = 2 * 1024 * 1024;

// O segredo muda raramente: evita uma leitura do banco por evento.
let secretCache: { value: string; at: number } | null = null;

async function webhookSecret(): Promise<string> {
  if (secretCache && Date.now() - secretCache.at < 60_000) return secretCache.value;
  const { data } = await createAdminClient().from("whatsapp_instance").select("webhook_secret").eq("id", 1).single();
  secretCache = { value: data?.webhook_secret ?? "", at: Date.now() };
  return secretCache.value;
}

export async function POST(request: NextRequest) {
  const provided = request.nextUrl.searchParams.get("secret") ?? "";
  const expected = await webhookSecret();
  if (!expected || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload grande demais" }, { status: 413 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // O token da instância vem no corpo: nunca vai para o banco nem para logs.
  delete payload.token;
  const eventType = String(payload.EventType ?? payload.event ?? "desconhecido");

  const db = createAdminClient();
  const { data, error } = await db
    .from("webhook_events")
    .insert({ event_type: eventType, payload })
    .select("id")
    .single();

  if (error) {
    console.error("[webhook] não foi possível gravar o evento:", error.message);
    // 500 faz a uazapi registrar o erro em /webhook/errors para diagnóstico.
    return NextResponse.json({ error: "falha ao registrar" }, { status: 500 });
  }

  after(() => processWebhookEvent(data.id));

  return NextResponse.json({ ok: true });
}
