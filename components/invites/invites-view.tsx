"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CloudDownload, Download, Loader2, RefreshCw, Search, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { importAllFromGleap, syncRecentFromGleap } from "@/lib/admin/gleap";
import { formatPhone, formatRelative, pluralize } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Tip } from "@/components/ui/misc";

export interface InviteRow {
  phone_key: string;
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company_tenant_id: string | null;
  company_name: string | null;
  last_activity_at: string | null;
}

export interface SyncState {
  last_full_import_at: string | null;
  last_full_import_rows: number | null;
  last_recent_sync_at: string | null;
  last_recent_sync_rows: number | null;
  last_error: string | null;
}

export function InvitesView({
  rows,
  total,
  page,
  pageSize,
  q,
  state,
  gleapLeads,
  configured,
  error,
}: {
  rows: InviteRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  state: SyncState | null;
  gleapLeads: number;
  configured: boolean;
  error: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [importing, startImport] = useTransition();
  const [syncing, startSync] = useTransition();
  const [search, setSearch] = useState(q);
  const busy = importing || syncing;

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

  const runImport = () =>
    startImport(async () => {
      const res = await importAllFromGleap();
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        `${pluralize(res.data.rows, "usuário importado", "usuários importados")} do Gleap` +
          (res.data.linked ? ` · ${pluralize(res.data.linked, "lead vinculado", "leads vinculados")} à empresa.` : "."),
      );
      router.refresh();
    });

  const runSync = () =>
    startSync(async () => {
      const res = await syncRecentFromGleap();
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        `${pluralize(res.data.rows, "usuário atualizado", "usuários atualizados")}` +
          (res.data.linked ? ` · ${pluralize(res.data.linked, "lead vinculado", "leads vinculados")}.` : "."),
      );
      router.refresh();
    });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const neverImported = !state?.last_full_import_at;

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
      <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Base do Gleap</span>
          <span className="text-xs text-muted-foreground">
            {neverImported
              ? "Ainda não importada. Importe a base inteira uma vez; depois a rotina diária puxa as 500 sessões mais recentes."
              : `${gleapLeads.toLocaleString("pt-BR")} usuários · importação completa ${formatRelative(state!.last_full_import_at!)}` +
                (state?.last_recent_sync_at ? ` · última atualização ${formatRelative(state.last_recent_sync_at)}` : "")}
          </span>
          {state?.last_error && <span className="text-xs text-destructive">Última falha: {state.last_error}</span>}
          {!configured && (
            <span className="text-xs text-warning">
              Defina <code>GLEAP_API_TOKEN</code> no <code>.env.local</code> e reinicie o servidor.
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!neverImported && (
            <Tip label={`Todos os ${gleapLeads.toLocaleString("pt-BR")} usuários do Gleap, com a coluna "Na comunidade"`}>
              <Button variant="outline" size="sm" asChild>
                <a href="/api/export/gleap" download>
                  <Download /> Exportar base completa
                </a>
              </Button>
            </Tip>
          )}
          <Button variant="outline" size="sm" onClick={runSync} disabled={!configured || busy || neverImported}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Atualizar (últimas 500)
          </Button>
          <Button variant={neverImported ? "default" : "outline"} size="sm" onClick={runImport} disabled={!configured || busy}>
            {importing ? <Loader2 className="animate-spin" /> : <CloudDownload />}
            {importing ? "Importando… (até 1 min)" : neverImported ? "Importar tudo do Gleap" : "Reimportar tudo"}
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, e-mail, empresa ou telefone"
            className="pl-8"
            aria-label="Buscar pessoas para convidar"
          />
        </div>
        {navigating && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-sm text-muted-foreground tabular">{pluralize(total, "resultado", "resultados")}</span>
        <Tip label={total > 0 ? `Baixa as ${total.toLocaleString("pt-BR")} pessoas com a busca atual` : "Nada para exportar"}>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/export/convites${q ? `?q=${encodeURIComponent(q)}` : ""}`} download aria-disabled={total === 0}>
              <Download /> Exportar CSV
            </a>
          </Button>
        </Tip>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Pessoa</th>
              <th className="px-4 py-2.5 font-semibold">Telefone</th>
              <th className="px-4 py-2.5 font-semibold">Empresa</th>
              <th className="px-4 py-2.5 font-semibold">Último acesso ao CRM</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.phone_key} className="border-b border-border last:border-b-0 hover:bg-accent/30">
                <td className="px-4 py-2.5">
                  <span className="flex flex-col">
                    <span className="max-w-64 truncate font-medium">{r.name ?? r.email ?? "Sem nome"}</span>
                    {r.email && <span className="max-w-64 truncate text-xs text-muted-foreground">{r.email}</span>}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[12.5px] text-muted-foreground tabular">
                  {formatPhone((r.phone ?? "").replace(/\D/g, ""))}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-col">
                    <span className="max-w-56 truncate">{r.company_name ?? "Sem nome"}</span>
                    {r.company_tenant_id && <span className="max-w-56 truncate text-xs text-muted-foreground">CRM {r.company_tenant_id}</span>}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.last_activity_at ? formatRelative(r.last_activity_at) : "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <Tip label="Envio de convite pelo WhatsApp em breve">
                    {/* span: o tooltip precisa de um alvo que receba o hover com o botão desativado */}
                    <span className="inline-flex items-center gap-2">
                      <Badge variant="outline">Em breve</Badge>
                      <Button size="sm" disabled>
                        <Send /> Convidar
                      </Button>
                    </span>
                  </Tip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <EmptyState
            icon={UserPlus}
            title={error ? "Não foi possível carregar a lista" : neverImported ? "Importe a base do Gleap" : "Ninguém para convidar"}
            description={
              error
                ? "Tente novamente em instantes."
                : neverImported
                  ? "A lista é montada a partir dos usuários do CRM com telefone e empresa."
                  : q
                    ? "Ajuste a busca."
                    : "Todos os clientes com telefone já estão em algum grupo."
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
    </main>
  );
}
