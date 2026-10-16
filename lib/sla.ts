import type { AppSettings } from "@/lib/types";

export type SlaState = "answered" | "ok" | "warn" | "breach";

export interface SlaInfo {
  state: SlaState;
  /** Segundos desde a mensagem mais antiga sem resposta (0 se respondido). */
  elapsed: number;
  /** Segundos até estourar (0 se já estourou ou respondido). */
  remaining: number;
}

/** SLA de um atendimento: conta a partir de waiting_since; pausa quando respondido. */
export function slaInfo(
  waitingSince: string | null,
  now: number,
  settings: Pick<AppSettings, "sla_seconds" | "sla_warning_percent">,
): SlaInfo {
  if (!waitingSince) return { state: "answered", elapsed: 0, remaining: 0 };
  const elapsed = Math.max(0, Math.floor((now - new Date(waitingSince).getTime()) / 1000));
  const limit = settings.sla_seconds;
  const remaining = Math.max(0, limit - elapsed);
  const state: SlaState =
    elapsed >= limit ? "breach" : elapsed >= (limit * settings.sla_warning_percent) / 100 ? "warn" : "ok";
  return { state, elapsed, remaining };
}

export const SLA_LABELS: Record<SlaState, string> = {
  answered: "Respondido",
  ok: "No prazo",
  warn: "Em alerta",
  breach: "Estourado",
};

/** Ordem da fila: estourados e mais antigos primeiro; respondidos por último. */
export function compareQueue(a: { waiting_since: string | null; last_message_at: string }, b: typeof a): number {
  if (a.waiting_since && b.waiting_since) return a.waiting_since.localeCompare(b.waiting_since);
  if (a.waiting_since) return -1;
  if (b.waiting_since) return 1;
  return b.last_message_at.localeCompare(a.last_message_at);
}
