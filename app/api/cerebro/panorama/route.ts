import { NextResponse, type NextRequest } from "next/server";
import { brainRequest } from "@/lib/brain/auth";
import { brainPanorama } from "@/lib/brain/query";

export const dynamic = "force-dynamic";

// Ferramenta MCP panorama_comunidade: o que está acontecendo na comunidade nos
// últimos dias (padrão 7, até 90). Tudo sai do banco, sem IA.
async function handle(request: NextRequest) {
  const auth = await brainRequest(request);
  if (auth instanceof NextResponse) return auth;
  const dias = Math.min(90, Math.max(1, Math.round(Number(auth.params.dias) || 7)));
  try {
    return NextResponse.json(await brainPanorama(dias));
  } catch (e) {
    console.error("[cérebro] panorama:", e);
    return NextResponse.json({ erro: "falha ao montar o panorama" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
