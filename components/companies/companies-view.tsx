"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronLeft, ChevronRight, Download, Loader2, Search } from "lucide-react";
import type { CompanySort } from "@/lib/leads/query";
import { formatRelative, formatTaxId, pluralize } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Tip } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CompanyDialog } from "@/components/companies/company-dialog";

export interface CompanyRow {
  tenant_id: string | null;
  company_id: string | null;
  name: string;
  cnpj: string | null;
  image_url: string | null;
  niche: string | null;
  email: string | null;
  users_count: number;
  users_with_phone: number;
  users_in_community: number;
  leads_count: number;
  last_activity_at: string | null;
}

const SORT_OPTIONS: { value: CompanySort; label: string }[] = [
  { value: "atividade", label: "Acesso mais recente" },
  { value: "usuarios", label: "Mais usuários" },
  { value: "nome", label: "Nome (A–Z)" },
];

export const companyKey = (c: Pick<CompanyRow, "tenant_id" | "company_id">) => c.tenant_id ?? c.company_id ?? "";

export function CompaniesView({
  rows,
  total,
  page,
  pageSize,
  q,
  sort,
  error,
}: {
  rows: CompanyRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  sort: CompanySort;
  error: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<CompanyRow | null>(null);

  const update = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (!("pagina" in patch)) params.delete("pagina");
    startNav(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  };

  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => update({ q: search.trim() || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const exportParams = new URLSearchParams(Object.entries({ q, ordem: sort === "atividade" ? "" : sort }).filter(([, v]) => v)).toString();

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, tenant ou CNPJ" className="pl-8" aria-label="Buscar empresas" />
        </div>
        <Select value={sort} onValueChange={(v) => update({ ordem: v === "atividade" ? null : v })}>
          <SelectTrigger className="w-52" aria-label="Ordenar empresas">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {navigating && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-sm text-muted-foreground tabular">{pluralize(total, "resultado", "resultados")}</span>
        <Tip label={total > 0 ? `Baixa as ${total.toLocaleString("pt-BR")} empresas com a busca atual` : "Nada para exportar"}>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/export/empresas${exportParams ? `?${exportParams}` : ""}`} download>
              <Download /> Exportar planilha
            </a>
          </Button>
        </Tip>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold w-[30%]">Empresa</th>
              <th className="px-4 py-2.5 font-semibold w-[15%]">CNPJ</th>
              <th className="px-4 py-2.5 text-right font-semibold w-[9%]">Usuários</th>
              <th className="px-4 py-2.5 font-semibold w-[16%]">Na comunidade</th>
              <th className="px-4 py-2.5 text-right font-semibold w-[12%]">Leads vinculados</th>
              <th className="px-4 py-2.5 font-semibold w-[18%]">Último acesso ao CRM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = r.users_with_phone ? Math.round((r.users_in_community / r.users_with_phone) * 100) : 0;
              return (
                <tr
                  key={companyKey(r)}
                  onClick={() => setSelected(r)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(r))}
                  tabIndex={0}
                  role="button"
                  aria-label={`Abrir ${r.name}`}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                >
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={r.name} src={r.image_url} size="sm" className="rounded-md" />
                      <span className="flex min-w-0 flex-col">
                        <span className="max-w-72 truncate font-medium">{r.name}</span>
                        <span className="max-w-72 truncate font-mono text-[11px] text-muted-foreground">
                          {r.niche ? `${r.niche} · ` : ""}
                          {r.tenant_id ?? "sem tenant"}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12.5px] text-muted-foreground tabular">{r.cnpj ? formatTaxId(r.cnpj) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular">{r.users_count.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2.5">
                    {r.users_with_phone === 0 ? (
                      <span className="text-muted-foreground">sem telefones</span>
                    ) : (
                      <Tip label={`${r.users_in_community} de ${r.users_with_phone} usuários com telefone estão em algum grupo`}>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                          </span>
                          <span className="text-xs tabular text-muted-foreground">
                            {r.users_in_community}/{r.users_with_phone}
                          </span>
                        </span>
                      </Tip>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{r.leads_count}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.last_activity_at ? formatRelative(r.last_activity_at) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <EmptyState
            icon={Building2}
            title={error ? "Não foi possível carregar as empresas" : "Nenhuma empresa encontrada"}
            description={
              error ? "Tente novamente em instantes." : q ? "Ajuste a busca." : "As empresas vêm da base do Gleap (Para convidar → Importar tudo) e dos vínculos feitos em Leads."
            }
          />
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground tabular">
            Página {page} de {pages}
          </span>
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => update({ pagina: String(page - 1) })} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => update({ pagina: String(page + 1) })} aria-label="Próxima página">
            <ChevronRight />
          </Button>
        </div>
      )}

      <CompanyDialog company={selected} onClose={() => setSelected(null)} />
    </main>
  );
}
