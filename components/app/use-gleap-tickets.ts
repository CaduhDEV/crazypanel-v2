"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface ContactGleapTicket {
  contact_id: string;
  gleap_ticket_id: string;
  bug_id: number | null;
  type: string;
  board_name: string | null;
  url: string | null;
  status: string;
  title: string | null;
  assignee_name: string | null;
  has_agent_reply: boolean;
  gleap_created_at: string | null;
  gleap_updated_at: string | null;
  synced_at: string;
}

export const GLEAP_TICKETS_KEY = ["gleap-tickets"] as const;

const TYPE_LABELS: Record<string, string> = {
  INQUIRY: "Conversa",
  BOT: "Bot",
  BUG: "Bug",
  FEATURE_REQUEST: "Sugestão",
};
export const gleapTypeLabel = (type: string) =>
  TYPE_LABELS[type] ?? type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");
/** Nome do board (gravado na sincronização); sem ele, um rótulo a partir do tipo. */
export const gleapBoardLabel = (t: Pick<ContactGleapTicket, "type" | "board_name">) => t.board_name ?? gleapTypeLabel(t.type);
export const gleapStatusLabel = (status: string) => (status === "INPROGRESS" ? "Em andamento" : "Aberto");

/**
 * Chamados ativos no Gleap por contato (cópia local, renovada pela rotina).
 * Poucas centenas de linhas: carrega tudo uma vez e compartilha entre telas.
 */
export function useGleapTicketsByContact() {
  return useQuery({
    queryKey: GLEAP_TICKETS_KEY,
    queryFn: async (): Promise<Map<string, ContactGleapTicket[]>> => {
      const { data, error } = await createClient()
        .from("contact_gleap_tickets")
        .select("*")
        .order("gleap_updated_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      const map = new Map<string, ContactGleapTicket[]>();
      for (const row of (data ?? []) as ContactGleapTicket[]) {
        const list = map.get(row.contact_id) ?? [];
        list.push(row);
        map.set(row.contact_id, list);
      }
      return map;
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}
