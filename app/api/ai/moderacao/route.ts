import type { NextRequest } from "next/server";
import { handleModerationResult } from "@/lib/ai/moderate";
import { agentCallback } from "@/lib/ai/callback";

export const maxDuration = 60;

// Retorno do agente de moderação: as mensagens do lote que violam as regras da
// comunidade (cada uma vira uma flag "Moderado por IA"). Ver lib/ai/callback.ts.
export async function POST(request: NextRequest) {
  return agentCallback(request, "ai_moderation_callback", handleModerationResult);
}
