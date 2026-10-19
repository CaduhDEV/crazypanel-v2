"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** Quantas solicitações de entrada aguardam um admin (contador do menu). */
export function usePendingJoinRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["join-requests", "pending-count"],
    enabled,
    queryFn: async () => {
      const { count, error } = await createClient()
        .from("join_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      // Antes da migration a tabela não existe: sem contador, sem erro na tela.
      return error ? 0 : (count ?? 0);
    },
    refetchInterval: 60_000,
  });
}
