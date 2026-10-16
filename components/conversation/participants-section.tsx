"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { removeTicketParticipant } from "@/lib/tickets/actions";
import { contactLabel, formatPhone } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useParticipants, type Participant, type ThreadTicket } from "@/components/conversation/use-thread";

/** Leads do atendimento: o principal e quem entrou depois (pode ser retirado). */
export function ParticipantsSection({ ticket, onNavigate }: { ticket: ThreadTicket; onNavigate?: (ticketId: string) => void }) {
  const { data } = useParticipants(ticket.id);
  const [removing, setRemoving] = useState<Participant | null>(null);
  const active = (data ?? []).filter((p) => !p.removed_at && p.contact);
  // Só aparece quando há mais de um lead: com um só, o painel já mostra tudo.
  if (active.length < 2) return null;

  const closed = ticket.status === "closed";
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Leads neste atendimento · {active.length}
      </h3>
      <ul className="flex flex-col gap-1">
        {active.map((p) => {
          const owner = p.contact_id === ticket.contact_id;
          const name = contactLabel(p.contact!);
          return (
            <li key={p.contact_id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/40">
              <Avatar name={name} src={p.contact!.avatar_url} size="xs" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{name}</span>
                {p.contact!.phone && <span className="text-[11px] text-muted-foreground">{formatPhone(p.contact!.phone)}</span>}
              </span>
              {owner ? (
                <Badge variant="outline">principal</Badge>
              ) : (
                !closed && (
                  <Tip label="Retirar do atendimento">
                    <Button variant="ghost" size="icon-sm" onClick={() => setRemoving(p)} aria-label={`Retirar ${name}`}>
                      <UserMinus />
                    </Button>
                  </Tip>
                )
              )}
            </li>
          );
        })}
      </ul>
      <RemoveDialog ticketId={ticket.id} target={removing} onClose={() => setRemoving(null)} onNavigate={onNavigate} />
    </section>
  );
}

function RemoveDialog({
  ticketId,
  target,
  onClose,
  onNavigate,
}: {
  ticketId: string;
  target: Participant | null;
  onClose: () => void;
  onNavigate?: (ticketId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();
  const name = target?.contact ? contactLabel(target.contact) : "";

  const remove = (openTicket: boolean) =>
    start(async () => {
      if (!target) return;
      const res = await removeTicketParticipant({ ticketId, contactId: target.contact_id, openTicket });
      if (!res.ok) return void toast.error(res.error);
      await queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onClose();
      const newId = res.data;
      toast.success(openTicket ? `${name} agora tem um atendimento próprio.` : `${name} foi retirado.`, {
        action: newId && onNavigate ? { label: "Abrir", onClick: () => onNavigate(newId) } : undefined,
      });
    });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Retirar {name} do atendimento?</DialogTitle>
          <DialogDescription>
            As mensagens dele saem deste atendimento e ele não volta a entrar aqui. Se for outro assunto, abra um
            atendimento separado; se era só conversa, apenas retire.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={pending} onClick={() => remove(false)}>
            Só retirar
          </Button>
          <Button disabled={pending} onClick={() => remove(true)}>
            {pending && <Loader2 className="animate-spin" />} Abrir atendimento separado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
