"use client";

import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Merge, Search } from "lucide-react";
import { mergeTickets } from "@/lib/tickets/actions";
import { cn, contactLabel } from "@/lib/utils";
import { compareQueue } from "@/lib/sla";
import type { TicketWithRelations } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/components/app/app-context";
import { useOpenTickets } from "@/components/app/use-open-tickets";
import { SlaBadge } from "@/components/inbox/sla-badge";
import { ChatPanel } from "@/components/conversation/chat-panel";
import { setTicketParam } from "@/components/conversation/ticket-url";

/**
 * Janela central de atendimento, aberta por ?ticket=<id> (o link pode ser
 * compartilhado). À esquerda, os atendimentos abertos: os seus primeiro.
 */
export function Workspace({ ticketId }: { ticketId: string }) {
  const { profile } = useApp();
  const { data: tickets } = useOpenTickets();
  const [filter, setFilter] = useState("");
  // Dados do lead: fechados ao abrir a janela; ao abrir, valem para os próximos atendimentos.
  const [panelOpen, setPanelOpen] = useState(false);

  const navigate = (id: string | null) => setTicketParam(id);

  const ordered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = (tickets ?? []).filter(
      (t) => !term || contactLabel(t.contact).toLowerCase().includes(term) || t.group?.name?.toLowerCase().includes(term),
    );
    const mine = list.filter((t) => t.assignee_id === profile.id).sort(compareQueue);
    const others = list.filter((t) => t.assignee_id !== profile.id).sort(compareQueue);
    return { mine, others };
  }, [tickets, filter, profile.id]);

  // Depois de finalizar: próximo atendimento meu aguardando, senão o próximo da fila.
  const goToNext = () => {
    const next =
      ordered.mine.find((t) => t.id !== ticketId && t.waiting_since) ??
      ordered.others.find((t) => t.id !== ticketId && !t.assignee_id && t.waiting_since);
    navigate(next?.id ?? null);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && navigate(null)}>
      <DialogContent
        showClose={false}
        className="flex h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-[1480px] gap-0 overflow-hidden p-0 sm:h-[min(92dvh,960px)]"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Conversa do atendimento</DialogTitle>

        <nav className="hidden w-72 shrink-0 flex-col border-r border-border md:flex" aria-label="Atendimentos abertos">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Atendimentos</span>
              <span className="text-xs text-muted-foreground tabular">{tickets?.length ?? 0}</span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar" className="h-8 pl-8 text-[13px]" aria-label="Filtrar atendimentos" />
            </div>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto">
            <ListSection title="Com você" tickets={ordered.mine} all={tickets ?? []} activeId={ticketId} onSelect={navigate} />
            <ListSection title="Fila" tickets={ordered.others} all={tickets ?? []} activeId={ticketId} onSelect={navigate} />
          </div>
        </nav>

        <ChatPanel
          key={ticketId}
          ticketId={ticketId}
          panelOpen={panelOpen}
          onPanelOpenChange={setPanelOpen}
          onClose={() => navigate(null)}
          onNavigate={navigate}
          onFinished={goToNext}
        />
      </DialogContent>
    </Dialog>
  );
}

function ListSection({
  title,
  tickets,
  all,
  activeId,
  onSelect,
}: {
  title: string;
  tickets: TicketWithRelations[];
  /** Todos os abertos: os destinos possíveis da mescla. */
  all: TicketWithRelations[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const { memberById } = useApp();
  if (tickets.length === 0) return null;
  return (
    <div className="flex flex-col">
      <span className="sticky top-0 z-10 border-b border-border bg-popover px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title} · {tickets.length}
      </span>
      {tickets.map((t) => {
        const name = contactLabel(t.contact);
        const active = t.id === activeId;
        const assignee = t.assignee_id ? memberById.get(t.assignee_id) : null;
        return (
          <div key={t.id} className="group/item relative">
          <button
            type="button"
            onClick={() => onSelect(t.id)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent/60",
              active && "bg-accent shadow-[inset_2px_0_0_var(--primary)]",
            )}
          >
            <Avatar name={name} src={t.contact?.avatar_url} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold">{name}</span>
                {t.waiting_since && <SlaBadge waitingSince={t.waiting_since} compact className="px-1 py-0 text-[9.5px]" />}
              </span>
              <span className="truncate text-xs text-muted-foreground">{t.last_message_preview ?? t.subject}</span>
              {assignee && title === "Fila" && <span className="truncate text-[11px] text-muted-foreground/80">com {assignee.name}</span>}
            </span>
          </button>
          <MergeMenu source={t} targets={all.filter((o) => o.id !== t.id && o.group_jid === t.group_jid)} activeId={activeId} onSelect={onSelect} />
          </div>
        );
      })}
    </div>
  );
}

/** "Mesclar em…": junta este atendimento a outro aberto do mesmo grupo. */
function MergeMenu({
  source,
  targets,
  activeId,
  onSelect,
}: {
  source: TicketWithRelations;
  targets: TicketWithRelations[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();
  if (targets.length === 0) return null;

  const merge = (target: TicketWithRelations) =>
    start(async () => {
      const res = await mergeTickets({ sourceId: source.id, targetId: target.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`#${source.number} mesclado em #${target.number}.`);
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
      await queryClient.invalidateQueries({ queryKey: ["ticket", target.id] });
      // Quem estava na conversa de origem vai para o destino.
      if (activeId === source.id) onSelect(target.id);
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-xs"
          disabled={pending}
          className="absolute right-2 top-2 bg-card opacity-0 transition-opacity focus-visible:opacity-100 group-hover/item:opacity-100 data-[state=open]:opacity-100"
          aria-label={`Mesclar #${source.number} em outro atendimento`}
          title="Mesclar em outro atendimento do mesmo grupo"
        >
          {pending ? <Loader2 className="animate-spin" /> : <Merge />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Mesclar #{source.number} em…</DropdownMenuLabel>
        {targets.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => merge(t)}>
            <Avatar name={contactLabel(t.contact)} src={t.contact?.avatar_url} size="xs" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px]">
                #{t.number} · {contactLabel(t.contact)}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">{t.last_message_preview ?? t.subject}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
