"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { contactLabel } from "@/lib/utils";
import { CLOSE_REASONS, TICKET_CATEGORIES, type ContactKind, type Message, type TicketEvent } from "@/lib/types";
import type { Member } from "@/components/app/app-context";
import { resolveAuthor, type Author } from "@/components/conversation/message-utils";
import { useThread, useTicket, useTicketEvents, type ThreadData, type ThreadTicket } from "@/components/conversation/use-thread";

/** Lead do atendimento (principal ou participante), com a empresa vinculada. */
export interface TranscriptLead {
  id: string;
  name: string;
  phone: string | null;
  kind: ContactKind;
  avatarUrl: string | null;
  company: { name: string; external_id: string | null; cnpj: string | null } | null;
  owner: boolean;
  removed: boolean;
}

export type TimelineItem = { type: "message"; at: string; message: Message } | { type: "event"; at: string; event: TicketEvent };

export interface Transcript {
  ticket: ThreadTicket;
  thread: ThreadData;
  events: TicketEvent[];
  leads: TranscriptLead[];
  leadById: Map<string, TranscriptLead>;
  timeline: TimelineItem[];
}

export function useTranscript(ticketId: string) {
  const ticket = useTicket(ticketId);
  const thread = useThread(ticketId);
  const events = useTicketEvents(ticketId);
  const leads = useQuery({
    queryKey: ["ticket", ticketId, "transcript-leads"],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("ticket_participants")
        .select("contact_id, removed_at, contact:contacts(id, name, phone, lid, kind, avatar_url, company:companies(name, external_id, cnpj))")
        .eq("ticket_id", ticketId)
        .order("joined_at");
      if (error) throw error;
      return (data ?? []) as unknown as {
        contact_id: string;
        removed_at: string | null;
        contact: {
          id: string;
          name: string | null;
          phone: string | null;
          lid: string | null;
          kind: ContactKind;
          avatar_url: string | null;
          company: TranscriptLead["company"];
        } | null;
      }[];
    },
  });

  const data = useMemo<Transcript | null>(() => {
    if (!ticket.data || !thread.data) return null;
    const list: TranscriptLead[] = (leads.data ?? [])
      .filter((p) => p.contact)
      .map((p) => ({
        id: p.contact_id,
        name: contactLabel(p.contact!),
        phone: p.contact!.phone,
        kind: p.contact!.kind,
        avatarUrl: p.contact!.avatar_url,
        company: p.contact!.company,
        owner: p.contact_id === ticket.data!.contact_id,
        removed: !!p.removed_at,
      }))
      .sort((a, b) => Number(b.owner) - Number(a.owner));

    const timeline: TimelineItem[] = [
      ...thread.data.messages.map((m) => ({ type: "message" as const, at: m.sent_at, message: m })),
      ...(events.data ?? [])
        .filter((e) => e.type !== "opened" || e.data?.from) // a abertura já aparece no cabeçalho
        .map((e) => ({ type: "event" as const, at: e.created_at, event: e })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    return {
      ticket: ticket.data,
      thread: thread.data,
      events: events.data ?? [],
      leads: list,
      leadById: new Map(list.map((l) => [l.id, l])),
      timeline,
    };
  }, [ticket.data, thread.data, events.data, leads.data]);

  return { data, isLoading: ticket.isLoading || thread.isLoading || leads.isLoading, notFound: !ticket.isLoading && !ticket.data };
}

/** Equipe (pelo painel, pelo celular ou contato marcado como equipe) fica do lado "enviada". */
export function isTeamSide(m: Message, t: Transcript): boolean {
  if (m.from_me) return true;
  const kind = m.contact_id ? (t.leadById.get(m.contact_id)?.kind ?? t.thread.contacts.get(m.contact_id)?.kind) : null;
  return kind === "team";
}

export function authorOf(m: Message, t: Transcript, memberById: Map<string, Member>): Author & { company: string | null } {
  const author = resolveAuthor(m, t.thread.contacts, memberById);
  const lead = m.contact_id ? t.leadById.get(m.contact_id) : undefined;
  return { ...author, company: !m.from_me && lead?.company ? lead.company.name : null };
}

export const categoryLabel = (v: string | null) => TICKET_CATEGORIES.find((c) => c.value === v)?.label ?? null;

/** Texto curto dos eventos do atendimento (transferências, entradas, finalização…). */
export function eventText(e: TicketEvent, t: Transcript, memberById: Map<string, Member>): string {
  const actor = e.actor_id ? memberById.get(e.actor_id)?.name : null;
  const d = e.data as Record<string, string | boolean | null>;
  const member = (id: unknown) => (typeof id === "string" ? memberById.get(id)?.name : null);
  const lead = typeof d.contact_id === "string" ? (t.leadById.get(d.contact_id)?.name ?? "Um lead") : "Um lead";
  switch (e.type) {
    case "opened":
      return `${actor ?? "Alguém"} separou em um novo atendimento`;
    case "reopened":
      return "Reaberto: o lead respondeu ao atendimento finalizado";
    case "assigned":
      return d.claimed
        ? `${actor} puxou da fila`
        : d.auto
          ? `${actor} assumiu ao responder`
          : actor && member(d.to) && actor !== member(d.to)
            ? `${actor} transferiu para ${member(d.to)}`
            : `${member(d.to) ?? member(d.assignee_id) ?? actor ?? "Alguém"} assumiu`;
    case "unassigned":
      return `${actor ?? "Alguém"} devolveu para a fila`;
    case "closed": {
      const reason = (d.reason as keyof typeof CLOSE_REASONS) ?? "resolved";
      const category = categoryLabel(d.category as string | null);
      return reason === "resolved" ? `Finalizado por ${actor ?? "alguém"}${category ? ` · ${category}` : ""}` : CLOSE_REASONS[reason];
    }
    case "message_moved":
      return `${actor ?? "Alguém"} separou uma mensagem em outro atendimento`;
    case "participant_added":
      return d.suggestion ? `${lead} entrou no atendimento (sugestão aceita por ${actor ?? "alguém"})` : `${lead} entrou no atendimento`;
    case "merged":
      return d.from_number ? `${actor ?? "Alguém"} mesclou o atendimento #${d.from_number} aqui` : d.into_number ? `${actor ?? "Alguém"} mesclou este atendimento no #${d.into_number}` : `${actor ?? "Alguém"} juntou este atendimento a outro em andamento`;
    case "participant_removed":
      return `${actor ?? "Alguém"} retirou ${lead}`;
    default:
      return e.type;
  }
}
