import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { loadMetrics } from "@/lib/reports/data";
import { PageHeader } from "@/components/app/page-header";
import { MetricsView } from "@/components/metrics/metrics-view";

export const metadata: Metadata = { title: "Métricas" };

const PERIODS = [7, 30, 90] as const;

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function MetricasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const days = PERIODS.find((d) => d === Number(params.dias)) ?? 7;

  const result = await loadMetrics(days).then(
    (data) => ({ data, error: null }),
    (e: unknown) => ({ data: null, error: e instanceof Error ? e.message : "Não foi possível calcular as métricas." }),
  );

  return (
    // No desktop a página cabe na tela: as métricas trocam por páginas, sem rolar.
    <div className="flex flex-1 flex-col lg:h-dvh lg:max-h-dvh lg:overflow-hidden">
      <PageHeader title="Métricas das comunidades" description="O que a comunidade resolve sozinha e onde a equipe entra. Use as setas para trocar de página." />
      {result.data ? (
        <MetricsView key={days} initial={result.data} periods={[...PERIODS]} />
      ) : (
        <p className="m-6 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{result.error}</p>
      )}
    </div>
  );
}
