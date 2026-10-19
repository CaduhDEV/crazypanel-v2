// Formatação das métricas (página e telão).
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export const fPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${nf1.format(v)}%`);
export const fMin = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 120 ? `${nf1.format(v / 60)} h` : `${nf1.format(v)} min`);
export const fInt = (v: number) => nf0.format(v);
export const fDec = (v: number) => nf1.format(v);

/** Variação entre períodos, com o sentido que é melhora. */
export function delta(cur: number | null, prev: number | null, better: "up" | "down", unit: "p.p." | "min" | "") {
  if (cur === null || prev === null) return { text: "sem base anterior", tone: "neutral" as const };
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return { text: "estável", tone: "neutral" as const };
  const good = better === "up" ? d > 0 : d < 0;
  return { text: `${d > 0 ? "+" : "−"}${nf1.format(Math.abs(d))}${unit ? ` ${unit}` : ""}`, tone: good ? ("good" as const) : ("bad" as const) };
}
