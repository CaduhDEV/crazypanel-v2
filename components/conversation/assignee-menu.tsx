"use client";

import { useTransition } from "react";
import { ArrowRightLeft, ChevronDown, Hand, Loader2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { assignTicket } from "@/lib/tickets/actions";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/components/app/app-context";
import { patchOpenTicket } from "@/components/app/use-open-tickets";
import { ticketKey, type ThreadTicket } from "@/components/conversation/use-thread";

/** Responsável pelo atendimento: assumir, transferir ou devolver para a fila. */
export function AssigneeMenu({ ticketId, assigneeId, disabled }: { ticketId: string; assigneeId: string | null; disabled: boolean }) {
  const { profile, members, memberById } = useApp();
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();
  const assignee = assigneeId ? memberById.get(assigneeId) : null;

  const assign = (id: string | null, message: string) =>
    start(async () => {
      const res = await assignTicket({ ticketId, assigneeId: id });
      if (!res.ok) {
        queryClient.invalidateQueries({ queryKey: ticketKey(ticketId) });
        return void toast.error(res.error);
      }
      // Reflete na conversa e na fila na hora; o Realtime confirma para os outros.
      patchOpenTicket(queryClient, ticketId, { assignee_id: id });
      queryClient.setQueryData<ThreadTicket | null>(ticketKey(ticketId), (t) => t && { ...t, assignee_id: id });
      toast.success(message);
    });

  if (!assigneeId && !disabled) {
    return (
      <Button size="sm" onClick={() => assign(profile.id, "Atendimento assumido.")} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Hand />} Assumir
      </Button>
    );
  }

  const others = members.filter((m) => m.id !== assigneeId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="outline" size="sm" className="gap-1.5 pl-1.5" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Avatar name={assignee?.name} src={assignee?.avatar_url} size="xs" />}
          <span className="max-w-28 truncate">{assigneeId === profile.id ? "Você" : (assignee?.name ?? "Sem responsável")}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {assigneeId !== profile.id && (
          <DropdownMenuItem onSelect={() => assign(profile.id, "Atendimento assumido.")}>
            <Hand /> Assumir
          </DropdownMenuItem>
        )}
        {assigneeId && (
          <DropdownMenuItem onSelect={() => assign(null, "Atendimento devolvido para a fila.")}>
            <UserMinus /> Devolver para a fila
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5">
          <ArrowRightLeft className="size-3.5" /> Transferir para
        </DropdownMenuLabel>
        <div className="scroll-thin max-h-56 overflow-y-auto">
          {others
            .filter((m) => m.id !== profile.id)
            .map((m) => (
              <DropdownMenuItem key={m.id} onSelect={() => assign(m.id, `Transferido para ${m.name}.`)}>
                <Avatar name={m.name} src={m.avatar_url} size="xs" />
                <span className="truncate">{m.name}</span>
              </DropdownMenuItem>
            ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
