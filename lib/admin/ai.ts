"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { aiConfigured, dispatchIdleTickets, type DispatchResult } from "@/lib/ai/classify";

const aiSchema = z.object({
  enabled: z.boolean(),
  autoClose: z.boolean(),
  minConfidence: z.number().min(0).max(1),
  idleMinutes: z.number().int().min(5, { error: "O mínimo é 5 minutos." }).max(1440, { error: "O máximo é 24 horas." }),
});

export async function updateAiSettings(input: z.input<typeof aiSchema>): Promise<ActionResult<void>> {
  return runAction(aiSchema, input, async ({ enabled, autoClose, minConfidence, idleMinutes }) => {
    const admin = await requireAdmin();
    const { error } = await createAdminClient()
      .from("app_settings")
      .update({ ai_enabled: enabled, ai_auto_close: autoClose, ai_min_confidence: minConfidence, ai_idle_minutes: idleMinutes, updated_by: admin.id })
      .eq("id", 1);
    if (error) {
      if (/ai_/.test(error.message)) throw new ActionError("Rode as migrations novas (npx supabase db push) antes de salvar.");
      throw error;
    }
    revalidatePath("/", "layout");
  });
}

/** Manda agora para o agente os atendimentos parados (mesmo com a rotina desligada). */
export async function sendIdleTicketsToAi(): Promise<ActionResult<DispatchResult>> {
  return runAction(z.object({}), {}, async () => {
    const admin = await requireAdmin();
    if (!aiConfigured()) throw new ActionError("Defina AI_AGENT_WEBHOOK_URL e AI_WEBHOOK_SECRET nas variáveis do painel.");
    const result = await dispatchIdleTickets({ actorId: admin.id });
    revalidatePath("/admin/configuracoes");
    return result;
  });
}
