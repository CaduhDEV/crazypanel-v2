"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Company, Contact, Message, MessageReaction, Ticket, TicketEvent, WaGroup } from "@/lib/types";

export type ContactLite = Pick<Contact, "id" | "name" | "phone" | "lid" | "kind">;
export type QuotedLite = Pick<Message, "id" | "wa_id" | "body" | "kind" | "sender_name" | "from_me" | "contact_id" | "author_id" | "media_name">;

export interface ThreadTicket extends Ticket {
  contact: (Contact & { company: Pick<Company, "id" | "name" | "external_id" | "cnpj"> | null }) | null;
  group: Pick<WaGroup, "jid" | "name" | "is_announce"> | null;
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
export const groupEventsKey = (id: string) => ["ticket", id, "group-events"] as const;

export const GROUP_SETTING_TYPES = ["group_closed", "group_opened", "group_info_locked", "group_info_unlocked"] as const;

export interface GroupSettingEvent {
  id: number;
  type: (typeof GROUP_SETTING_TYPES)[number];
  actor_name: string | null;
  created_at: string;
}

/** Grupo trancado/destrancado durante o atendimento (aviso com cadeado na conversa). */
export function useGroupSettingEvents(id: string, groupJid: string | undefined, from: string | undefined, to: string | null | undefined) {
  return useQuery({
    queryKey: groupEventsKey(id),
    enabled: !!groupJid && !!from,
    queryFn: async (): Promise<GroupSettingEvent[]> => {
      let q = createClient()
        .from("community_events")
        .select("id, type, actor_name, created_at")
        .eq("group_jid", groupJid!)
        .in("type", [...GROUP_SETTING_TYPES])
        .gte("created_at", from!)
        .order("created_at", { ascending: true })
        .limit(50);
      if (to) q = q.lte("created_at", to);
      const { data, error } = await q;
      // Antes da migration o tipo não existe: sem avisos, sem erro na tela.
      if (error) return [];
      return (data ?? []) as GroupSettingEvent[];
    },
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKey(id),
    queryFn: async (): Promise<ThreadTicket | null> => {
      const { data, error } = await createClient()
        .from("tickets")
        .select("*, contact:contacts!contact_id(*, company:companies(id, name, external_id, cnpj)), group:wa_groups(jid, name, is_announce)")
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

const time = (iso: string) => Date.parse(iso) || 0;

/**
 * Coloca (ou atualiza) uma mensagem na conversa em cache, sem recarregar tudo.
 * Devolve false quando falta algo para exibi-la (o contato ou a mensagem citada)
 * e a conversa precisa ser buscada de novo.
 */
export function upsertThreadMessage(queryClient: QueryClient, ticketId: string, row: Message): boolean {
  const data = queryClient.getQueryData<ThreadData>(threadKey(ticketId));
  if (!data) return false;
  const i = data.messages.findIndex((m) => m.id === row.id);
  // Colunas que o evento não trouxe ficam como estavam.
  const merged = i >= 0 ? { ...data.messages[i], ...row } : row;
  const messages = data.messages.slice();
  if (i >= 0) messages[i] = merged;
  else messages.push(merged);
  if (i < 0 || merged.sent_at !== data.messages[i].sent_at) messages.sort((x, y) => time(x.sent_at) - time(y.sent_at));
  const quotedByWaId = merged.wa_id ? new Map(data.quotedByWaId).set(merged.wa_id, merged) : data.quotedByWaId;
  queryClient.setQueryData<ThreadData>(threadKey(ticketId), { ...data, messages, quotedByWaId });
  return !(merged.contact_id && !data.contacts.has(merged.contact_id)) && !(merged.quoted_wa_id && !quotedByWaId.has(merged.quoted_wa_id));
}

/** Tira da conversa em cache uma mensagem que não chegou a ser gravada. */
export function removeThreadMessage(queryClient: QueryClient, ticketId: string, messageId: string) {
  queryClient.setQueryData<ThreadData>(threadKey(ticketId), (data) => data && { ...data, messages: data.messages.filter((m) => m.id !== messageId) });
}

/** Realtime do atendimento aberto: mensagens, reações, histórico e o próprio ticket. */
export function useThreadRealtime(id: string, messageIds: string[], groupJid?: string) {
  const queryClient = useQueryClient();
  // Mensagens deste atendimento, para filtrar as reações. Num ref: a inscrição não
  // é refeita a cada mensagem nova (perderia eventos enquanto reconecta).
  const watched = useRef(new Set<string>());
  useEffect(() => {
    watched.current = new Set(messageIds);
  }, [messageIds]);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshThread = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => queryClient.invalidateQueries({ queryKey: threadKey(id) }), 150);
    };

    const channel = supabase
      .channel(`ticket:${id}`)
      // A mensagem vem inteira no evento: entra na conversa na hora, sem recarregar as outras.
      .on<Message>("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `ticket_id=eq.${id}` }, (payload) => {
        const row = payload.new as Message;
        if (payload.eventType === "DELETE" || !row?.id || row.ticket_id !== id) return refreshThread();
        if (!upsertThreadMessage(queryClient, id, row)) refreshThread();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
        const row = (payload.new && "message_id" in payload.new ? payload.new : payload.old) as { message_id?: string };
        if (row?.message_id && watched.current.has(row.message_id)) refreshThread();
      })
      .on<TicketEvent>("postgres_changes", { event: "*", schema: "public", table: "ticket_events", filter: `ticket_id=eq.${id}` }, (payload) => {
        queryClient.invalidateQueries({ queryKey: eventsKey(id) });
        // Mensagens saíram deste atendimento (separada, mesclada, lead retirado): o
        // filtro do Realtime não avisa quem sai, então recarrega a conversa.
        const type = (payload.new as Partial<TicketEvent>)?.type;
        if (type === "message_moved" || type === "merged" || type === "participant_removed") refreshThread();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_context_suggestions", filter: `ticket_id=eq.${id}` }, () =>
        queryClient.invalidateQueries({ queryKey: suggestionsKey(id) }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_participants", filter: `ticket_id=eq.${id}` }, () =>
        queryClient.invalidateQueries({ queryKey: participantsKey(id) }),
      )
      // O atendimento muda a cada mensagem (prévia, espera do SLA): aplica a linha do
      // evento. Troca de dono ou de status busca de novo (contato e empresa vêm junto).
      .on<Ticket>("postgres_changes", { event: "UPDATE", schema: "public", table: "tickets", filter: `id=eq.${id}` }, (payload) => {
        const row = payload.new as Partial<Ticket>;
        const current = queryClient.getQueryData<ThreadTicket | null>(ticketKey(id));
        if (!current || !row.id || (row.contact_id && row.contact_id !== current.contact_id) || (row.status && row.status !== current.status)) {
          queryClient.invalidateQueries({ queryKey: ticketKey(id) });
          return;
        }
        queryClient.setQueryData<ThreadTicket>(ticketKey(id), { ...current, ...row, contact: current.contact, group: current.group });
      })
      .subscribe((status) => {
        // Ao reconectar, pode ter perdido eventos.
        if (status === "SUBSCRIBED") refreshThread();
      });
    // Grupo trancado/destrancado: o aviso aparece na conversa e o cadeado no cabeçalho.
    const group = groupJid
      ? supabase
          .channel(`group-settings:${id}`)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_events", filter: `group_jid=eq.${groupJid}` }, () => {
            queryClient.invalidateQueries({ queryKey: groupEventsKey(id) });
            queryClient.invalidateQueries({ queryKey: ticketKey(id) });
          })
          .subscribe()
      : null;

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
      if (group) supabase.removeChannel(group);
    };
  }, [id, groupJid, queryClient]);
}
