"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { TicketWithRelations } from "@/lib/types";

export const OPEN_TICKETS_KEY = ["tickets", "open"] as const;

const SELECT =
  "*, contact:contacts!contact_id(id, name, phone, lid, kind, company_id, avatar_url, company:companies(name)), group:wa_groups(jid, name)";

async function fetchOpenTickets(): Promise<TicketWithRelations[]> {
  const { data, error } = await createClient()
    .from("tickets")
    .select(SELECT)
    .eq("status", "open")
    .order("waiting_since", { ascending: true, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as TicketWithRelations[];
}

/** Atendimentos abertos (fila). Atualizado pelo TicketsRealtime montado no shell. */
export function useOpenTickets() {
  return useQuery({
    queryKey: OPEN_TICKETS_KEY,
    queryFn: fetchOpenTickets,
    staleTime: 60_000,
    // Rede de segurança: se o Realtime cair em silêncio (notebook em espera, túnel
    // instável), a fila se corrige sozinha em até 30 s e ao voltar para a aba.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Escuta mudanças em `tickets` e recarrega a fila (com debounce: rajadas de
 * mensagens viram uma consulta só). Monte uma vez, no shell.
 */
export function useTicketsRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["tickets"] });
      }, 350);
    };

    const channel = supabase
      .channel("tickets-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, refresh)
      .subscribe((status) => {
        // Ao reconectar, pode ter perdido eventos: recarrega.
        if (status === "SUBSCRIBED") refresh();
      });

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
