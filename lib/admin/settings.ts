"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";

const settingsSchema = z.object({
  slaMinutes: z.number().int().min(1, { error: "O SLA mínimo é 1 minuto." }).max(1440, { error: "O SLA máximo é 24 horas." }),
  warningPercent: z.number().int().min(10).max(95),
  signMessages: z.boolean(),
  typingDelayMs: z.number().int().min(0).max(10_000),
  reopenWindowHours: z.number().int().min(0).max(720),
  joinWindowMinutes: z.number().int().min(0).max(1440),
  burstWindowSeconds: z.number().int().min(0).max(3600),
  pushEnabled: z.boolean(),
  pushSound: z.boolean(),
  pushNewTitle: z.string().trim().min(1, { error: "Informe o título do aviso de atendimento novo." }).max(120),
  pushNewBody: z.string().trim().min(1, { error: "Informe o texto do aviso de atendimento novo." }).max(300),
  pushBreachTitle: z.string().trim().min(1, { error: "Informe o título do aviso de SLA estourado." }).max(120),
  pushBreachBody: z.string().trim().min(1, { error: "Informe o texto do aviso de SLA estourado." }).max(300),
});

export async function updateSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult<void>> {
  return runAction(settingsSchema, input, async (s) => {
    const admin = await requireAdmin();
    const { error } = await createAdminClient()
      .from("app_settings")
      .update({
        sla_seconds: s.slaMinutes * 60,
        sla_warning_percent: s.warningPercent,
        sign_messages: s.signMessages,
        typing_delay_ms: s.typingDelayMs,
        reopen_window_hours: s.reopenWindowHours,
        join_window_minutes: s.joinWindowMinutes,
        burst_window_seconds: s.burstWindowSeconds,
        push_enabled: s.pushEnabled,
        push_sound: s.pushSound,
        push_new_title: s.pushNewTitle,
        push_new_body: s.pushNewBody,
        push_breach_title: s.pushBreachTitle,
        push_breach_body: s.pushBreachBody,
        updated_by: admin.id,
      })
      .eq("id", 1);
    if (error) {
      if (/push_|burst_/.test(error.message)) throw new ActionError("Rode as migrations novas (npx supabase db push) antes de salvar.");
      throw error;
    }
    revalidatePath("/", "layout");
  });
}
