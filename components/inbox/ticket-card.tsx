"use client";

import { Clock, MessagesSquare } from "lucide-react";
import { cn, contactLabel, formatRelative, pluralize } from "@/lib/utils";
import type { TicketWithRelations } from "@/lib/types";
import { needsCompany } from "@/lib/types";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Tip } from "@/components/ui/misc";
import { SlaBadge } from "@/components/inbox/sla-badge";
import { useApp } from "@/components/app/app-context";
import { usePresence } from "@/components/app/presence";
import { useNow } from "@/components/app/use-now";
import { gleapBoardLabel, useGleapTicketsByContact } from "@/components/app/use-gleap-tickets";

export function TicketCard({ ticket, onOpen }: { ticket: TicketWithRelations; onOpen: () => void }) {
  const { memberById, profile } = useApp();
  const { viewersByTicket } = usePresence();
  const now = useNow();
  const viewers = (viewersByTicket[ticket.id] ?? []).filter((v) => v.id !== profile.id);
  const assignee = ticket.assignee_id ? memberById.get(ticket.assignee_id) : null;
  const name = contactLabel(ticket.contact);
  const unlinked = needsCompany(ticket.contact?.kind) && !ticket.contact?.company_id;
  const { data: gleapByContact } = useGleapTicketsByContact();
  const gleap = gleapByContact?.get(ticket.contact_id) ?? [];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-input hover:bg-accent/40",
        ticket.assignee_id === profile.id && "border-primary/35",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <MessagesSquare className="size-3.5 shrink-0" />
          <span className="truncate">{ticket.group?.name ?? "Grupo"}</span>
        </span>
        <SlaBadge waitingSince={ticket.waiting_since} />
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={name} src={ticket.contact?.avatar_url} size="sm" />
        <span className="truncate text-sm font-semibold">{name}</span>
        {unlinked && (
          <Tip label="Lead sem empresa vinculada">
            <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-label="Sem vínculo" />
          </Tip>
        )}
        {gleap.length > 0 && (
          <Tip
            label={`Também no Gleap: ${gleap
              .map((t) => `${gleapBoardLabel(t)} (${t.assignee_name ? `com ${t.assignee_name}` : "sem responsável"})`)
              .join(", ")}`}
          >
            <span className="ml-auto shrink-0 rounded border border-warning/40 bg-warning-soft px-1.5 py-px text-[10.5px] font-medium text-warning">
              Gleap
            </span>
          </Tip>
        )}
      </div>

      <p className="line-clamp-3 min-h-[3.75rem] text-[13px] leading-5 text-muted-foreground group-hover:text-foreground/85">
        “{ticket.subject ?? ticket.last_message_preview ?? "Sem conteúdo"}”
      </p>

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Clock className="size-3.5 shrink-0" />
          <span className="truncate">
            {formatRelative(ticket.opened_at, now)} · {pluralize(ticket.message_count, "mensagem", "mensagens")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {viewers.length > 0 && <AvatarStack people={viewers} />}
          {assignee ? (
            <Tip label={assignee.id === profile.id ? "Com você" : `Com ${assignee.name}`}>
              <span>
                <Avatar name={assignee.name} src={assignee.avatar_url} size="xs" className="ring-2 ring-primary/40" />
              </span>
            </Tip>
          ) : (
            <span className="text-muted-foreground/80">sem responsável</span>
          )}
        </span>
      </div>
    </button>
  );
}
