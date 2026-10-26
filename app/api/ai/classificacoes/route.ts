import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { handleAgentResult } from "@/lib/ai/classify";

export const maxDuration = 60;

const MAX_BODY_BYTES = 512 * 1024;

// Retorno do agente de IA do CRM: categoria, subcategoria, quem resolveu, resumo
// e se precisa da equipe. Autentica pela chave AI_WEBHOOK_SECRET (?key= no
// callback_url, ou o cabeçalho x-ai-key). Aceita um resultado ou vários.
export async function POST(request: NextRequest) {
  const secret = process.env.AI_WEBHOOK_SECRET;
  const provided = request.nextUrl.searchParams.get("key") ?? request.headers.get("x-ai-key") ?? "";
  if (!secret || !safeEqual(provided, secret)) return NextResponse.json({ ok: false, error: "não autorizado" }, { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false, error: "corpo grande demais" }, { status: 413 });

  try {
    const results = await handleAgentResult(raw);
    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: okCount > 0, results }, { status: okCount > 0 ? 200 : 422 });
  } catch (e) {
    console.error("[ai] retorno do agente:", e);
    return NextResponse.json({ ok: false, error: "falha ao processar" }, { status: 500 });
  }
}
