"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { sendTicketToAi } from "@/lib/admin/ai";
import { classificationLabel } from "@/lib/taxonomy";
import { cn, formatRelative } from "@/lib/utils";
import { RESOLVED_BY } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/misc";
import { useApp } from "@/components/app/app-context";
import type { ThreadTicket } from "@/components/conversation/use-thread";

/** Botão de teste (admin): manda só este atendimento para o agente. Nunca encerra. */
export function AiTestButton({ ticketId, onSent }: { ticketId: string; onSent: () => void }) {
  const [pending, start] = useTransition();
  return (
    <Tip label="Classificar com IA (teste): manda só este atendimento e mostra a resposta aqui, sem encerrar">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        aria-label="Classificar com IA"
        onClick={() =>
          start(async () => {
            const res = await sendTicketToAi({ ticketId });
            if (!res.ok) return void toast.error(res.error);
            onSent();
            toast.success("Enviado ao agente. A resposta aparece aqui na conversa.");
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      </Button>
    </Tip>
  );
}

/**
 * Resposta do agente de IA para este atendimento: classificação, quem resolveu,
 * se precisa da equipe, confiança e resumo. Atualiza em tempo real.
 */
export function AiSuggestionBox({ ticket, waitingSince }: { ticket: ThreadTicket; waitingSince: number | null }) {
  const { taxonomy } = useApp();
  const [hidden, setHidden] = useState<string | null>(null);
  const classifiedAt = ticket.ai_classified_at ?? null;
  // Margem de 30 s: o envio usa o relógio do navegador e a resposta, o do servidor.
  const waiting = waitingSince !== null && (!classifiedAt || Date.parse(classifiedAt) < waitingSince - 30_000);

  if (waiting) {
    return (
      <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-primary/20 bg-primary-soft/50 px-3 py-2 text-[12.5px] text-muted-foreground sm:mx-5">
        <Loader2 className="size-3.5 animate-spin text-primary" /> Aguardando a resposta do agente de IA…
      </div>
    );
  }
  if (!classifiedAt || hidden === classifiedAt) return null;

  const label = classificationLabel(taxonomy, ticket.ai_category, ticket.ai_topic) ?? `${ticket.ai_category ?? "?"} · ${ticket.ai_topic ?? "?"}`;
  const by = RESOLVED_BY.find((r) => r.value === ticket.ai_resolved_by)?.label ?? "Ninguém";
  const confidence = ticket.ai_confidence != null ? Math.round(Number(ticket.ai_confidence) * 100) : null;

  return (
    <div className="mx-3 mb-2 flex flex-col gap-1.5 rounded-md border border-primary/20 bg-primary-soft/50 px-3 py-2 text-[12.5px] sm:mx-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium">
          <Sparkles className="size-3.5 text-primary" /> Sugestão da IA
        </span>
        <span>{label}</span>
        <span className="text-muted-foreground">Resolveu: {by}</span>
        <span className={cn("font-medium", ticket.ai_needs_team ? "text-warning" : "text-success")}>
          {ticket.ai_needs_team ? "Precisa da equipe" : "Não precisa da equipe"}
        </span>
        {confidence !== null && <span className="text-muted-foreground">Confiança {confidence}%</span>}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          {formatRelative(classifiedAt)}
          <button type="button" onClick={() => setHidden(classifiedAt)} className="hover:text-foreground" aria-label="Ocultar sugestão">
            ✕
          </button>
        </span>
      </div>
      {ticket.ai_summary && <p className="text-foreground/85">{ticket.ai_summary}</p>}
    </div>
  );
}
