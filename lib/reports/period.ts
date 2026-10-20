// Período das métricas e do PDF, pela URL: ?dias=7 (termina agora) ou
// ?de=AAAA-MM-DD&ate=AAAA-MM-DD (dias inteiros no fuso de Brasília).
// Sem dependência de servidor: a tela usa para montar os links.

export type MetricsPeriod = { days: number } | { from: string; to: string };

export const PRESET_DAYS = [7, 30, 90] as const;
export const MAX_RANGE_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const startOfDay = (date: string) => new Date(`${date}T00:00:00-03:00`);

/** Lê o período da URL. Intervalo inválido (datas trocadas, longo demais) volta para o padrão. */
export function parsePeriod(params: Record<string, string | undefined | null>, presets: readonly number[] = PRESET_DAYS, fallback = 7): MetricsPeriod {
  const from = params.de ?? "";
  const to = params.ate ?? "";
  if (DATE_RE.test(from) && DATE_RE.test(to)) {
    const start = startOfDay(from).getTime();
    const end = startOfDay(to).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && (end - start) / DAY_MS < MAX_RANGE_DAYS) return { from, to };
  }
  const days = Number(params.dias);
  return { days: presets.includes(days) ? days : fallback };
}

/** Início e fim (exclusivo). Intervalo: até o fim do dia "até", sem passar da próxima hora. */
export function periodRange(p: MetricsPeriod, now = new Date()): { inicio: Date; fim: Date } {
  if ("days" in p) {
    const fim = new Date(now.getTime() + 3_600_000); // até a hora atual inclusive
    fim.setMinutes(0, 0, 0);
    return { inicio: new Date(fim.getTime() - p.days * DAY_MS), fim };
  }
  const cap = new Date(now.getTime() + 3_600_000);
  cap.setMinutes(0, 0, 0);
  const end = new Date(startOfDay(p.to).getTime() + DAY_MS);
  return { inicio: startOfDay(p.from), fim: end < cap ? end : cap };
}

/** Parâmetros de URL do período (para links e a API). */
export function periodQuery(p: MetricsPeriod): string {
  return "days" in p ? `dias=${p.days}` : `de=${p.from}&ate=${p.to}`;
}

/** Quantos dias o período cobre (arredondado para cima). */
export function periodDays(p: MetricsPeriod): number {
  if ("days" in p) return p.days;
  return Math.round((startOfDay(p.to).getTime() - startOfDay(p.from).getTime()) / DAY_MS) + 1;
}

const short = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" });

/** "7 dias" ou "01/10/26 a 15/10/26". */
export function periodLabel(p: MetricsPeriod): string {
  if ("days" in p) return `${p.days} dias`;
  const f = (d: string) => short.format(new Date(`${d}T12:00:00-03:00`));
  return p.from === p.to ? f(p.from) : `${f(p.from)} a ${f(p.to)}`;
}
