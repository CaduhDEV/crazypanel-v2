import type { NextRequest } from "next/server";
import { handleAgentResult } from "@/lib/ai/classify";
import { agentCallback } from "@/lib/ai/callback";

export const maxDuration = 60;

// Retorno do agente de IA do CRM: categoria, subcategoria, quem resolveu, resumo
// e se precisa da equipe. Um resultado ou vários (ver lib/ai/callback.ts).
export async function POST(request: NextRequest) {
  return agentCallback(request, "ai_callback", handleAgentResult);
}
