import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleAgentResult } from "@/lib/ai/classify";

export const maxDuration = 60;

const MAX_BODY_BYTES = 512 * 1024;

// Retorno do agente de IA do CRM: categoria, subcategoria, quem resolveu, resumo
// e se precisa da equipe. Autentica pela chave AI_WEBHOOK_SECRET (?key= no
// callback_url, ou o cabeçalho x-ai-key). Aceita um resultado ou vários, em JSON
// ou como formulário (o JSON num dos campos).
//
// Toda chamada fica registrada em webhook_events (event_type "ai_callback"),
// inclusive as recusadas, para saber o que o agente mandou.
export async function POST(request: NextRequest) {
  const secret = process.env.AI_WEBHOOK_SECRET;
  const provided = request.nextUrl.searchParams.get("key") ?? request.headers.get("x-ai-key") ?? "";
  const contentType = request.headers.get("content-type") ?? "";
  const raw = await request.text();

  const log = (status: number, result: unknown) =>
    createAdminClient()
      .from("webhook_events")
      .insert({
        event_type: "ai_callback",
        payload: {
          status,
          content_type: contentType,
          key_sent: !!provided,
          body: raw.slice(0, 4000),
          result,
        },
        processed_at: new Date().toISOString(),
      })
      .then(({ error }) => error && console.error("[ai] log do retorno:", error.message));

  if (!secret || !safeEqual(provided, secret)) {
    await log(401, provided ? "chave errada" : "sem chave (?key= ou x-ai-key)");
    return NextResponse.json({ ok: false, error: "não autorizado" }, { status: 401 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    await log(413, "corpo grande demais");
    return NextResponse.json({ ok: false, error: "corpo grande demais" }, { status: 413 });
  }

  // Formulário (a=1&b=2): os valores viram o corpo, e o JSON é achado dentro deles.
  let body: unknown = raw;
  if (/x-www-form-urlencoded/i.test(contentType) || (!raw.trim().startsWith("{") && !raw.trim().startsWith("[") && /^[\w.%-]+=/.test(raw.trim()))) {
    body = Object.fromEntries(new URLSearchParams(raw));
  }
  // Sem corpo: os campos podem vir na própria URL (?request_id=…&category=…&topic=…).
  if (!raw.trim()) {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    delete params.key;
    body = params;
  }

  try {
    const results = await handleAgentResult(body);
    const okCount = results.filter((r) => r.ok).length;
    const status = okCount > 0 ? 200 : 422;
    await log(status, results);
    return NextResponse.json({ ok: okCount > 0, results }, { status });
  } catch (e) {
    console.error("[ai] retorno do agente:", e);
    await log(500, e instanceof Error ? e.message : "falha ao processar");
    return NextResponse.json({ ok: false, error: "falha ao processar" }, { status: 500 });
  }
}
