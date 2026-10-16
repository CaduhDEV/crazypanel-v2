import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { LeadsView, type LeadRow } from "@/components/leads/leads-view";
import { leadsQuery, parseLeadFilters } from "@/lib/leads/query";
import { GleapScanDialog } from "@/components/leads/gleap-scan-dialog";
import { CrmScanDialog } from "@/components/leads/crm-scan-dialog";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };

const PAGE_SIZE = 10;

type SearchParams = Promise<{ q?: string; grupo?: string; vinculo?: string; pagina?: string }>;

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const filters = parseLeadFilters(params);
  const { q, group, link } = filters;
  const page = Math.max(1, Number(params.pagina) || 1);

  const supabase = await createClient();
  const query = leadsQuery(
    supabase,
    filters,
    // "*": colunas novas (ex.: companies_count) não quebram a página antes da migration subir.
    "*, company:companies(id, name, external_id, cnpj)",
    { count: true },
  );

  const from = (page - 1) * PAGE_SIZE;
  const [result, groups, linked, unlinked, partners, team] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    supabase.from("wa_groups").select("jid, name, listening").order("name"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).not("company_id", "is", null),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("kind", "customer").is("company_id", null),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("kind", "partner"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("kind", "team"),
  ]);

  const total = result.count ?? 0;
  const allContacts = (linked.count ?? 0) + (unlinked.count ?? 0) + (partners.count ?? 0) + (team.count ?? 0);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Pessoas dos grupos. Cada cliente precisa estar vinculado à empresa dele para os atendimentos contarem na conta certa."
        meta={
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground tabular">
            {pluralize(allContacts, "contato", "contatos")}
          </span>
        }
        actions={
          <>
            <GleapScanDialog />
            <CrmScanDialog />
          </>
        }
      />
      <LeadsView
        rows={(result.data ?? []) as unknown as LeadRow[]}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        filters={{ q, group, link }}
        groups={(groups.data ?? []) as { jid: string; name: string | null; listening: boolean }[]}
        stats={{
          linked: linked.count ?? 0,
          unlinked: unlinked.count ?? 0,
          partners: partners.count ?? 0,
          team: team.count ?? 0,
        }}
        error={result.error?.message ?? null}
      />
    </>
  );
}
