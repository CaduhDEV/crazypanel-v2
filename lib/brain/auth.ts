import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";

/**
 * Leitura do cérebro pelo agente do CRM (bloco de API do fluxo da ferramenta
 * MCP): chave AI_WEBHOOK_SECRET em ?key=, x-ai-key ou Authorization: Bearer.
 * Parâmetros na URL ou no corpo JSON (GET ou POST).
 */
export async function brainRequest(request: NextRequest): Promise<{ params: Record<string, string> } | NextResponse> {
  const secret = process.env.AI_WEBHOOK_SECRET;
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const provided = request.nextUrl.searchParams.get("key") ?? request.headers.get("x-ai-key") ?? bearer;
  if (!secret || !provided || !safeEqual(provided, secret)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });

  const params: Record<string, string> = Object.fromEntries(request.nextUrl.searchParams);
  delete params.key;
  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object") {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) if (v != null && typeof v !== "object") params[k] = String(v);
    }
  }
  return { params };
}
