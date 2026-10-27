import { after, type NextRequest } from "next/server";
import { agentCallback } from "@/lib/ai/callback";
import { dispatchBrain, handleBrainResult } from "@/lib/brain/core";
import { getSettings } from "@/lib/settings";

export const maxDuration = 60;

// Retorno do agente do cérebro: por atendimento, um item novo, a confirmação
// de um item ou a resposta nova dele (ver lib/brain/core.ts). Com o cérebro
// ligado, cada retorno já manda o próximo lote.
export async function POST(request: NextRequest) {
  const response = await agentCallback(request, "ai_brain_callback", handleBrainResult);
  if (response.ok) {
    after(async () => {
      if ((await getSettings()).brain_enabled) await dispatchBrain().catch((e) => console.error("[cérebro] próximo lote:", e));
    });
  }
  return response;
}
