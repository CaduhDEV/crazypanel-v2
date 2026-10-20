"use client";

import { useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Eraser, Inbox, Loader2, MoreHorizontal, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { claimNextTicket, clearQueue } from "@/lib/tickets/actions";
import { compareQueue, slaInfo } from "@/lib/sla";
import { cn, contactLabel, formatPhone, pluralize } from "@/lib/utils";
import type { TicketWithRelations } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/app/page-header";
import { useApp } from "@/components/app/app-context";
import { patchOpenTicket, useOpenTickets } from "@/components/app/use-open-tickets";
import { useNow } from "@/components/app/use-now";
import { TicketCard } from "@/components/inbox/ticket-card";
import { Workspace } from "@/components/conversation/workspace";
import { setTicketParam } from "@/components/conversation/ticket-url";

type Tab = "unassigned" | "mine" | "assigned" | "breach" | "all";

const ALL_GROUPS = "__all__";

export function InboxView() {
  const { profile, settings, isAdmin } = useApp();
  const { data: tickets, isLoading, isError, refetch } = useOpenTickets();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const openTicketId = searchParams.get("ticket");
  const now = useNow();

  const [tab, setTab] = useState<Tab>("unassigned");
  const [group, setGroup] = useState(ALL_GROUPS);
  const [search, setSearch] = useState("");
  const [claiming, startClaim] = useTransition();
  const [clearOpen, setClearOpen] = useState(false);

  const openTicket = (id: string) => setTicketParam(id, "push");

  const groups = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tickets ?? []) map.set(t.group_jid, t.group?.name ?? t.group_jid);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tickets]);

  // Filtro de grupo e busca valem para as contagens das abas.
  const scoped = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (tickets ?? []).filter((t) => {
      if (group !== ALL_GROUPS && t.group_jid !== group) return false;
      if (!term) return true;
      return [contactLabel(t.contact), formatPhone(t.contact?.phone), t.contact?.phone, t.subject, t.last_message_preview, t.group?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [tickets, group, search]);

  const isBreach = (t: TicketWithRelations) => slaInfo(t.waiting_since, now, settings).state === "breach";
  const counts = {
    all: scoped.length,
    mine: scoped.filter((t) => t.assignee_id === profile.id).length,
    unassigned: scoped.filter((t) => !t.assignee_id).length,
    assigned: scoped.filter((t) => !!t.assignee_id).length,
    breach: scoped.filter(isBreach).length,
  };

  const visible = scoped
    .filter((t) =>
      tab === "mine"
        ? t.assignee_id === profile.id
        : tab === "unassigned"
          ? !t.assignee_id
          : tab === "assigned"
            ? !!t.assignee_id
            : tab === "breach"
              ? isBreach(t)
              : true,
    )
    .sort(compareQueue);

  const handleClaim = () =>
    startClaim(async () => {
      const res = await claimNextTicket();
      if (!res.ok) return void toast.error(res.error);
      if (!res.data) return void toast.message("Nenhum atendimento em aberto.");
      patchOpenTicket(queryClient, res.data, { assignee_id: profile.id });
      openTicket(res.data);
    });

  const TABS: { value: Tab; label: string; tone?: string }[] = [
    { value: "unassigned", label: "Em Aberto" },
    { value: "mine", label: "Meus" },
    { value: "assigned", label: "Em atendimento" },
    { value: "breach", label: "SLA estourado", tone: "text-destructive" },
    { value: "all", label: "Todos" },
  ];

  return (
    <>
      <PageHeader
        title="Inbox"
        meta={
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground tabular">
            {pluralize(tickets?.length ?? 0, "atendimento aberto", "atendimentos abertos")}
          </span>
        }
        actions={
          <>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por contato, mensagem ou grupo"
                className="pl-8"
                aria-label="Buscar atendimentos"
              />
            </div>
            <Button onClick={handleClaim} disabled={claiming}>
              {claiming ? <Loader2 className="animate-spin" /> : <ChevronRight />}
              Chamar Próximo
            </Button>
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Mais ações">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setClearOpen(true)}>
                    <Eraser /> Limpar fila…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 sm:px-6">
        <div role="tablist" aria-label="Filtrar atendimentos" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                "flex h-8 items-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors",
                tab === t.value
                  ? "border-input bg-card text-foreground shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {t.label}
              <span className={cn("text-xs tabular", counts[t.value] > 0 && t.tone ? t.tone : "text-muted-foreground")}>
                {counts[t.value]}
              </span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="h-8 w-56 text-[13px]" aria-label="Filtrar por grupo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_GROUPS}>Todos os grupos</SelectItem>
              {groups.map(([jid, name]) => (
                <SelectItem key={jid} value={jid}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="hidden text-xs text-muted-foreground xl:inline">
            Ordem: <span className="font-medium text-foreground">maior espera primeiro</span>
          </span>
        </div>
      </div>

      <main className="flex-1 px-4 py-5 sm:px-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[188px] rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={Inbox}
            title="Não foi possível carregar a fila"
            description="Confira a conexão e tente de novo."
            action={<Button variant="outline" onClick={() => refetch()}>Tentar de novo</Button>}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={counts.all === 0 && !search ? Sparkles : Inbox}
            title={counts.all === 0 && !search ? "Fila zerada" : "Nada por aqui"}
            description={
              counts.all === 0 && !search
                ? "Nenhum atendimento aberto."
                : "Nenhum atendimento corresponde a este filtro."
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((t) => (
              <TicketCard key={t.id} ticket={t} onOpen={() => openTicket(t.id)} />
            ))}
          </div>
        )}
      </main>

      {openTicketId && <Workspace ticketId={openTicketId} />}

      {isAdmin && (
        <ClearQueueDialog
          open={clearOpen}
          onOpenChange={setClearOpen}
          groupJid={group === ALL_GROUPS ? null : group}
          groupName={groups.find(([jid]) => jid === group)?.[1] ?? null}
          count={group === ALL_GROUPS ? (tickets?.length ?? 0) : (tickets ?? []).filter((t) => t.group_jid === group).length}
        />
      )}
    </>
  );
}

function ClearQueueDialog({
  open,
  onOpenChange,
  groupJid,
  groupName,
  count,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupJid: string | null;
  groupName: string | null;
  count: number;
}) {
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();
  const confirm = () =>
    start(async () => {
      const res = await clearQueue({ groupJids: groupJid ? [groupJid] : undefined });
      if (!res.ok) return void toast.error(res.error);
      // Atualiza a fila na hora (não espera o Realtime, que chega um evento por atendimento).
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
      toast.success(`${pluralize(res.data, "atendimento finalizado", "atendimentos finalizados")}.`);
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Limpar fila</DialogTitle>
          <DialogDescription>
            {groupName
              ? `Finaliza os ${count} atendimentos abertos de “${groupName}”.`
              : `Finaliza todos os ${count} atendimentos abertos de todos os grupos.`}{" "}
            Eles ficam registrados como “Fila limpa pelo admin” e não contam como resolvidos.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending || count === 0}>
            {pending && <Loader2 className="animate-spin" />}
            Finalizar {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
