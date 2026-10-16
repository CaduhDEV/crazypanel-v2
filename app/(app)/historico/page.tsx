import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchHistory, parseHistoryFilters } from "@/lib/history/query";
import { PageHeader } from "@/components/app/page-header";
import { HistoryView, type HistoryRow } from "@/components/history/history-view";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Histórico" };

const PAGE_SIZE = 10;

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function HistoricoPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const filters = parseHistoryFilters(params);
  const page = Math.max(1, Number(params.pagina) || 1);
  const supabase = await createClient();

  const from = (page - 1) * PAGE_SIZE;
  const [result, groups] = await Promise.all([
    fetchHistory(supabase, filters, [from, from + PAGE_SIZE - 1], { count: true }),
    supabase.from("wa_groups").select("jid, name").order("name"),
  ]);
  const total = result.count ?? 0;

  return (
    <>
      <PageHeader
        title="Histórico de atendimentos"
        description="Todos os atendimentos, abertos e finalizados. Abra um para ler a conversa completa ou exportar em PDF."
        meta={
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground tabular">
            {pluralize(total, "atendimento", "atendimentos")}
          </span>
        }
      />
      <HistoryView
        rows={(result.data ?? []) as unknown as HistoryRow[]}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        filters={filters}
        groups={(groups.data ?? []) as { jid: string; name: string | null }[]}
        error={result.error?.message ?? null}
      />
    </>
  );
}
