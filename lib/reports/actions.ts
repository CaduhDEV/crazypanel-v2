"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { issueReport, type Delivery } from "@/lib/reports/issue";

/** Admin: emite o relatório agora e envia para os atendentes escolhidos. */
export async function sendReportNow(): Promise<ActionResult<{ number: string; deliveries: Delivery[] }>> {
  return runAction(z.object({}), {}, async () => {
    const admin = await requireAdmin();
    try {
      const r = await issueReport({ trigger: "manual", requestedBy: admin.id });
      revalidatePath("/admin/configuracoes");
      revalidatePath("/metricas");
      return { number: r.number, deliveries: r.deliveries };
    } catch (e) {
      throw new ActionError(e instanceof Error ? e.message : "Não foi possível enviar o relatório.");
    }
  });
}
