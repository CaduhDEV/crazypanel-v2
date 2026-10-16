"use client";

import { memo, useState, useTransition } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  CornerUpLeft,
  Loader2,
  Pencil,
  RotateCw,
  SmilePlus,
  Split,
  StickyNote,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { confirmMessageContext, deleteMessage, editMessage, moveMessageToNewTicket, reactToMessage, retryMessage } from "@/lib/tickets/actions";
import { cn, formatTime, nameColor } from "@/lib/utils";
import type { Message, MessageReaction } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Tip } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/components/app/app-context";
import { FormattedText, stripFormatting } from "@/components/conversation/formatted-text";
import { MessageMedia } from "@/components/conversation/message-media";
import { messageSnippet, QUICK_REACTIONS, resolveAuthor, type Author } from "@/components/conversation/message-utils";
import { EmojiGrid } from "@/components/conversation/emoji-grid";
import type { ThreadData } from "@/components/conversation/use-thread";

interface Props {
  message: Message;
  thread: ThreadData;
  reactions: MessageReaction[];
  isLeadMessage: boolean;
  highlighted: boolean;
  onReply: (message: Message) => void;
  onJumpTo: (waId: string) => void;
  onSplit: (newTicketId: string) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  thread,
  reactions,
  isLeadMessage,
  highlighted,
  onReply,
  onJumpTo,
  onSplit,
}: Props) {
  const { memberById, profile, isAdmin } = useApp();
  const author = resolveAuthor(message, thread.contacts, memberById);
  // mine: enviada por esta conta (editar, apagar, status de entrega).
  // teamSide: lado das enviadas — esta conta ou um contato marcado como equipe
  // (ex.: alguém da DataCrazy escrevendo pelo próprio WhatsApp).
  const mine = message.from_me && !message.is_note;
  const teamSide =
    mine || (!message.is_note && !!message.contact_id && thread.contacts.get(message.contact_id)?.kind === "team");
  const deleted = !!message.deleted_at;
  const quoted = message.quoted_wa_id ? thread.quotedByWaId.get(message.quoted_wa_id) : undefined;
  const quotedAuthor = quoted ? resolveAuthor({ ...quoted, is_note: false }, thread.contacts, memberById) : null;

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "group/msg flex w-full scroll-mt-24 px-1",
        message.is_note ? "justify-center" : teamSide ? "justify-end" : "justify-start",
      )}
    >
      <div className={cn("flex max-w-[min(42rem,88%)] flex-col gap-1", teamSide && "items-end", message.is_note && "w-full max-w-[min(44rem,96%)]")}>
        <div className={cn("relative flex items-start gap-1.5", teamSide && "flex-row-reverse")}>
          <div
            className={cn(
              "relative flex min-w-0 flex-col gap-1.5 rounded-lg border px-3 py-2 text-[13.5px] leading-[1.45] shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-[box-shadow]",
              message.is_note
                ? "w-full border-dashed border-note-border bg-note text-note-foreground"
                : teamSide
                  ? "border-bubble-me-border bg-bubble-me"
                  : "border-border bg-bubble",
              highlighted && "ring-2 ring-primary/60",
            )}
          >
            <AuthorLine author={author} isLead={isLeadMessage} mine={teamSide} />

            {quoted && quotedAuthor ? (
              <button
                type="button"
                onClick={() => quoted.wa_id && onJumpTo(quoted.wa_id)}
                className="flex flex-col rounded-md border-l-2 border-primary/60 bg-muted/70 px-2 py-1 text-left text-xs hover:bg-muted"
              >
                <span className={cn("font-semibold", nameColor(quotedAuthor.seed))}>{quotedAuthor.name}</span>
                <span className="line-clamp-2 text-muted-foreground">{stripFormatting(messageSnippet(quoted))}</span>
              </button>
            ) : message.quoted_wa_id ? (
              <span className="rounded-md border-l-2 border-border bg-muted/70 px-2 py-1 text-xs italic text-muted-foreground">
                Responde a uma mensagem que não está no painel
              </span>
            ) : null}

            {deleted ? (
              <span className="italic text-muted-foreground">Mensagem apagada</span>
            ) : (
              <>
                <MessageMedia message={message} />
                {message.body && <FormattedText text={message.body} className="whitespace-pre-wrap break-words" />}
              </>
            )}

            <span className={cn("flex items-center gap-1 self-end text-[10.5px] text-muted-foreground", message.is_note && "text-note-foreground/70")}>
              {message.edited_at && !deleted && <span>editada ·</span>}
              {formatTime(message.sent_at)}
              {mine && <StatusIcon message={message} />}
            </span>
          </div>

          {!deleted && (
            <MessageActions
              message={message}
              mine={teamSide}
              canChange={(mine || message.is_note) && (message.author_id === profile.id || isAdmin)}
              canSplit={!message.from_me && !message.is_note && !!message.contact_id}
              onReply={() => onReply(message)}
              onSplit={onSplit}
            />
          )}
        </div>

        {mine && message.status === "failed" && <FailedNotice message={message} />}
        {message.context_check === "pending" && !deleted && !message.from_me && (
          <ContextCheck message={message} alignEnd={teamSide} onSplit={onSplit} />
        )}
        {reactions.length > 0 && <Reactions message={message} reactions={reactions} alignEnd={teamSide} />}
      </div>
    </div>
  );
});

/** Pergunta quando o painel não tem certeza se a mensagem é deste atendimento. */
function ContextCheck({ message, alignEnd, onSplit }: { message: Message; alignEnd: boolean; onSplit: (newTicketId: string) => void }) {
  const [pending, start] = useTransition();
  const confirm = () =>
    start(async () => {
      const res = await confirmMessageContext({ messageId: message.id });
      if (!res.ok) toast.error(res.error);
    });
  const split = () =>
    start(async () => {
      const res = await moveMessageToNewTicket({ messageId: message.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Mensagem separada em um novo atendimento.", { action: { label: "Abrir", onClick: () => onSplit(res.data) } });
    });
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-xs text-warning", alignEnd && "self-end")}>
      <span className="font-medium">Faz parte deste atendimento?</span>
      <Button size="sm" variant="outline" onClick={confirm} disabled={pending} className="h-6 border-warning/40 bg-card px-2 text-foreground">
        {pending ? <Loader2 className="animate-spin" /> : null} Sim
      </Button>
      <Button size="sm" variant="outline" onClick={split} disabled={pending} className="h-6 border-warning/40 bg-card px-2 text-foreground">
        <Split /> Separar
      </Button>
    </div>
  );
}

function AuthorLine({ author, isLead, mine }: { author: Author; isLead: boolean; mine: boolean }) {
  if (author.tag === "Nota interna") {
    return (
      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold">
        <StickyNote className="size-3.5" /> Nota interna · {author.name}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11.5px]">
      <span className={cn("font-semibold", mine ? "text-primary dark:text-[#a9c6f2]" : nameColor(author.seed))}>{author.name}</span>
      {author.tag && (
        <span className="rounded bg-primary-soft px-1 text-[10px] font-medium text-primary dark:text-[#9fc0ef]">{author.tag}</span>
      )}
      {!mine && !isLead && !author.tag && <span className="text-[10.5px] text-muted-foreground">contexto</span>}
    </span>
  );
}

function StatusIcon({ message }: { message: Message }) {
  switch (message.status) {
    case "pending":
      return <Clock3 className="size-3" aria-label="Enviando" />;
    case "sent":
      return <Check className="size-3.5" aria-label="Enviada" />;
    case "delivered":
      return <CheckCheck className="size-3.5" aria-label="Entregue" />;
    case "read":
    case "played":
      return <CheckCheck className="size-3.5 text-[#3b82f6] dark:text-[#7cb3ff]" aria-label="Lida" />;
    case "failed":
      return <AlertCircle className="size-3.5 text-destructive" aria-label="Falhou" />;
    default:
      return null;
  }
}

function FailedNotice({ message }: { message: Message }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex items-center gap-2 text-xs text-destructive">
      {message.error ?? "Falha no envio."}
      <Button
        variant="link"
        size="sm"
        className="h-auto text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await retryMessage({ messageId: message.id });
            if (!res.ok) toast.error(res.error);
            else if (res.data.status === "failed") toast.error(res.data.error ?? "Falhou de novo.");
          })
        }
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />} Reenviar
      </Button>
    </span>
  );
}

function Reactions({ message, reactions, alignEnd }: { message: Message; reactions: MessageReaction[]; alignEnd: boolean }) {
  const groups = new Map<string, MessageReaction[]>();
  for (const r of reactions) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r]);
  const mineEmoji = reactions.find((r) => r.reactor_key === "me")?.emoji;

  const toggle = async (emoji: string) => {
    const res = await reactToMessage({ messageId: message.id, emoji: mineEmoji === emoji ? "" : emoji });
    if (!res.ok) toast.error(res.error);
  };

  return (
    <div className={cn("-mt-0.5 flex flex-wrap gap-1", alignEnd ? "justify-end pr-2" : "pl-2")}>
      {[...groups.entries()].map(([emoji, list]) => (
        <Tip key={emoji} label={list.map((r) => (r.reactor_key === "me" ? "Equipe" : (r.reactor_name ?? "Contato"))).join(", ")}>
          <button
            type="button"
            onClick={() => toggle(emoji)}
            disabled={!message.wa_id}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full border bg-card px-1.5 text-xs shadow-sm transition-colors hover:bg-accent",
              mineEmoji === emoji ? "border-primary/50 bg-primary-soft" : "border-border",
            )}
          >
            <span>{emoji}</span>
            {list.length > 1 && <span className="tabular text-muted-foreground">{list.length}</span>}
          </button>
        </Tip>
      ))}
    </div>
  );
}

function MessageActions({
  message,
  mine,
  canChange,
  canSplit,
  onReply,
  onSplit,
}: {
  message: Message;
  mine: boolean;
  canChange: boolean;
  canSplit: boolean;
  onReply: () => void;
  onSplit: (newTicketId: string) => void;
}) {
  const [reactOpen, setReactOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, start] = useTransition();
  const canReact = !!message.wa_id && !message.is_note;
  const canReply = !!message.wa_id || message.is_note;

  const react = (emoji: string) => {
    setReactOpen(false);
    start(async () => {
      const res = await reactToMessage({ messageId: message.id, emoji });
      if (!res.ok) toast.error(res.error);
    });
  };

  const remove = () =>
    start(async () => {
      const res = await deleteMessage({ messageId: message.id });
      if (!res.ok) toast.error(res.error);
      else toast.success(message.is_note ? "Nota removida." : "Mensagem apagada para todos.");
    });

  const confirmRemove = () => {
    const text = message.is_note ? "Remover esta nota interna?" : "Apagar esta mensagem para todos no grupo?";
    if (window.confirm(text)) remove();
  };

  const split = () =>
    start(async () => {
      const res = await moveMessageToNewTicket({ messageId: message.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Mensagem separada em um novo atendimento.", {
        action: { label: "Abrir", onClick: () => onSplit(res.data) },
      });
    });

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100",
        (reactOpen || pending) && "opacity-100",
        mine && "flex-row-reverse",
      )}
    >
      {canReply && (
        <Tip label="Responder">
          <Button variant="ghost" size="icon-xs" onClick={onReply} aria-label="Responder">
            <CornerUpLeft />
          </Button>
        </Tip>
      )}
      {canReact && (
        <Popover open={reactOpen} onOpenChange={setReactOpen}>
          <Tip label="Reagir">
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Reagir">
                {pending ? <Loader2 className="animate-spin" /> : <SmilePlus />}
              </Button>
            </PopoverTrigger>
          </Tip>
          <PopoverContent className="w-auto p-2" side="top">
            <div className="flex gap-1 border-b border-border pb-2">
              {QUICK_REACTIONS.map((e) => (
                <button key={e} type="button" onClick={() => react(e)} className="rounded-md p-1 text-xl transition-transform hover:scale-110 hover:bg-accent">
                  {e}
                </button>
              ))}
            </div>
            <EmojiGrid onPick={react} className="pt-2" />
          </PopoverContent>
        </Popover>
      )}
      {canSplit && (
        <Tip label="Separar em novo atendimento">
          <Button variant="ghost" size="icon-xs" onClick={split} disabled={pending} aria-label="Separar em novo atendimento">
            <Split />
          </Button>
        </Tip>
      )}
      {canChange && message.kind === "text" && (
        <Tip label="Editar">
          <Button variant="ghost" size="icon-xs" onClick={() => setEditOpen(true)} aria-label="Editar">
            <Pencil />
          </Button>
        </Tip>
      )}
      {canChange && (
        <Tip label={message.is_note ? "Remover nota" : "Apagar para todos"}>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={confirmRemove}
            disabled={pending}
            aria-label={message.is_note ? "Remover nota" : "Apagar para todos"}
            className="hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </Tip>
      )}
      {editOpen && <EditDialog message={message} onClose={() => setEditOpen(false)} />}
    </div>
  );
}

function EditDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const [text, setText] = useState(message.body ?? "");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await editMessage({ messageId: message.id, text });
      if (!res.ok) return void toast.error(res.error);
      onClose();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{message.is_note ? "Editar nota" : "Editar mensagem"}</DialogTitle>
        </DialogHeader>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} autoFocus />
        {!message.is_note && (
          <p className="text-xs text-muted-foreground">O WhatsApp mostra “editada” e só permite editar por até 15 minutos após o envio.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending || !text.trim() || text === message.body}>
            {pending && <Loader2 className="animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
