"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, History, Loader2, Search, X } from "lucide-react";
import type { HistoryFilters } from "@/lib/history/query";
import { cn, contactLabel, formatDuration, formatRelative, pluralize } from "@/lib/utils";
import { CLOSE_REASONS, type CloseReason, type ContactKind } from "@/lib/types";
import { classificationLabel } from "@/lib/taxonomy";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/components/app/app-context";
import { ExportPdfButton } from "@/components/history/export-pdf";
import { LeadsSummary, TranscriptView, transcriptSummary } from "@/components/history/transcript-view";
import { useTranscript } from "@/components/history/use-transcript";
import { OpenTicketLink } from "@/components/conversation/open-ticket-link";

export interface HistoryRow {
  id: string;
  number: number;
  status: "open" | "closed";
  subject: string | null;
  group_jid: string;
  assignee_id: string | null;
  category: string | null;
  topic?: string | null;
  close_reason: CloseReason | null;
  opened_at: string;
  closed_at: string | null;
  first_response_at: string | null;
  message_count: number;
  contact: { id: string; name: string | null; phone: string | null; lid: string | null; kind: ContactKind; avatar_url: string | null; company: { name: string } | null } | null;
  group: { name: string | null } | null;
}

const ALL = "__all__";

export function HistoryView({
  rows,
  total,
  page,
  pageSize,
  filters,
  groups,
  error,
}: {
  rows: HistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: HistoryFilters;
  groups: { jid: string; name: string | null }[];
  error: string | null;
}) {
  const { members, memberById, taxonomy } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [search, setSearch] = useState(filters.q);
  const [openId, setOpenId] = useState<string | null>(null);

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
    if (search === filters.q) return;
    const timer = setTimeout(() => update({ q: search.trim() || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = !!(filters.q || filters.status !== "todos" || filters.group || filters.assignee || filters.category || filters.from || filters.to);

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nº, assunto ou nome do lead" className="pl-8" aria-label="Buscar atendimentos" />
        </div>
        <Select value={filters.status} onValueChange={(v) => update({ status: v === "todos" ? null : v })}>
          <SelectTrigger className="w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="abertos">Abertos</SelectItem>
            <SelectItem value="finalizados">Finalizados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.group || ALL} onValueChange={(v) => update({ grupo: v === ALL ? null : v })}>
          <SelectTrigger className="w-52" aria-label="Grupo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os grupos</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.jid} value={g.jid}>
                {g.name ?? g.jid}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.assignee || ALL} onValueChange={(v) => update({ responsavel: v === ALL ? null : v })}>
          <SelectTrigger className="w-48" aria-label="Responsável">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os responsáveis</SelectItem>
            <SelectItem value="sem">Sem responsável</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.category || ALL} onValueChange={(v) => update({ categoria: v === ALL ? null : v })}>
          <SelectTrigger className="w-44" aria-label="Categoria">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {taxonomy.categories.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
                {c.archived ? " (arquivada)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          De
          <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ de: e.target.value || null })} className="h-9 w-36" aria-label="Aberto a partir de" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          até
          <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ ate: e.target.value || null })} className="h-9 w-36" aria-label="Aberto até" />
        </label>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              startNav(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <X /> Limpar
          </Button>
        )}
        {navigating && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-sm text-muted-foreground tabular">{pluralize(total, "resultado", "resultados")}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold w-[6%]">Nº</th>
              <th className="px-4 py-2.5 font-semibold w-[17%]">Lead</th>
              <th className="px-4 py-2.5 font-semibold w-[25%]">Assunto</th>
              <th className="px-4 py-2.5 font-semibold w-[13%]">Responsável</th>
              <th className="px-4 py-2.5 font-semibold w-[12%]">Situação</th>
              <th className="px-4 py-2.5 font-semibold w-[9%]">Aberto</th>
              <th className="px-4 py-2.5 text-right font-semibold w-[9%]">1ª resposta</th>
              <th className="px-4 py-2.5 text-right font-semibold w-[9%]">Duração</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const assignee = r.assignee_id ? memberById.get(r.assignee_id) : null;
              const firstResponse =
                r.first_response_at && Date.parse(r.first_response_at) >= Date.parse(r.opened_at)
                  ? formatDuration((Date.parse(r.first_response_at) - Date.parse(r.opened_at)) / 1000)
                  : "—";
              const duration = r.closed_at ? formatDuration((Date.parse(r.closed_at) - Date.parse(r.opened_at)) / 1000) : "—";
              const category = classificationLabel(taxonomy, r.category, r.topic);
              return (
                <tr
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(r.id))}
                  tabIndex={0}
                  aria-label={`Abrir atendimento ${r.number}`}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                >
                  <td className="px-4 py-2.5 font-mono text-[12.5px] tabular text-muted-foreground">#{r.number}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <Avatar name={contactLabel(r.contact)} src={r.contact?.avatar_url} size="xs" />
                      <span className="flex min-w-0 flex-col">
                        <span className="max-w-44 truncate font-medium">{contactLabel(r.contact)}</span>
                        <span className="max-w-44 truncate text-[11px] text-muted-foreground">{r.contact?.company?.name ?? r.group?.name ?? ""}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="line-clamp-1 max-w-72 text-muted-foreground">{r.subject ?? "—"}</span>
                    <span className="text-[11px] text-muted-foreground/80">
                      {r.group?.name} · {pluralize(r.message_count, "mensagem", "mensagens")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {assignee ? (
                      <span className="flex items-center gap-1.5">
                        <Avatar name={assignee.name} src={assignee.avatar_url} size="xs" />
                        <span className="max-w-32 truncate">{assignee.name}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.status === "open" ? (
                      <Badge variant="primary">Aberto</Badge>
                    ) : (
                      <Badge variant={r.close_reason && r.close_reason !== "resolved" ? "outline" : "neutral"}>
                        {category ?? CLOSE_REASONS[r.close_reason ?? "resolved"]}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatRelative(r.opened_at)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular">{firstResponse}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular">{duration}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <EmptyState
            icon={History}
            title={error ? "Não foi possível carregar o histórico" : "Nenhum atendimento encontrado"}
            description={error ? "Tente novamente em instantes." : hasFilters ? "Ajuste ou limpe os filtros." : "Os atendimentos aparecem aqui assim que são abertos."}
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

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          {openId && <TranscriptDialogBody key={openId} ticketId={openId} />}
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** Conversa completa em modo leitura, com o resumo e a exportação em PDF. */
function TranscriptDialogBody({ ticketId }: { ticketId: string }) {
  const { memberById } = useApp();
  const { data, isLoading, notFound } = useTranscript(ticketId);

  if (notFound) {
    return (
      <div className="p-6">
        <DialogTitle>Atendimento não encontrado</DialogTitle>
      </div>
    );
  }
  const s = data ? transcriptSummary(data, memberById) : null;

  return (
    <>
      <DialogHeader className="gap-3 border-b border-border p-5 pr-12 text-left">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="text-lg">{s?.title ?? "Carregando…"}</DialogTitle>
            <DialogDescription className={cn(!s && "invisible")}>
              {s && `${s.group} · ${s.status} · ${s.assignee}`}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" asChild>
              <OpenTicketLink ticketId={ticketId}>
                <ExternalLink /> Abrir atendimento
              </OpenTicketLink>
            </Button>
            <ExportPdfButton transcript={data} />
          </div>
        </div>
        {s && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <Info label="Aberto" value={s.opened} />
            <Info label="Finalizado" value={s.closed ?? "—"} />
            <Info label="1ª resposta" value={s.firstResponse ?? "—"} />
            <Info label="Duração" value={s.duration ?? "—"} />
          </dl>
        )}
        {data && <LeadsSummary transcript={data} />}
        {s?.closeNote && <p className="rounded-md bg-muted/60 px-3 py-2 text-xs">Observação ao finalizar: {s.closeNote}</p>}
      </DialogHeader>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-background px-3 py-4 sm:px-5">
        {isLoading || !data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-2/3" />
            <Skeleton className="ml-auto h-14 w-1/2" />
            <Skeleton className="h-20 w-3/5" />
          </div>
        ) : (
          <TranscriptView transcript={data} />
        )}
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular">{value}</dd>
    </div>
  );
}
