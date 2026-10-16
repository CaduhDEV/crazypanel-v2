"use client";

import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { acceptContextSuggestion, dismissContextSuggestion } from "@/lib/tickets/actions";
import { contactLabel, formatRelative } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { messageSnippet } from "@/components/conversation/message-utils";
import { suggestionsKey, useContextSuggestions, type ContextSuggestion } from "@/components/conversation/use-thread";

/**
 * Mensagens de outros leads no grupo enquanto este atendimento está em
 * andamento. O atendente decide se fazem parte do assunto: aceitar junta o
 * atendimento do lead a este; ignorar deixa separado.
 */
export function ContextSuggestions({ ticketId, disabled }: { ticketId: string; disabled?: boolean }) {
  const { data } = useContextSuggestions(ticketId);
  if (!data?.length || disabled) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border bg-primary-soft/30 px-3 py-2 sm:px-5">
      <span className="text-[11px] font-medium text-muted-foreground">
        {data.length === 1 ? "Mensagem no grupo durante este atendimento" : `${data.length} mensagens no grupo durante este atendimento`}
      </span>
      {data.map((s) => (
        <SuggestionRow key={s.id} ticketId={ticketId} suggestion={s} />
      ))}
    </div>
  );
}

function SuggestionRow({ ticketId, suggestion: s }: { ticketId: string; suggestion: ContextSuggestion }) {
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();
  const name = contactLabel(s.contact);
  const text = s.message ? messageSnippet({ body: s.message.body, kind: s.message.kind, media_name: null }) : "Mensagem";

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: suggestionsKey(ticketId) }),
      queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] }),
      queryClient.invalidateQueries({ queryKey: ["tickets"] }),
    ]);

  const accept = () =>
    start(async () => {
      const res = await acceptContextSuggestion({ id: s.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${name} entrou neste atendimento.`);
      await refresh();
    });

  const dismiss = () =>
    start(async () => {
      const res = await dismissContextSuggestion({ id: s.id });
      if (!res.ok) return void toast.error(res.error);
      await refresh();
    });

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-2">
      <Avatar name={name} src={s.contact?.avatar_url} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-1.5 text-[12.5px]">
          <span className="truncate font-medium">{name}</span>
          {s.contact?.company?.name && <span className="truncate text-[11px] text-muted-foreground">· {s.contact.company.name}</span>}
          <span className="shrink-0 text-[11px] text-muted-foreground">· {formatRelative(s.message?.sent_at ?? s.created_at)}</span>
        </span>
        <span className="line-clamp-1 text-[12.5px] text-muted-foreground">{text}</span>
      </div>
      <Button size="sm" onClick={accept} disabled={pending} title="Trazer este lead e as mensagens dele para este atendimento">
        {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Adicionar ao atendimento
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={dismiss} disabled={pending} aria-label="Ignorar sugestão" title="Ignorar: continua num atendimento separado">
        <X />
      </Button>
    </div>
  );
}
