import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_SORTS, companiesQuery, type CompanySort } from "@/lib/leads/query";
import { PageHeader } from "@/components/app/page-header";
import { CompaniesView, type CompanyRow } from "@/components/companies/companies-view";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Empresas" };

const PAGE_SIZE = 12;

type SearchParams = Promise<{ q?: string; ordem?: string; pagina?: string }>;

export default async function EmpresasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 80) ?? "";
  const sort = (COMPANY_SORTS.includes(params.ordem as CompanySort) ? params.ordem : "atividade") as CompanySort;
  const page = Math.max(1, Number(params.pagina) || 1);
  const supabase = await createClient();

  const from = (page - 1) * PAGE_SIZE;
  const result = await companiesQuery(supabase, q, sort, { count: true }).range(from, from + PAGE_SIZE - 1);
  const total = result.count ?? 0;

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Clientes do CRM (tenants): quem tem acesso a cada conta e quem já está nas comunidades."
        meta={
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground tabular">
            {pluralize(total, "empresa", "empresas")}
          </span>
        }
      />
      <CompaniesView
        rows={(result.data ?? []) as CompanyRow[]}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        q={q}
        sort={sort}
        error={result.error?.message ?? null}
      />
    </>
  );
}
