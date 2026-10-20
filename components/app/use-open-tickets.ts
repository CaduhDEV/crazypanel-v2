"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Ticket, TicketWithRelations } from "@/lib/types";

export const OPEN_TICKETS_KEY = ["tickets", "open"] as const;

const SELECT =
  "*, contact:contacts!contact_id(id, name, phone, lid, kind, company_id, avatar_url, company:companies(name)), group:wa_groups(jid, name)";

async function fetchOpenTickets(ids?: string[]): Promise<TicketWithRelations[]> {
  let query = createClient().from("tickets").select(SELECT).eq("status", "open");
  if (ids) query = query.in("id", ids);
  const { data, error } = await query.order("waiting_since", { ascending: true, nullsFirst: false }).limit(2000);
  if (error) throw error;
  return (data ?? []) as TicketWithRelations[];
}

// Quando o Realtime (ou uma ação deste atendente) mexeu em cada atendimento.
// Uma consulta que saiu antes disso traz a versão velha: vale a da lista.
const touchedAt = new Map<string, number>();
const touch = (id: string) => touchedAt.set(id, Date.now());
// Finalizados por este atendente e ainda não confirmados pelo Realtime: ficam
// fora da fila mesmo que um evento ou consulta de antes do commit diga "aberto".
const closing = new Map<string, number>();

/**
 * Junta o resultado de uma consulta à fila em cache: o que mudou depois que a
 * consulta saiu fica como está na lista (senão um atendimento recém-finalizado
 * voltaria para a tela).
 */
function merge(cached: TicketWithRelations[] | undefined, rows: TicketWithRelations[], startedAt: number, partial: boolean) {
  const fresh = (id: string) => (touchedAt.get(id) ?? 0) >= startedAt;
  const keep = rows.filter((t) => !fresh(t.id) && !closing.has(t.id));
  const keepIds = new Set(keep.map((t) => t.id));
  const rest = (cached ?? []).filter((t) => !keepIds.has(t.id) && !closing.has(t.id) && (partial || fresh(t.id)));
  const now = Date.now();
  for (const [id, at] of touchedAt) if (now - at > 120_000) touchedAt.delete(id);
  for (const [id, at] of closing) if (now - at > 60_000) closing.delete(id);
  return [...rest, ...keep];
}

/** Atendimentos abertos (fila). Atualizado pelo TicketsRealtime montado no shell. */
export function useOpenTickets() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: OPEN_TICKETS_KEY,
    queryFn: async () => {
      const startedAt = Date.now();
      const rows = await fetchOpenTickets();
      return merge(queryClient.getQueryData(OPEN_TICKETS_KEY), rows, startedAt, false);
    },
    staleTime: 60_000,
    // Rede de segurança: se o Realtime cair em silêncio (notebook em espera, túnel
    // instável), a fila se corrige sozinha em até 30 s e ao voltar para a aba.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Tira o atendimento da fila na hora (antes do servidor confirmar). Devolve a
 * função que recarrega a fila de verdade, para usar se a ação falhar.
 */
export function dropOpenTicket(queryClient: QueryClient, id: string): () => void {
  touch(id);
  closing.set(id, Date.now());
  queryClient.setQueryData<TicketWithRelations[]>(OPEN_TICKETS_KEY, (list) => list?.filter((t) => t.id !== id));
  return () => {
    touchedAt.delete(id);
    closing.delete(id);
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };
}

/**
 * Escuta mudanças em `tickets` e aplica cada uma direto na fila: o evento já traz
 * a linha nova, então mensagem chegando, responsável trocando ou atendimento
 * finalizado não recarregam a fila inteira para cada atendente. Só busca do
 * banco o que ainda não está na lista (atendimento novo ou reaberto, com o
 * contato e o grupo). Monte uma vez, no shell.
 */
export function useTicketsRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    const missing = new Set<string>();
    let fetchTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchMissing = () => {
      if (fetchTimer) clearTimeout(fetchTimer);
      fetchTimer = setTimeout(async () => {
        const ids = [...missing];
        missing.clear();
        const startedAt = Date.now();
        try {
          const rows = await fetchOpenTickets(ids);
          queryClient.setQueryData<TicketWithRelations[]>(OPEN_TICKETS_KEY, (list) => list && merge(list, rows, startedAt, true));
        } catch {
          queryClient.invalidateQueries({ queryKey: OPEN_TICKETS_KEY });
        }
      }, 120);
    };

    const apply = (payload: RealtimePostgresChangesPayload<Ticket>) => {
      const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Partial<Ticket>;
      if (!row.id || (payload.eventType !== "DELETE" && !row.status)) {
        queryClient.invalidateQueries({ queryKey: OPEN_TICKETS_KEY });
        return;
      }
      const list = queryClient.getQueryData<TicketWithRelations[]>(OPEN_TICKETS_KEY);

      // Saiu da fila (finalizado ou apagado). Marca mesmo com a fila carregando,
      // para a consulta em andamento não trazê-lo de volta.
      if (payload.eventType === "DELETE" || row.status !== "open") {
        touch(row.id);
        closing.delete(row.id); // confirmado
        if (list?.some((t) => t.id === row.id)) queryClient.setQueryData(OPEN_TICKETS_KEY, list.filter((t) => t.id !== row.id));
        return;
      }
      if (!list || closing.has(row.id)) return; // carregando (a consulta já vem com ele) ou finalizando
      const i = list.findIndex((t) => t.id === row.id);
      if (i < 0) {
        missing.add(row.id);
        return fetchMissing();
      }
      touch(row.id);
      const current = list[i];
      // Colunas que o evento não trouxe ficam como estavam; contato e grupo vêm da lista.
      const next = list.slice();
      next[i] = { ...current, ...row, contact: current.contact, group: current.group } as TicketWithRelations;
      queryClient.setQueryData(OPEN_TICKETS_KEY, next);
      // Trocou de dono ou de grupo (mescla/separação): busca de novo com os dados certos.
      if ((row.contact_id && row.contact_id !== current.contact_id) || (row.group_jid && row.group_jid !== current.group_jid)) {
        missing.add(row.id);
        fetchMissing();
      }
    };

    const channel = supabase
      .channel("tickets-feed")
      .on<Ticket>("postgres_changes", { event: "*", schema: "public", table: "tickets" }, apply)
      .subscribe((status) => {
        // Ao conectar (ou reconectar), pode ter perdido eventos: recarrega a fila inteira uma vez.
        if (status === "SUBSCRIBED") queryClient.invalidateQueries({ queryKey: OPEN_TICKETS_KEY });
      });

    return () => {
      if (fetchTimer) clearTimeout(fetchTimer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}

/** Aplica na fila uma mudança que este atendente acabou de fazer (sem esperar o Realtime). */
export function patchOpenTicket(queryClient: QueryClient, id: string, patch: Partial<Ticket>) {
  touch(id);
  queryClient.setQueryData<TicketWithRelations[]>(OPEN_TICKETS_KEY, (list) => list?.map((t) => (t.id === id ? { ...t, ...patch } : t)));
}
