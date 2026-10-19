import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { loadMetrics } from "@/lib/reports/data";
import { TvView } from "@/components/metrics/tv-view";

export const metadata: Metadata = { title: "Telão · Métricas" };

type SearchParams = Promise<Record<string, string | undefined>>;

// Modo telão: métricas em tempo real para a TV do escritório (fora do layout do painel).
export default async function TelaoPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const days = [1, 7, 30].find((d) => d === Number(params.dias)) ?? 7;
  const initial = await loadMetrics(days);
  return <TvView initial={initial} />;
}
