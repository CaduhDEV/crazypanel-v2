"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Ticket, TicketWithRelations } from "@/lib/types";

export const OPEN_TICKETS_KEY = ["tickets", "open"] as const;

const SELECT =
  "*, contact:contacts!contact_id(id, name, phone, lid, kind, company_id, avatar_url, company:companies(name)), group:wa_groups(jid, name)";

const DEMO_TICKETS: TicketWithRelations[] = [
  {
    id: "demo-ticket-1",
    number: 1042,
    group_jid: "group-crm@g.us",
    contact_id: "c-1",
    status: "open",
    assignee_id: null,
    subject: "Chave de webhook",
    waiting_since: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    last_customer_message_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    last_message_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    last_message_preview: "Preciso alinhar a chave do webhook de eventos com o n8n.",
    first_response_at: null,
    message_count: 3,
    category: "suporte",
    topic: null,
    resolved_by: null,
    resolution_message_id: null,
    close_reason: null,
    close_note: null,
    closed_at: null,
    closed_by: null,
    opened_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    contact: {
      id: "c-1",
      name: "Guinho",
      phone: "5511999990001",
      lid: null,
      kind: "customer",
      company_id: "comp-1",
      avatar_url: null,
      company: { name: "DataCrazy CRM" },
    },
    group: { jid: "group-crm@g.us", name: "Comunidade CRM" },
  },
  {
    id: "demo-ticket-2",
    number: 1043,
    group_jid: "group-api@g.us",
    contact_id: "c-2",
    status: "open",
    assignee_id: null,
    subject: "Erro 429 na API",
    waiting_since: new Date(Date.now() - 4 * 60 * 1000 - 30 * 1000).toISOString(),
    last_customer_message_at: new Date(Date.now() - 4 * 60 * 1000 - 30 * 1000).toISOString(),
    last_message_at: new Date(Date.now() - 4 * 60 * 1000 - 30 * 1000).toISOString(),
    last_message_preview: "A rota de sincronização de contatos retornou status 429.",
    first_response_at: null,
    message_count: 5,
    category: "integracao",
    topic: null,
    resolved_by: null,
    resolution_message_id: null,
    close_reason: null,
    close_note: null,
    closed_at: null,
    closed_by: null,
    opened_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    contact: {
      id: "c-2",
      name: "Carlus",
      phone: "5511999990002",
      lid: null,
      kind: "customer",
      company_id: "comp-2",
      avatar_url: null,
      company: { name: "API & Integrações" },
    },
    group: { jid: "group-api@g.us", name: "API & Integrações" },
  },
  {
    id: "demo-ticket-3",
    number: 1044,
    group_jid: "group-vip@g.us",
    contact_id: "c-3",
    status: "open",
    assignee_id: null,
    subject: "Urgente: mensagens em lote",
    waiting_since: new Date(Date.now() - 24 * 60 * 1000).toISOString(),
    last_customer_message_at: new Date(Date.now() - 24 * 60 * 1000).toISOString(),
    last_message_at: new Date(Date.now() - 24 * 60 * 1000).toISOString(),
    last_message_preview: "Urgente: mensagens em lote travadas na fila!",
    first_response_at: null,
    message_count: 8,
    category: "suporte",
    topic: null,
    resolved_by: null,
    resolution_message_id: null,
    close_reason: null,
    close_note: null,
    closed_at: null,
    closed_by: null,
    opened_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    contact: {
      id: "c-3",
      name: "Stevam.ecom BR",
      phone: "5511999990003",
      lid: null,
      kind: "customer",
      company_id: "comp-3",
      avatar_url: null,
      company: { name: "E-Commerce Express" },
    },
    group: { jid: "group-vip@g.us", name: "Comunidade CRM" },
  },
];

async function fetchOpenTickets(ids?: string[]): Promise<TicketWithRelations[]> {
  try {
    let query = createClient().from("tickets").select(SELECT).eq("status", "open");
    if (ids) query = query.in("id", ids);
    const { data, error } = await query.order("waiting_since", { ascending: true, nullsFirst: false }).limit(2000);
    if (error) throw error;
    return (data ?? []) as TicketWithRelations[];
  } catch (err) {
    if (typeof window !== "undefined" && (document.cookie.includes("dev_demo_session=1") || process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("dummy"))) {
      return ids ? DEMO_TICKETS.filter((t) => ids.includes(t.id)) : DEMO_TICKETS;
    }
    throw err;
  }
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
 * Escuta mudanças em `tickets` e aplica cada uma direto na fila.
 */
export function useTicketsRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window !== "undefined" && (document.cookie.includes("dev_demo_session=1") || process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("dummy"))) {
      return;
    }

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

      if (payload.eventType === "DELETE" || row.status !== "open") {
        touch(row.id);
        closing.delete(row.id);
        if (list?.some((t) => t.id === row.id)) queryClient.setQueryData(OPEN_TICKETS_KEY, list.filter((t) => t.id !== row.id));
        return;
      }
      if (!list || closing.has(row.id)) return;
      const i = list.findIndex((t) => t.id === row.id);
      if (i < 0) {
        missing.add(row.id);
        return fetchMissing();
      }
      touch(row.id);
      const current = list[i];
      const next = list.slice();
      next[i] = { ...current, ...row, contact: current.contact, group: current.group } as TicketWithRelations;
      queryClient.setQueryData(OPEN_TICKETS_KEY, next);
      if ((row.contact_id && row.contact_id !== current.contact_id) || (row.group_jid && row.group_jid !== current.group_jid)) {
        missing.add(row.id);
        fetchMissing();
      }
    };

    const channel = supabase
      .channel("tickets-feed")
      .on<Ticket>("postgres_changes", { event: "*", schema: "public", table: "tickets" }, apply)
      .subscribe((status) => {
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
