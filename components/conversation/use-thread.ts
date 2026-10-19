"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Company, Contact, Message, MessageReaction, Ticket, TicketEvent, WaGroup } from "@/lib/types";

export type ContactLite = Pick<Contact, "id" | "name" | "phone" | "lid" | "kind">;
export type QuotedLite = Pick<Message, "id" | "wa_id" | "body" | "kind" | "sender_name" | "from_me" | "contact_id" | "author_id" | "media_name">;

export interface ThreadTicket extends Ticket {
  contact: (Contact & { company: Pick<Company, "id" | "name" | "external_id" | "cnpj"> | null }) | null;
  group: Pick<WaGroup, "jid" | "name"> | null;
}

export interface ThreadData {
  messages: Message[];
  reactionsByMessage: Map<string, MessageReaction[]>;
  contacts: Map<string, ContactLite>;
  /** Mensagens citadas, pelo wa_id (inclui as de fora deste atendimento). */
  quotedByWaId: Map<string, QuotedLite>;
}

export const ticketKey = (id: string) => ["ticket", id] as const;
export const threadKey = (id: string) => ["ticket", id, "messages"] as const;
export const eventsKey = (id: string) => ["ticket", id, "events"] as const;
export const participantsKey = (id: string) => ["ticket", id, "participants"] as const;
export const suggestionsKey = (id: string) => ["ticket", id, "suggestions"] as const;

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKey(id),
    queryFn: async (): Promise<ThreadTicket | null> => {
      const { data, error } = await createClient()
        .from("tickets")
        .select("*, contact:contacts!contact_id(*, company:companies(id, name, external_id, cnpj)), group:wa_groups(jid, name)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as ThreadTicket | null;
    },
  });
}

export function useThread(id: string) {
  return useQuery({
    queryKey: threadKey(id),
    queryFn: async (): Promise<ThreadData> => {
      const supabase = createClient();
      const { data: messages, error } = await supabase
        .from("messages")
        .select("*")
        .eq("ticket_id", id)
        .order("sent_at", { ascending: true })
        .limit(800);
      if (error) throw error;
      const list = (messages ?? []) as Message[];

      const ids = list.map((m) => m.id);
      const contactIds = [...new Set(list.map((m) => m.contact_id).filter((x): x is string => !!x))];
      const byWa = new Map(list.filter((m) => m.wa_id).map((m) => [m.wa_id!, m]));
      const missingQuoted = [...new Set(list.map((m) => m.quoted_wa_id).filter((w): w is string => !!w && !byWa.has(w)))];

      const [reactions, contacts, quoted] = await Promise.all([
        ids.length ? supabase.from("message_reactions").select("*").in("message_id", ids) : Promise.resolve({ data: [] }),
        contactIds.length ? supabase.from("contacts").select("id, name, phone, lid, kind").in("id", contactIds) : Promise.resolve({ data: [] }),
        missingQuoted.length
          ? supabase
              .from("messages")
              .select("id, wa_id, body, kind, sender_name, from_me, contact_id, author_id, media_name")
              .in("wa_id", missingQuoted)
          : Promise.resolve({ data: [] }),
      ]);

      const reactionsByMessage = new Map<string, MessageReaction[]>();
      for (const r of (reactions.data ?? []) as MessageReaction[]) {
        const arr = reactionsByMessage.get(r.message_id) ?? [];
        arr.push(r);
        reactionsByMessage.set(r.message_id, arr);
      }

      const quotedByWaId = new Map<string, QuotedLite>(byWa as Map<string, QuotedLite>);
      for (const q of (quoted.data ?? []) as QuotedLite[]) if (q.wa_id) quotedByWaId.set(q.wa_id, q);

      return {
        messages: list,
        reactionsByMessage,
        contacts: new Map(((contacts.data ?? []) as ContactLite[]).map((c) => [c.id, c])),
        quotedByWaId,
      };
    },
  });
}

export interface Participant {
  contact_id: string;
  joined_at: string;
  removed_at: string | null;
  contact: Pick<Contact, "id" | "name" | "phone" | "lid" | "kind" | "avatar_url"> | null;
}

/** Leads do atendimento, inclusive os retirados (para nomear os eventos). */
export function useParticipants(id: string) {
  return useQuery({
    queryKey: participantsKey(id),
    queryFn: async (): Promise<Participant[]> => {
      const { data, error } = await createClient()
        .from("ticket_participants")
        .select("contact_id, joined_at, removed_at, contact:contacts(id, name, phone, lid, kind, avatar_url)")
        .eq("ticket_id", id)
        .order("joined_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Participant[];
    },
  });
}

export interface ContextSuggestion {
  id: number;
  created_at: string;
  source_ticket_id: string | null;
  /** during_service: mensagem durante o atendimento; member_reply: provável resposta de outro membro a esta dúvida. */
  reason?: "during_service" | "member_reply";
  contact: { id: string; name: string | null; phone: string | null; lid: string | null; kind: Contact["kind"]; avatar_url: string | null; company: { name: string } | null } | null;
  message: { body: string | null; kind: Message["kind"]; sent_at: string } | null;
}

/** Mensagens de outros leads sugeridas como contexto deste atendimento (pendentes). */
export function useContextSuggestions(id: string) {
  return useQuery({
    queryKey: suggestionsKey(id),
    queryFn: async (): Promise<ContextSuggestion[]> => {
      const { data, error } = await createClient()
        .from("ticket_context_suggestions")
        .select("*, contact:contacts(id, name, phone, lid, kind, avatar_url, company:companies(name)), message:messages(body, kind, sent_at)")
        .eq("ticket_id", id)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      // Antes da migration subir a tabela não existe: sem sugestões, sem erro na tela.
      if (error) return [];
      return (data ?? []) as unknown as ContextSuggestion[];
    },
  });
}

export function useTicketEvents(id: string) {
  return useQuery({
    queryKey: eventsKey(id),
    queryFn: async (): Promise<TicketEvent[]> => {
      const { data, error } = await createClient()
        .from("ticket_events")
        .select("*")
        .eq("ticket_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TicketEvent[];
    },
  });
}

/** Realtime do atendimento aberto: mensagens, reações, histórico e o próprio ticket. */
export function useThreadRealtime(id: string, messageIds: string[]) {
  const queryClient = useQueryClient();
  const idsKey = messageIds.join(",");

  useEffect(() => {
    const supabase = createClient();
    const watched = new Set(idsKey ? idsKey.split(",") : []);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshThread = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => queryClient.invalidateQueries({ queryKey: threadKey(id) }), 150);
    };

    const channel = supabase
      .channel(`ticket:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `ticket_id=eq.${id}` }, refreshThread)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
        const row = (payload.new && "message_id" in payload.new ? payload.new : payload.old) as { message_id?: string };
        if (row?.message_id && watched.has(row.message_id)) refreshThread();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_events", filter: `ticket_id=eq.${id}` }, () =>
        queryClient.invalidateQueries({ queryKey: eventsKey(id) }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_context_suggestions", filter: `ticket_id=eq.${id}` }, () =>
        queryClient.invalidateQueries({ queryKey: suggestionsKey(id) }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_participants", filter: `ticket_id=eq.${id}` }, () =>
        queryClient.invalidateQueries({ queryKey: participantsKey(id) }),
      )
      // Atendimento mudou (inclusive juntado a outro): as mensagens podem ter saído
      // dele, e o filtro do Realtime não avisa quem sai, então recarrega as duas.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tickets", filter: `id=eq.${id}` }, () => {
        queryClient.invalidateQueries({ queryKey: ticketKey(id) });
        refreshThread();
      })
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [id, idsKey, queryClient]);
}
