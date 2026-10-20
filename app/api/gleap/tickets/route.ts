import { ActionError } from "@/lib/action";
import { memberRoute } from "@/lib/api-route";
import { gleapConfigured } from "@/lib/gleap";
import { syncGleapTickets, TICKETS_MIN_INTERVAL_MS } from "@/lib/gleap-sync";

export const maxDuration = 60;

// Uma sincronização por vez neste servidor: atendentes abrindo conversas ao
// mesmo tempo esperam a mesma em vez de consultar o Gleap cada um.
let running: Promise<{ rows: number; skipped: boolean }> | null = null;

// Renova os chamados ativos do Gleap (no máximo 1x por minuto, para toda a equipe).
export async function POST() {
  return memberRoute(async () => {
    if (!gleapConfigured()) throw new ActionError("Integração com o Gleap não configurada.");
    running ??= syncGleapTickets({ ifOlderThanMs: TICKETS_MIN_INTERVAL_MS }).finally(() => {
      running = null;
    });
    return running;
  });
}
