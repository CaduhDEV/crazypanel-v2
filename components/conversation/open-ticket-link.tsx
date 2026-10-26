"use client";

import { setTicketParam } from "@/components/conversation/ticket-url";

/**
 * Link para um atendimento: abre o modal da conversa na própria página (sem ir
 * para o Inbox). Ctrl/⌘ + clique ou o botão do meio abrem em outra aba.
 */
export function OpenTicketLink({ ticketId, className, children }: { ticketId: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={`/atendimento?ticket=${ticketId}`}
      className={className}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        setTicketParam(ticketId, "push");
      }}
    >
      {children}
    </a>
  );
}
