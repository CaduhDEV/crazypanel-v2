"use client";

import { useEffect, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { closeTicket } from "@/lib/tickets/actions";
import { createClient } from "@/lib/supabase/client";
import { cn, formatRelative } from "@/lib/utils";
import {
  RESOLVED_BY,
  TICKET_CATEGORIES,
  topicsOf,
  type Message,
  type ResolvedBy,
  type TicketCategory,
  type TicketTopic,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { messageSnippet } from "@/components/conversation/message-utils";

interface Reply {
  id: string;
  body: string | null;
  kind: Message["kind"];
  media_name: string | null;
  sent_at: string;
  from_me: boolean;
  author_id: string | null;
  contact_id: string | null;
  sender_name: string | null;
  contact: { name: string | null; kind: string } | null;
  author: { name: string } | null;
}

const isTeam = (r: Reply) => r.from_me || !!r.author_id || r.contact?.kind === "team";

/** Respostas do atendimento (de quem não é o autor da dúvida), da mais recente para a mais antiga. */
function useReplies(ticketId: string, ownerId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ticket", ticketId, "replies"],
    enabled,
    queryFn: async (): Promise<Reply[]> => {
      const { data, error } = await createClient()
        .from("messages")
        .select("id, body, kind, media_name, sent_at, from_me, author_id, contact_id, sender_name, contact:contacts(name, kind), author:profiles(name)")
        .eq("ticket_id", ticketId)
        .eq("is_note", false)
        .is("deleted_at", null)
        .order("sent_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return ((data ?? []) as unknown as Reply[]).filter((m) => m.contact_id !== ownerId);
    },
  });
}

export function FinishDialog({
  ticketId,
  ownerId,
  mode,
  onClose,
  onFinished,
}: {
  ticketId: string;
  /** Autor da dúvida: as respostas são as mensagens dos outros. */
  ownerId: string;
  mode: "resolved" | "parallel" | null;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [topic, setTopic] = useState<TicketTopic | null>(null);
  const [resolvedBy, setResolvedBy] = useState<ResolvedBy | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const parallel = mode === "parallel";
  const resolved = mode === "resolved";

  // Assunto paralelo já abre como Comunidade · Off-topic (dá para trocar).
  useEffect(() => {
    if (!parallel) return;
    setCategory((c) => c ?? "comunidade");
    setTopic((t) => t ?? "offtopic");
  }, [parallel]);

  const { data: replies, isLoading: loadingReplies } = useReplies(ticketId, ownerId, resolved);
  // Sugestão de quem resolveu, pelo que aconteceu no atendimento (o atendente pode trocar).
  const community = replies?.some((r) => !isTeam(r)) ?? false;
  const team = replies?.some(isTeam) ?? false;
  const suggested: ResolvedBy | null = community && team ? "both" : community ? "community" : team ? "team" : null;
  const by = resolvedBy ?? suggested;

  const reset = () => {
    setCategory(null);
    setTopic(null);
    setResolvedBy(null);
    setResolution(null);
    setNote("");
  };

  const submit = () =>
    start(async () => {
      if (!category) return;
      const res = await closeTicket({
        ticketId,
        reason: parallel ? "parallel" : "resolved",
        category,
        topic: topic!,
        resolvedBy: resolved ? (by ?? undefined) : undefined,
        resolutionMessageId: resolved ? (resolution ?? undefined) : undefined,
        note: note || undefined,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(parallel ? "Encerrado como assunto paralelo." : "Atendimento finalizado.");
      reset();
      onFinished();
    });

  const ready = !!category && !!topic && (!resolved || !!by);

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{parallel ? "Encerrar como assunto paralelo" : "Finalizar atendimento"}</DialogTitle>
          <DialogDescription>
            {parallel
              ? "Use quando a conversa não pedia resposta da equipe (papo entre membros, divulgação, off-topic). Não conta como atendimento resolvido."
              : "Esses dados alimentam as métricas e o relatório das comunidades."}
          </DialogDescription>
        </DialogHeader>

        <Choices
          legend="Categoria"
          options={TICKET_CATEGORIES}
          value={category}
          columns={4}
          onChange={(v) => {
            setCategory(v);
            if (!topicsOf(v).some((t) => t.value === topic)) setTopic(null);
          }}
        />

        {category && <Choices legend="Subcategoria" options={topicsOf(category)} value={topic} onChange={setTopic} columns={4} />}

        {resolved && (
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 text-[13px] font-medium">
              Quem resolveu{" "}
              {suggested && resolvedBy === null && <span className="font-normal text-muted-foreground">(sugerido pelas respostas do atendimento)</span>}
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {RESOLVED_BY.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setResolvedBy(o.value)}
                  aria-pressed={by === o.value}
                  className={cn(
                    "flex flex-col rounded-md border px-3 py-2 text-left transition-colors",
                    by === o.value ? "border-primary bg-primary-soft text-primary dark:text-[#a9c6f2]" : "border-border hover:bg-accent",
                  )}
                >
                  <span className="text-[13px] font-medium">{o.label}</span>
                  <span className="text-[11.5px] text-muted-foreground">{o.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {resolved && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-medium">
              Mensagem que resolveu <span className="font-normal text-muted-foreground">(opcional)</span>
            </legend>
            {loadingReplies ? (
              <Skeleton className="h-20" />
            ) : !replies?.length ? (
              <p className="text-[12.5px] text-muted-foreground">Ninguém além do autor escreveu neste atendimento.</p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
                {replies.slice(0, 15).map((r) => {
                  const on = resolution === r.id;
                  const who = isTeam(r) ? (r.author?.name ?? r.contact?.name ?? r.sender_name ?? "Equipe") : (r.contact?.name ?? r.sender_name ?? "Membro");
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setResolution(on ? null : r.id)}
                        aria-pressed={on}
                        className={cn(
                          "flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
                          on ? "border-primary bg-primary-soft/60" : "border-border hover:bg-accent",
                        )}
                      >
                        <span className="flex items-baseline gap-1.5 text-[12px]">
                          <span className="font-medium">{who}</span>
                          <span className="text-muted-foreground">· {isTeam(r) ? "equipe" : "comunidade"} · {formatRelative(r.sent_at)}</span>
                        </span>
                        <span className="line-clamp-2 text-[12.5px] text-muted-foreground">{messageSnippet(r)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="finish-note">
            Observação <span className="font-normal text-muted-foreground">(opcional, só a equipe vê)</span>
          </Label>
          <Textarea
            id="finish-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ex.: orientado a recriar a instância; bug repassado ao time."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={parallel ? "default" : "success"}
            onClick={submit}
            disabled={pending || !ready}
            className={cn(!parallel && "border-transparent bg-success text-white hover:bg-success/90 dark:text-[#0b2a17]")}
          >
            {pending && <Loader2 className="animate-spin" />}
            {parallel ? "Encerrar" : "Finalizar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choices<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
  columns = 3,
}: {
  legend: string;
  hint?: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: 3 | 4;
}) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-[13px] font-medium">
        {legend} {hint && <span className="font-normal text-muted-foreground">· {hint}</span>}
      </legend>
      <div className={cn("grid grid-cols-2 gap-2", columns === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
        {options.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            aria-pressed={value === c.value}
            className={cn(
              "h-9 rounded-md border px-3 text-left text-[13px] transition-colors",
              value === c.value ? "border-primary bg-primary-soft font-medium text-primary dark:text-[#a9c6f2]" : "border-border hover:bg-accent",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
