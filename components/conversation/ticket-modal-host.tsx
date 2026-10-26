"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Workspace } from "@/components/conversation/workspace";

/**
 * Abre a conversa (?ticket=<id>) por cima da página atual, em qualquer tela do
 * painel. O Inbox monta o próprio modal; aqui fica o das outras páginas.
 */
export function TicketModalHost() {
  const pathname = usePathname();
  const ticketId = useSearchParams().get("ticket");
  if (!ticketId || pathname === "/atendimento") return null;
  return <Workspace ticketId={ticketId} />;
}
