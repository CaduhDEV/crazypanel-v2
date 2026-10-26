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
  // Vazia = mensagem desligada (não é enviada).
  joinMsgNoCompany: z.string().trim().max(1000),
  joinMsgRejected: z.string().trim().max(1000),
  joinMsgAccepted: z.string().trim().max(1000),
  pushBreachBody: z.string().trim().min(1, { error: "Informe o texto do aviso de SLA estourado." }).max(300),
  memberReplyWindowMinutes: z.number().int().min(0).max(240),
  reportEnabled: z.boolean(),
  reportWeekday: z.number().int().min(0).max(6),
  reportHour: z.number().int().min(0).max(23),
  reportPeriodDays: z.number().int().min(1).max(90),
  reportRecipients: z.array(z.object({ id: z.uuid(), enabled: z.boolean(), whatsapp: z.string().max(40) })).max(200),
});

/** WhatsApp com DDI: 11 98765-4321 vira 5511987654321. */
function normalizeWhatsapp(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

export async function updateSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult<void>> {
  return runAction(settingsSchema, input, async (s) => {
    const admin = await requireAdmin();
    const recipients = s.reportRecipients.map((r) => ({ ...r, phone: normalizeWhatsapp(r.whatsapp) }));
    const invalid = recipients.find((r) => r.whatsapp.trim() && !r.phone);
    if (invalid) throw new ActionError(`Confira o WhatsApp "${invalid.whatsapp}" (DDD + número).`);
    const missing = recipients.filter((r) => r.enabled && !r.phone);
    if (missing.length) throw new ActionError("Informe o WhatsApp de todos os atendentes que recebem o relatório.");
    if (s.reportEnabled && !recipients.some((r) => r.enabled)) throw new ActionError("Escolha ao menos um atendente para receber o relatório.");
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
        join_msg_no_company: s.joinMsgNoCompany,
        join_msg_rejected: s.joinMsgRejected,
        join_msg_accepted: s.joinMsgAccepted,
        member_reply_window_minutes: s.memberReplyWindowMinutes,
        report_enabled: s.reportEnabled,
        report_weekday: s.reportWeekday,
        report_hour: s.reportHour,
        report_period_days: s.reportPeriodDays,
        report_recipients: recipients.filter((r) => r.enabled).map((r) => r.id),
        updated_by: admin.id,
      })
      .eq("id", 1);
    if (error) {
      if (/push_|burst_|join_msg_|report_|member_reply/.test(error.message)) throw new ActionError("Rode as migrations novas (npx supabase db push) antes de salvar.");
      throw error;
    }
    const db = createAdminClient();
    for (const r of recipients) {
      const { error: pe } = await db.from("profiles").update({ whatsapp: r.phone }).eq("id", r.id);
      if (pe) throw new ActionError(`Não foi possível salvar o WhatsApp: ${pe.message}`);
    }
    revalidatePath("/", "layout");
  });
}
