"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check, ChevronLeft, ChevronRight, ClipboardList, History, Loader2, RefreshCw, Search, Smartphone, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { acceptJoinRequest, getCommunityOccupancy, refreshJoinRequests, rejectJoinRequest } from "@/lib/community/actions";
import { createClient } from "@/lib/supabase/client";
import { cn, formatPhone, formatRelative, formatTaxId, pluralize } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton, Tip } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { communityEventText } from "@/components/community/event-text";

export type JoinTab = "pendentes" | "convidados" | "aceitos" | "recusados" | "todos";

export interface JoinRequestItem {
  id: string;
  source: "form" | "whatsapp";
  phone: string | null;
  lid: string | null;
  email: string | null;
  name: string | null;
  form_source: string | null;
  email_verified?: boolean;
  phone_verified?: boolean;
  group_jid: string | null;
  link_status: "found" | "not_found" | "error" | null;
  company_name: string | null;
  gleap_tenant_id: string | null;
  crm_lead_id: string | null;
  crm_tax_id: string | null;
  status: "pending" | "accepted" | "invited" | "joined" | "rejected" | "expired" | "error";
  target_groups: string[];
  error: string | null;
  created_at: string;
  decided_at: string | null;
  group: { name: string | null } | null;
  company: { name: string; external_id: string | null; cnpj: string | null } | null;
}

const TAB_LABELS: Record<JoinTab, string> = {
  pendentes: "Pendentes",
  convidados: "Convidados",
  aceitos: "Aceitos",
  recusados: "Recusados",
  todos: "Todos",
};

const STATUS: Record<JoinRequestItem["status"], { label: string; variant: "warning" | "primary" | "neutral" | "outline" | "destructive" }> = {
  pending: { label: "Pendente", variant: "warning" },
  accepted: { label: "Aceito", variant: "primary" },
  invited: { label: "Convite enviado", variant: "primary" },
  joined: { label: "Entrou", variant: "neutral" },
  rejected: { label: "Recusado", variant: "outline" },
  expired: { label: "Resolvido pelo celular", variant: "outline" },
  error: { label: "Erro", variant: "destructive" },
};

const ALL = "__all__";

const UNAVAILABLE_TEXT = {
  not_configured: "O WhatsApp não está configurado: os pedidos feitos pelo WhatsApp não estão sendo lidos.",
  disconnected: "WhatsApp desconectado: os pedidos feitos pelo WhatsApp não estão sendo lidos.",
  unreachable: "Não foi possível falar com a uazapi (token inválido ou instância fora do ar): os pedidos feitos pelo WhatsApp não estão sendo lidos.",
} as const;
const decidable = (s: JoinRequestItem["status"]) => s === "pending" || s === "error" || s === "expired";

export function JoinRequestsView({
  rows,
  total,
  page,
  pageSize,
  filters,
  tabCounts,
  groups,
  error,
}: {
  rows: JoinRequestItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: { tab: JoinTab; origin: string; group: string; q: string };
  tabCounts: Record<JoinTab, number>;
  groups: { jid: string; name: string | null }[];
  error: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [syncing, startSync] = useTransition();
  const [search, setSearch] = useState(filters.q);
  const [accepting, setAccepting] = useState<JoinRequestItem | null>(null);
  const [rejecting, setRejecting] = useState<JoinRequestItem | null>(null);
  const [timeline, setTimeline] = useState<JoinRequestItem | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

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

  const syncWhatsApp = (force: boolean) =>
    startSync(async () => {
      const res = await refreshJoinRequests({ force });
      if (!res.ok) {
        if (force) toast.error(res.error);
        return;
      }
      if (res.data.skipped) return;
      setUnavailable(res.data.unavailable ?? null);
      if (res.data.unavailable) {
        if (force) toast.warning(UNAVAILABLE_TEXT[res.data.unavailable]);
        return;
      }
      if (force) {
        const r = res.data;
        toast.success(
          r.created || r.expired
            ? `${pluralize(r.created, "pedido novo", "pedidos novos")} do WhatsApp${r.expired ? ` · ${r.expired} resolvido(s) pelo celular` : ""}.`
            : "Nenhum pedido novo no WhatsApp.",
        );
        if (r.unreadable.length) toast.warning(`Sem permissão para ler os pedidos de: ${r.unreadable.join(", ")}. A conta precisa ser admin.`);
      }
      if (res.data.created || res.data.expired) router.refresh();
    });

  // Ao abrir: lê os pedidos do WhatsApp (o servidor limita a 1x/min).
  useEffect(() => {
    syncWhatsApp(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pedido novo do formulário ou mudança feita por outro admin: atualiza a lista.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("join-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "join_requests" }, () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => router.refresh(), 500);
      })
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [router]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      {unavailable && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-warning">
          <Smartphone className="size-4 shrink-0" />
          <span className="flex-1">{UNAVAILABLE_TEXT[unavailable as keyof typeof UNAVAILABLE_TEXT]} Os pedidos do formulário continuam chegando normalmente.</span>
          <Link href="/admin/whatsapp" className="font-medium underline underline-offset-2">
            Reconectar
          </Link>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border border-border bg-card p-0.5" role="tablist" aria-label="Situação">
          {(Object.keys(TAB_LABELS) as JoinTab[]).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={filters.tab === t}
              onClick={() => update({ aba: t === "pendentes" ? null : t })}
              className={cn(
                "rounded px-3 py-1.5 text-sm transition-colors",
                filters.tab === t ? "bg-primary-soft font-medium text-primary dark:text-[#9fc0ef]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABELS[t]} <span className="tabular opacity-70">{tabCounts[t]}</span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => syncWhatsApp(true)} disabled={syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Buscar pedidos do WhatsApp
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, e-mail, empresa ou telefone" className="pl-8" aria-label="Buscar solicitações" />
        </div>
        <Select value={filters.origin || ALL} onValueChange={(v) => update({ origem: v === ALL ? null : v })}>
          <SelectTrigger className="w-44" aria-label="Origem">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as origens</SelectItem>
            <SelectItem value="form">Formulário</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.group || ALL} onValueChange={(v) => update({ grupo: v === ALL ? null : v })}>
          <SelectTrigger className="w-56" aria-label="Grupo">
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
        {navigating && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <span className="ml-auto text-sm text-muted-foreground tabular">{pluralize(total, "resultado", "resultados")}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold w-[20%]">Pessoa</th>
              <th className="px-4 py-2.5 font-semibold w-[13%]">Origem</th>
              <th className="px-4 py-2.5 font-semibold w-[20%]">Vínculo</th>
              <th className="px-4 py-2.5 font-semibold w-[9%]">Pedido</th>
              <th className="px-4 py-2.5 font-semibold w-[12%]">Situação</th>
              <th className="px-4 py-2.5 w-[26%]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-accent/30">
                <td className="px-4 py-2.5">
                  <span className="flex flex-col">
                    <span className="max-w-60 truncate font-medium">{r.name ?? (r.phone ? formatPhone(r.phone) : "Sem nome")}</span>
                    <span className="max-w-60 truncate text-xs text-muted-foreground">
                      {[r.phone && r.name ? formatPhone(r.phone) : null, r.email].filter(Boolean).join(" · ") || (r.lid ? `@lid ${r.lid.slice(0, 8)}…` : "")}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-1.5">
                    {r.source === "form" ? <ClipboardList className="size-3.5 text-muted-foreground" /> : <Smartphone className="size-3.5 text-muted-foreground" />}
                    <span className="flex flex-col">
                      <span className="flex items-center gap-1.5">
                        {r.source === "form" ? (r.form_source === "crazypanel-form" ? "Formulário verificado" : "Formulário") : "WhatsApp"}
                        {r.email_verified && r.phone_verified && (
                          <Tip label="E-mail e telefone confirmados por código">
                            <span>
                              <Badge variant="primary">Verificado</Badge>
                            </span>
                          </Tip>
                        )}
                      </span>
                      <span className="max-w-44 truncate text-[11px] text-muted-foreground">
                        {r.source === "whatsapp" ? (r.group?.name ?? "Grupo") : (r.form_source ?? "")}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <LinkCell r={r} />
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{formatRelative(r.created_at)}</td>
                <td className="px-4 py-2.5">
                  <Tip label={r.error ?? STATUS[r.status].label}>
                    <span>
                      <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                    </span>
                  </Tip>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center justify-end gap-1.5">
                    <Tip label="Histórico da solicitação">
                      <Button variant="ghost" size="icon-sm" onClick={() => setTimeline(r)} aria-label="Histórico">
                        <History />
                      </Button>
                    </Tip>
                    {decidable(r.status) && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setRejecting(r)}>
                          <X /> Recusar
                        </Button>
                        <Button size="sm" onClick={() => setAccepting(r)}>
                          <Check /> Aceitar
                        </Button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <EmptyState
            icon={UserPlus}
            title={error ? "Não foi possível carregar as solicitações" : "Nenhuma solicitação"}
            description={
              error
                ? error
                : filters.tab === "pendentes"
                  ? "Os pedidos chegam pelo formulário e pelos grupos com aprovação de entrada no WhatsApp."
                  : "Ajuste os filtros."
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

      {accepting && <AcceptDialog request={accepting} onClose={() => setAccepting(null)} onDone={() => router.refresh()} />}
      {rejecting && <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onDone={() => router.refresh()} />}
      {timeline && <TimelineDialog request={timeline} onClose={() => setTimeline(null)} />}
    </main>
  );
}

function LinkCell({ r }: { r: JoinRequestItem }) {
  if (r.link_status === "not_found") return <Badge variant="warning">Empresa não encontrada</Badge>;
  if (r.link_status === "error") return <Badge variant="destructive">Falha ao buscar</Badge>;
  if (!r.link_status) return <span className="text-muted-foreground">Buscando…</span>;
  const name = r.company?.name ?? r.company_name;
  const cnpj = r.company?.cnpj ?? (r.crm_tax_id?.length === 14 ? r.crm_tax_id : null);
  return (
    <span className="flex flex-col">
      <span className="flex items-center gap-1.5">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="max-w-52 truncate font-medium">{name ?? "Vínculo encontrado"}</span>
      </span>
      <span className="flex flex-wrap gap-1 pt-0.5">
        {r.gleap_tenant_id && <Badge variant="outline">Gleap</Badge>}
        {r.crm_lead_id && <Badge variant="outline">CRM</Badge>}
        {cnpj && <span className="font-mono text-[11px] text-muted-foreground">{formatTaxId(cnpj)}</span>}
      </span>
    </span>
  );
}

function AcceptDialog({ request: r, onClose, onDone }: { request: JoinRequestItem; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[] | null>(null);
  const { data: groups, isLoading } = useQuery({
    queryKey: ["community-occupancy"],
    queryFn: async () => {
      const res = await getCommunityOccupancy();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });
  // Pré-seleção: o primeiro grupo com vaga (só no formulário).
  const chosen = selected ?? (r.source === "form" && groups ? groups.filter((g) => !g.full).slice(0, 1).map((g) => g.jid) : []);
  const requested = r.source === "whatsapp" ? groups?.find((g) => g.jid === r.group_jid) : null;

  const accept = () =>
    start(async () => {
      const res = await acceptJoinRequest({ id: r.id, groupJids: r.source === "form" ? chosen : [] });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.status === "invited" ? `Convite enviado no privado (${res.data.groups.join(", ")}).` : `Aceito em ${res.data.groups.join(", ")}.`);
      onDone();
      onClose();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
        <DialogHeader>
          <DialogTitle>Aceitar {r.name ?? (r.phone ? formatPhone(r.phone) : "solicitação")}</DialogTitle>
          <DialogDescription>
            {r.source === "whatsapp"
              ? "Aprova o pedido de entrada feito no WhatsApp, no grupo pedido."
              : "Adiciona a pessoa nos grupos escolhidos. Se a privacidade dela bloquear, o painel manda o link do grupo no privado."}
          </DialogDescription>
        </DialogHeader>

        {r.link_status === "not_found" && (
          <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">Empresa não encontrada no CRM nem no Gleap.</p>
        )}

        {isLoading ? (
          <Skeleton className="h-32" />
        ) : r.source === "whatsapp" ? (
          <GroupLine name={requested?.name ?? r.group?.name ?? "Grupo"} members={requested?.members ?? null} full={!!requested?.full} />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(groups ?? []).map((g) => {
              const on = chosen.includes(g.jid);
              return (
                <li key={g.jid}>
                  <label className={cn("flex cursor-pointer items-center gap-3 rounded-md border p-2.5", on ? "border-primary/50 bg-primary-soft/50" : "border-border", g.full && "cursor-not-allowed opacity-60")}>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={on}
                      disabled={g.full}
                      onChange={(e) => setSelected(e.target.checked ? [...chosen, g.jid] : chosen.filter((j) => j !== g.jid))}
                    />
                    <GroupLine name={g.name} members={g.members} full={g.full} />
                  </label>
                </li>
              );
            })}
            {groups?.length === 0 && <li className="text-sm text-muted-foreground">Nenhum grupo escutado na comunidade.</li>}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={accept} disabled={pending || isLoading || (r.source === "form" ? chosen.length === 0 : !!requested?.full)}>
            {pending && <Loader2 className="animate-spin" />} Aceitar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GroupLine({ name, members, full }: { name: string; members: number | null; full: boolean }) {
  const pct = members !== null ? Math.min(100, Math.round((members / 1024) * 100)) : 0;
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-medium">{name}</span>
        <span className={cn("shrink-0 text-xs tabular", full ? "text-destructive" : "text-muted-foreground")}>
          {members === null ? "vagas ?" : full ? `cheio · ${members}/1024` : `${members}/1024`}
        </span>
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", full ? "bg-destructive" : "bg-primary")} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function RejectDialog({ request: r, onClose, onDone }: { request: JoinRequestItem; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const reject = () =>
    start(async () => {
      const res = await rejectJoinRequest({ id: r.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Solicitação recusada.");
      onDone();
      onClose();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recusar {r.name ?? (r.phone ? formatPhone(r.phone) : "solicitação")}?</DialogTitle>
          <DialogDescription>
            {r.source === "whatsapp" ? "Recusa o pedido no WhatsApp. " : ""}A pessoa recebe a mensagem de recusa no privado (texto em Configurações).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={reject} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Recusar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimelineDialog({ request: r, onClose }: { request: JoinRequestItem; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["join-request-events", r.id],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("community_events")
        .select("*, group:wa_groups(name), actor:profiles(name)")
        .eq("request_id", r.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Histórico da solicitação</DialogTitle>
          <DialogDescription>{r.name ?? (r.phone ? formatPhone(r.phone) : "")}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
        ) : (
          <ol className="flex flex-col gap-2 border-l border-border pl-4">
            {data.map((e) => (
              <li key={e.id as number} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                <span className="block">{communityEventText(e as Parameters<typeof communityEventText>[0])}</span>
                <span className="text-xs text-muted-foreground">{formatRelative(e.created_at as string)}</span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
