import { NextResponse, type NextRequest } from "next/server";
import { brainRequest } from "@/lib/brain/auth";
import { searchBrain } from "@/lib/brain/query";

export const dynamic = "force-dynamic";

// Ferramenta MCP consultar_cerebro: busca no conhecimento da comunidade.
// Parâmetros: pergunta (ou q), categoria e limite (opcionais).
async function handle(request: NextRequest) {
  const auth = await brainRequest(request);
  if (auth instanceof NextResponse) return auth;
  const pergunta = (auth.params.pergunta ?? auth.params.q ?? "").trim();
  if (pergunta.length < 2) return NextResponse.json({ erro: "informe a pergunta" }, { status: 400 });
  try {
    const limite = Number(auth.params.limite);
    return NextResponse.json(await searchBrain({ pergunta, categoria: auth.params.categoria?.trim() || null, limite: Number.isFinite(limite) ? limite : 5 }));
  } catch (e) {
    console.error("[cérebro] busca:", e);
    return NextResponse.json({ erro: "falha na busca" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
