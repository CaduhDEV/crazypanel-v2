import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { loadCommunityReport, reportPeriod } from "@/lib/reports/data";
import { PageHeader } from "@/components/app/page-header";
import { MetricsView } from "@/components/metrics/metrics-view";

export const metadata: Metadata = { title: "Métricas" };

const PERIODS = [7, 30, 90] as const;

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function MetricasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const days = PERIODS.find((d) => d === Number(params.dias)) ?? 7;
  const { inicio, fim } = reportPeriod(days);

  let report = null;
  let error: string | null = null;
  try {
    report = await loadCommunityReport(inicio, fim);
  } catch (e) {
    error = e instanceof Error ? e.message : "Não foi possível calcular as métricas.";
  }

  return (
    <>
      <PageHeader
        title="Métricas das comunidades"
        description="Quanto a comunidade resolve sozinha, onde a equipe entra e o que mais gera dúvida. As mesmas definições do relatório oficial em PDF."
      />
      <MetricsView report={report} days={days} periods={[...PERIODS]} error={error} />
    </>
  );
}
