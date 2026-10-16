"use server";

import { z } from "zod";
import { requireMember } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { gleapConfigured } from "@/lib/gleap";
import { syncGleapTickets, TICKETS_MIN_INTERVAL_MS } from "@/lib/gleap-sync";

/** Atualiza os chamados ativos do Gleap (no máximo 1x por minuto, para toda a equipe). */
export async function refreshGleapTickets(): Promise<ActionResult<{ rows: number; skipped: boolean }>> {
  return runAction(z.object({}), {}, async () => {
    await requireMember();
    if (!gleapConfigured()) throw new ActionError("Integração com o Gleap não configurada.");
    return syncGleapTickets({ ifOlderThanMs: TICKETS_MIN_INTERVAL_MS });
  });
}
