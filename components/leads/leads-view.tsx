"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Building2, ChevronLeft, ChevronRight, Contact as ContactIcon, Handshake, Download, Loader2, Search, ShieldCheck } from "lucide-react";
import { cn, contactLabel, formatPhone, formatRelative, formatTaxId, pluralize } from "@/lib/utils";
import type { Company, Contact } from "@/lib/types";
import { needsCompany } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Tip } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LinkContactDialog, type LinkTarget } from "@/components/leads/link-contact-dialog";
import { LeadProfileDialog } from "@/components/leads/lead-profile-dialog";

import type { LinkFilter } from "@/lib/leads/query";
export type { LinkFilter };

export type LeadRow = Pick<
  Contact,
  | "id"
  | "name"
  | "phone"
  | "lid"
  | "kind"
  | "company_id"
  | "message_count"
  | "last_message_at"
  | "first_seen_at"
  | "avatar_url"
  | "email"
  | "gleap_status"
  | "left_community_at"
  | "crm_tax_id"
  | "companies_count"
> & {
  company: Pick<Company, "id" | "name" | "external_id" | "cnpj"> | null;
  memberships: { group_jid: string; left_at: string | null }[];
};

const LINK_OPTIONS: { value: LinkFilter; label: string }[] = [
  { value: "todos", label: "Todos os vínculos" },
  { value: "sem-vinculo", label: "Sem vínculo" },
  { value: "vinculados", label: "Vinculados a empresa" },
  { value: "varias-empresas", label: "Em várias empresas" },
  { value: "parceiros", label: "Parceiros" },
  { value: "equipe", label: "Equipe" },
  { value: "ex-membros", label: "Ex-membros" },
];

const ALL = "__all__";

export function LeadsView({
  rows,
  total,
  page,
  pageSize,
  filters,
  groups,
  stats,
  error,
}: {
  rows: LeadRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { q: string; group: string; link: LinkFilter };
  groups: { jid: string; name: string | null; listening: boolean }[];
  stats: { linked: number; unlinked: number; partners: number; team: number };
  error: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [search, setSearch] = useState(filters.q);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const groupName = new Map(groups.map((g) => [g.jid, g.name ?? g.jid]));

  const update = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (!("pagina" in patch)) params.delete("pagina");
    startNav(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  };

  // Busca com debounce.
  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => update({ q: search.trim() || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Exportação: mesmos filtros da tela, sem a página.
  const exportParams = new URLSearchParams(
    Object.entries({ q: filters.q, grupo: filters.group, vinculo: filters.link === "todos" ? "" : filters.link }).filter(([, v]) => v),
  ).toString();
  const kpis = [
    { label: "Vinculados a empresa", value: stats.linked, icon: Building2, filter: "vinculados" as LinkFilter },
    { label: "Sem vínculo", value: stats.unlinked, icon: AlertTriangle, filter: "sem-vinculo" as LinkFilter, attention: stats.unlinked > 0 },
    { label: "Parceiros", value: stats.partners, icon: Handshake, filter: "parceiros" as LinkFilter },
    { label: "Equipe", value: stats.team, icon: ShieldCheck, filter: "equipe" as LinkFilter },
  ];

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => update({ vinculo: filters.link === k.filter ? null : k.filter })}
            aria-pressed={filters.link === k.filter}
            className={cn(
              "flex items-center gap-3 rounded-lg border bg-card p-3.5 text-left transition-colors hover:bg-accent/50",
              filters.link === k.filter ? "border-primary/60" : "border-border",
            )}
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-md",
                k.attention ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground",
              )}
            >
              <k.icon className="size-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-xl font-semibold tabular leading-tight">{k.value.toLocaleString("pt-BR")}</span>
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone" className="pl-8" aria-label="Buscar leads" />
        </div>
        <Select value={filters.link} onValueChange={(v) => update({ vinculo: v === "todos" ? null : v })}>
          <SelectTrigger className="w-52" aria-label="Filtrar por vínculo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINK_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.group || ALL} onValueChange={(v) => update({ grupo: v === ALL ? null : v })}>
          <SelectTrigger className="w-64" aria-label="Filtrar por grupo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os grupos escutados</SelectItem>
            {/* Só os grupos escutados (a lista completa ainda dá nome aos grupos na coluna "Grupos"). */}
            {groups
              .filter((g) => g.listening || g.jid === filters.group)
              .map((g) => (
                <SelectItem key={g.jid} value={g.jid}>
                  {g.name ?? g.jid}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {navigating && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-sm text-muted-foreground tabular">{pluralize(total, "resultado", "resultados")}</span>
        <Tip label={total > 0 ? `Baixa os ${total.toLocaleString("pt-BR")} leads com a busca e os filtros atuais` : "Nada para exportar"}>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/export/leads?${exportParams}`} download aria-disabled={total === 0}>
              <Download /> Exportar CSV
            </a>
          </Button>
        </Tip>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold w-[21%]">Lead</th>
              <th className="px-4 py-2.5 font-semibold w-[13%]">Telefone</th>
              <th className="px-4 py-2.5 font-semibold w-[21%]">Empresa</th>
              <th className="px-4 py-2.5 font-semibold w-[15%]">Grupos</th>
              <th className="px-4 py-2.5 text-right font-semibold w-[8%]">Mensagens</th>
              <th className="px-4 py-2.5 font-semibold w-[11%]">Última mensagem</th>
              <th className="px-4 py-2.5 w-[11%]" />
            </tr>
          </thead>
          <tbody className={cn(navigating && "opacity-60")}>
            {rows.map((r) => {
              const activeGroups = r.memberships.filter((m) => !m.left_at);
              const unlinked = needsCompany(r.kind) && !r.company_id;
              return (
                <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-accent/30">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={contactLabel(r)} src={r.avatar_url} size="sm" />
                      <span className="flex min-w-0 flex-col">
                        <button
                          type="button"
                          onClick={() => setProfileId(r.id)}
                          className="max-w-56 truncate text-left font-medium underline-offset-2 hover:text-primary hover:underline dark:hover:text-[#9fc0ef]"
                        >
                          {contactLabel(r)}
                        </button>
                        {r.email && <span className="max-w-56 truncate text-xs text-muted-foreground">{r.email}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[12.5px] text-muted-foreground tabular">
                    {r.phone ? formatPhone(r.phone) : <span title="O WhatsApp só informou o identificador @lid">@lid {r.lid?.slice(0, 8)}…</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.company ? (
                      <span className="flex flex-col">
                        <span className="flex items-center gap-1.5">
                          <span className="max-w-52 truncate">{r.company.name}</span>
                          {r.kind !== "customer" && <Badge variant="primary">{r.kind === "partner" ? "Parceiro" : "Equipe"}</Badge>}
                          {(r.companies_count ?? 0) > 1 && (
                            <Tip label="O telefone aparece em mais de uma empresa. Abra o perfil (clique no nome) para trocar a principal.">
                              <span>
                                <Badge variant="warning">{r.companies_count} empresas</Badge>
                              </span>
                            </Tip>
                          )}
                        </span>
                        {r.company.external_id && <span className="text-xs text-muted-foreground">CRM {r.company.external_id}</span>}
                        {(r.company.cnpj ?? r.crm_tax_id) && (
                          <span className="font-mono text-xs text-muted-foreground tabular">{formatTaxId((r.company.cnpj ?? r.crm_tax_id)!)}</span>
                        )}
                      </span>
                    ) : unlinked ? (
                      <Badge variant="warning" title={r.gleap_status === "ambiguous" ? "O telefone aparece em mais de uma empresa no Gleap" : undefined}>
                        {(r.companies_count ?? 0) > 1 ? `${r.companies_count} empresas: escolher a principal` : r.gleap_status === "ambiguous" ? "Várias empresas no Gleap" : "Sem vínculo"}
                      </Badge>
                    ) : (
                      <Badge variant="primary">{r.kind === "partner" ? "Parceiro" : "Equipe"}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.left_community_at ? (
                      <Tip label={`Saiu da última comunidade ${formatRelative(r.left_community_at)}`}>
                        <span>
                          <Badge variant="outline">Ex-membro</Badge>
                        </span>
                      </Tip>
                    ) : activeGroups.length === 0 ? (
                      <span className="text-muted-foreground">Saiu dos grupos</span>
                    ) : (
                      <Tip label={activeGroups.map((m) => groupName.get(m.group_jid) ?? m.group_jid).join(", ")}>
                        <span className="max-w-52 truncate text-muted-foreground">
                          {activeGroups.length === 1
                            ? groupName.get(activeGroups[0].group_jid)
                            : pluralize(activeGroups.length, "grupo", "grupos")}
                        </span>
                      </Tip>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{r.message_count.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.last_message_at ? formatRelative(r.last_message_at) : "Nunca falou"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      variant={unlinked ? "default" : "outline"}
                      size="sm"
                      onClick={() => setLinkTarget({ ...r, company: r.company })}
                    >
                      {unlinked ? "Vincular" : "Editar"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <EmptyState
            icon={ContactIcon}
            title={error ? "Não foi possível carregar os leads" : "Nenhum lead encontrado"}
            description={
              error
                ? "Tente novamente em instantes."
                : filters.q || filters.group || filters.link !== "todos"
                  ? "Ajuste a busca ou os filtros."
                  : "Os leads aparecem quando alguém fala num grupo escutado, ou ao sincronizar os membros em Grupos."
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

      <LinkContactDialog target={linkTarget} onClose={() => setLinkTarget(null)} onSaved={() => router.refresh()} />
      <LeadProfileDialog contactId={profileId} onClose={() => setProfileId(null)} onDeleted={() => router.refresh()} />
    </main>
  );
}

