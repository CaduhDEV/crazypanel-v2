"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { closeTicket } from "@/lib/tickets/actions";
import { cn } from "@/lib/utils";
import { TICKET_CATEGORIES, type TicketCategory } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function FinishDialog({
  ticketId,
  mode,
  onClose,
  onFinished,
}: {
  ticketId: string;
  mode: "resolved" | "parallel" | null;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const parallel = mode === "parallel";

  const submit = () =>
    start(async () => {
      const res = await closeTicket({
        ticketId,
        reason: parallel ? "parallel" : "resolved",
        category: category ?? undefined,
        note: note || undefined,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(parallel ? "Encerrado como assunto paralelo." : "Atendimento finalizado.");
      setCategory(null);
      setNote("");
      onFinished();
    });

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{parallel ? "Encerrar como assunto paralelo" : "Finalizar atendimento"}</DialogTitle>
          <DialogDescription>
            {parallel
              ? "Use quando a conversa não pedia resposta da equipe (papo entre membros, divulgação, off-topic). Não conta como atendimento resolvido."
              : "A categoria alimenta as métricas da comunidade (dúvidas, elogios, reclamações)."}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-[13px] font-medium">
            Categoria {parallel && <span className="font-normal text-muted-foreground">(opcional)</span>}
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TICKET_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(category === c.value ? null : c.value)}
                aria-pressed={category === c.value}
                className={cn(
                  "h-9 rounded-md border px-3 text-left text-[13px] transition-colors",
                  category === c.value
                    ? "border-primary bg-primary-soft font-medium text-primary dark:text-[#a9c6f2]"
                    : "border-border hover:bg-accent",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>

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
            disabled={pending || (!parallel && !category)}
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
