"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, CircleCheck, Coffee, Loader2, Lock, LockOpen, MessagesSquare, PanelRightClose, PanelRightOpen, Upload, X } from "lucide-react";
import { cn, contactLabel, formatDayLabel, formatPhone, formatTime } from "@/lib/utils";
import { CLOSE_REASONS, type Message, type TicketEvent } from "@/lib/types";
import { classificationLabel, type Taxonomy } from "@/lib/taxonomy";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton, Tip } from "@/components/ui/misc";
import { useApp, type Member } from "@/components/app/app-context";
import { usePresence } from "@/components/app/presence";
import { SlaBadge } from "@/components/inbox/sla-badge";
import { AssigneeMenu } from "@/components/conversation/assignee-menu";
import { Composer, type ComposerHandle } from "@/components/conversation/composer";
import { FinishDialog } from "@/components/conversation/finish-dialog";
import { LeadPanel } from "@/components/conversation/lead-panel";
import { MessageItem } from "@/components/conversation/message-item";
import { ContextSuggestions } from "@/components/conversation/context-suggestions";
import { AiSuggestionBox, AiTestButton } from "@/components/conversation/ai-suggestion";
import { resolveAuthor } from "@/components/conversation/message-utils";
import {
  useGroupSettingEvents,
  useParticipants,
  useThread,
  useThreadRealtime,
  useTicket,
  useTicketEvents,
  type GroupSettingEvent,
} from "@/components/conversation/use-thread";

type TimelineItem =
  | { type: "message"; at: string; message: Message }
  | { type: "event"; at: string; event: TicketEvent }
  | { type: "group"; at: string; group: GroupSettingEvent };

export function ChatPanel({
  ticketId,
  panelOpen,
  onPanelOpenChange,
  onClose,
  onNavigate,
  onFinished,
}: {
  ticketId: string;
  /** Dados do lead na lateral: só carregam quando abertos. */
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  onClose: () => void;
  onNavigate: (ticketId: string) => void;
  onFinished: () => void;
}) {
  const { memberById, profile, taxonomy, isAdmin } = useApp();
  const { viewersByTicket, setViewingTicket } = usePresence();
  const { data: ticket, isLoading: ticketLoading } = useTicket(ticketId);
  const { data: thread, isLoading: threadLoading } = useThread(ticketId);
  const { data: events } = useTicketEvents(ticketId);
  const { data: participants } = useParticipants(ticketId);
  const { data: groupEvents } = useGroupSettingEvents(ticketId, ticket?.group_jid, ticket?.opened_at, ticket?.closed_at);
  // Leads ativos (dono + participantes) e o nome de todos, inclusive retirados.
  const { activeLeadIds, leadNameById } = useMemo(() => {
    const active = new Set<string>();
    const names = new Map<string, string>();
    for (const p of participants ?? []) {
      if (!p.removed_at) active.add(p.contact_id);
      if (p.contact) names.set(p.contact_id, contactLabel(p.contact));
    }
    return { activeLeadIds: active, leadNameById: names };
  }, [participants]);
  const messageIds = useMemo(() => thread?.messages.map((m) => m.id) ?? [], [thread]);
  useThreadRealtime(ticketId, messageIds, ticket?.group_jid);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [finishMode, setFinishMode] = useState<"resolved" | "parallel" | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Teste da IA: quando foi enviado (o quadro mostra "aguardando" até a resposta chegar).
  const [aiSentAt, setAiSentAt] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const lastCountRef = useRef(0);

  // O Workspace monta um ChatPanel por atendimento (key), então o estado local já começa limpo.
  useEffect(() => {
    setViewingTicket(ticketId);
    return () => setViewingTicket(null);
  }, [ticketId, setViewingTicket]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...(thread?.messages ?? []).map((m) => ({ type: "message" as const, at: m.sent_at, message: m })),
      ...(events ?? []).map((e) => ({ type: "event" as const, at: e.created_at, event: e })),
      ...(groupEvents ?? []).map((g) => ({ type: "group" as const, at: g.created_at, group: g })),
    ];
    return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [thread, events, groupEvents]);

  // Abre no fim da conversa; depois só acompanha mensagens novas se o atendente já estava no fim.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !thread) return;
    const count = thread.messages.length;
    if (lastCountRef.current === 0 || (count > lastCountRef.current && atBottom)) {
      el.scrollTop = el.scrollHeight;
    }
    lastCountRef.current = count;
  }, [thread, atBottom]);

  const jumpTo = useCallback(
    (waId: string) => {
      const target = thread?.messages.find((m) => m.wa_id === waId);
      if (!target) return;
      document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlight(target.id);
      setTimeout(() => setHighlight(null), 1600);
    },
    [thread],
  );

  const handleReply = useCallback((m: Message) => {
    setReplyTo(m);
    composerRef.current?.focus();
  }, []);

  if (ticketLoading || threadLoading) return <ChatSkeleton />;
  if (!ticket || !thread) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={MessagesSquare} title="Atendimento não encontrado" action={<Button variant="outline" onClick={onClose}>Fechar</Button>} />
      </div>
    );
  }

  const closed = ticket.status === "closed";
  const viewers = (viewersByTicket[ticketId] ?? []).filter((v) => v.id !== profile.id);
  const name = contactLabel(ticket.contact);
  const replyAuthor = replyTo ? resolveAuthor(replyTo, thread.contacts, memberById).name : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (closed || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) composerRef.current?.attach(file);
        }}
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
          <Avatar name={name} src={ticket.contact?.avatar_url} />
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{name}</span>
              <span className="hidden items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:flex">
                <MessagesSquare className="size-3" />
                <span className="max-w-48 truncate">{ticket.group?.name ?? "Grupo"}</span>
              </span>
              {ticket.group?.is_announce && (
                <Tip label="Grupo fechado: só os admins enviam mensagens">
                  <span className="flex items-center gap-1 rounded-md border border-warning/30 bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning">
                    <Lock className="size-3" /> Fechado
                  </span>
                </Tip>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              #{ticket.number}
              {ticket.contact?.phone && ` · ${formatPhone(ticket.contact.phone)}`}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {closed ? (
              <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">
                <CircleCheck className="size-3.5" /> Finalizado
              </span>
            ) : (
              <SlaBadge waitingSince={ticket.waiting_since} />
            )}
            {viewers.length > 0 && (
              <Tip label={`Também abertos por: ${viewers.map((v) => v.name).join(", ")}`}>
                <span>
                  <AvatarStack people={viewers} size="sm" />
                </span>
              </Tip>
            )}
            <AssigneeMenu ticketId={ticket.id} assigneeId={ticket.assignee_id} disabled={closed} />
            {isAdmin && !closed && <AiTestButton ticketId={ticket.id} onSent={() => setAiSentAt(Date.now())} />}
            <Tip label={panelOpen ? "Ocultar dados do lead" : "Mostrar dados do lead"}>
              <Button variant="ghost" size="icon-sm" onClick={() => onPanelOpenChange(!panelOpen)} className="hidden xl:inline-flex" aria-label="Dados do lead">
                {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </Tip>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar conversa">
              <X />
            </Button>
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
          }}
          className="scroll-thin flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-4 sm:px-5"
        >
          {timeline.map((item, i) => {
            const prev = timeline[i - 1];
            const newDay = !prev || new Date(prev.at).toDateString() !== new Date(item.at).toDateString();
            return (
              <Fragment key={item.type === "message" ? item.message.id : item.type === "event" ? `e${item.event.id}` : `g${item.group.id}`}>
                {newDay && (
                  <div className="sticky top-0 z-10 flex justify-center py-1">
                    <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
                      {formatDayLabel(item.at)}
                    </span>
                  </div>
                )}
                {item.type === "message" ? (
                  <MessageItem
                    message={item.message}
                    thread={thread}
                    reactions={thread.reactionsByMessage.get(item.message.id) ?? []}
                    isLeadMessage={
                      !!item.message.contact_id &&
                      (item.message.contact_id === ticket.contact_id || activeLeadIds.has(item.message.contact_id))
                    }
                    highlighted={highlight === item.message.id}
                    onReply={handleReply}
                    onJumpTo={jumpTo}
                    onSplit={onNavigate}
                  />
                ) : item.type === "event" ? (
                  <EventLine event={item.event} memberById={memberById} leadNameById={leadNameById} taxonomy={taxonomy} />
                ) : (
                  <GroupSettingLine event={item.group} />
                )}
              </Fragment>
            );
          })}
        </div>

        {!atBottom && (
          <Button
            variant="outline"
            size="icon-sm"
            className="absolute bottom-40 right-6 rounded-full shadow-md"
            onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}
            aria-label="Ir para a última mensagem"
          >
            <ArrowDown />
          </Button>
        )}

        <AiSuggestionBox ticket={ticket} waitingSince={aiSentAt} />
        <ContextSuggestions ticketId={ticket.id} disabled={closed} />

        <Composer
          ref={composerRef}
          ticketId={ticket.id}
          disabled={closed}
          replyTo={replyTo}
          replyAuthor={replyAuthor}
          onCancelReply={() => setReplyTo(null)}
        />

        {!closed && (
          <div className="flex items-center justify-end gap-2 px-4 pb-3">
            <Tip label="Conversa que não pedia resposta da equipe">
              <Button variant="outline" size="sm" onClick={() => setFinishMode("parallel")}>
                <Coffee /> Assunto paralelo
              </Button>
            </Tip>
            <Button
              size="sm"
              className="bg-success text-white hover:bg-success/90 dark:text-[#0b2a17]"
              onClick={() => setFinishMode("resolved")}
            >
              <CircleCheck /> Finalizar
            </Button>
          </div>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/85 text-sm font-medium text-primary">
            <Upload className="size-6" /> Solte para anexar
          </div>
        )}
      </section>

      {panelOpen && (
        <div className="hidden duration-200 animate-in fade-in slide-in-from-right-4 xl:flex">
          <LeadPanel ticket={ticket} onNavigate={onNavigate} />
        </div>
      )}

      <FinishDialog
        ticketId={ticket.id}
        ticketNumber={ticket.number}
        ownerId={ticket.contact_id}
        suggestion={ticket.ai_classified_at ? { category: ticket.ai_category ?? null, topic: ticket.ai_topic ?? null, resolvedBy: ticket.ai_resolved_by ?? null, summary: ticket.ai_summary ?? null } : null}
        mode={finishMode} onClose={() => setFinishMode(null)} onFinished={() => { setFinishMode(null); onFinished(); }} />
    </div>
  );
}

function EventLine({
  event,
  memberById,
  leadNameById,
  taxonomy,
}: {
  event: TicketEvent;
  memberById: Map<string, Member>;
  leadNameById: Map<string, string>;
  taxonomy: Taxonomy;
}) {
  const actor = event.actor_id ? memberById.get(event.actor_id)?.name : null;
  const data = event.data as Record<string, string | boolean | null>;
  const lead = typeof data.contact_id === "string" ? (leadNameById.get(data.contact_id) ?? "Um lead") : "Um lead";
  const to = typeof data.to === "string" ? memberById.get(data.to)?.name : typeof data.assignee_id === "string" ? memberById.get(data.assignee_id)?.name : null;

  let text: string;
  switch (event.type) {
    case "opened":
      text = data.split_participant
        ? `${actor ?? "Alguém"} separou este lead de outro atendimento`
        : data.from
          ? `${actor ?? "Alguém"} separou esta mensagem em um novo atendimento`
          : "Atendimento aberto";
      break;
    case "participant_added":
      text = data.suggestion ? `${lead} entrou no atendimento (sugestão aceita por ${actor ?? "alguém"})` : `${lead} entrou no atendimento`;
      break;
    case "merged":
      text = data.from_number ? `${actor ?? "Alguém"} mesclou o atendimento #${data.from_number} aqui` : data.into_number ? `${actor ?? "Alguém"} mesclou este atendimento no #${data.into_number}` : `${actor ?? "Alguém"} juntou este atendimento a outro em andamento`;
      break;
    case "participant_removed":
      text = `${actor ?? "Alguém"} retirou ${lead}${data.to ? " (abriu um atendimento separado)" : ""}`;
      break;
    case "reopened":
      text = "Reaberto: o lead respondeu ao atendimento finalizado";
      break;
    case "assigned":
      text = data.claimed
        ? `${actor} puxou da fila`
        : data.auto
          ? `${actor} assumiu ao responder`
          : actor && to && actor !== to
            ? `${actor} transferiu para ${to}`
            : `${to ?? actor ?? "Alguém"} assumiu`;
      break;
    case "unassigned":
      text = data.reason === "deactivated" ? "Responsável desativado: atendimento voltou para a fila" : `${actor ?? "Alguém"} devolveu para a fila`;
      break;
    case "closed": {
      const reason = (data.reason as keyof typeof CLOSE_REASONS) ?? "resolved";
      const category = classificationLabel(taxonomy, data.category as string | null, data.topic as string | null);
      text = data.ai
        ? `Encerrado pela IA${category ? ` · ${category}` : ""}`
        : reason === "resolved"
          ? `Finalizado por ${actor ?? "alguém"}${category ? ` · ${category}` : ""}`
          : `${CLOSE_REASONS[reason]}${actor ? ` · ${actor}` : ""}`;
      break;
    }
    case "message_moved":
      text = `${actor ?? "Alguém"} separou uma mensagem em outro atendimento`;
      break;
    default:
      text = event.type;
  }

  return (
    <div className="flex items-center gap-3 px-6 py-0.5 text-[11.5px] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span className="text-center">
        {text} · {formatTime(event.created_at)}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

const GROUP_SETTING_TEXT: Record<GroupSettingEvent["type"], (who: string) => string> = {
  group_closed: (who) => `${who} proibiu os membros de enviar mensagens no grupo`,
  group_opened: (who) => `${who} permitiu que os membros enviem mensagens no grupo`,
  group_info_locked: (who) => `${who} deixou só os admins editarem os dados do grupo`,
  group_info_unlocked: (who) => `${who} permitiu que os membros editem os dados do grupo`,
};

/** Aviso de grupo trancado/destrancado, com cadeado (como uma notificação do WhatsApp). */
function GroupSettingLine({ event }: { event: GroupSettingEvent }) {
  const locks = event.type === "group_closed" || event.type === "group_info_locked";
  const Icon = locks ? Lock : LockOpen;
  return (
    <div className="flex justify-center px-6 py-0.5">
      <span
        className={cn(
          "flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] shadow-sm",
          locks ? "border-warning/30 bg-warning-soft text-warning" : "border-success/30 bg-success-soft text-success",
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">
          {GROUP_SETTING_TEXT[event.type](event.actor_name ?? "Um admin")} · {formatTime(event.created_at)}
        </span>
      </span>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        {[60, 40, 72, 35, 55].map((w, i) => (
          <Skeleton key={i} className={cn("h-14 rounded-lg", i % 2 ? "self-end" : "")} style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 border-t border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando conversa…
      </div>
    </div>
  );
}
