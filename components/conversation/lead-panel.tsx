"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { updateContactNotes } from "@/lib/leads/actions";
import { cn, contactLabel, formatPhone, formatRelative, pluralize } from "@/lib/utils";
import { CLOSE_REASONS, CONTACT_KIND_LABELS, TICKET_CATEGORIES, type Ticket } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useApp } from "@/components/app/app-context";
import { LinkContactDialog } from "@/components/leads/link-contact-dialog";
import { ticketKey, type ThreadTicket } from "@/components/conversation/use-thread";
import { ParticipantsSection } from "@/components/conversation/participants-section";
import { GleapSection } from "@/components/conversation/gleap-section";
import { CompanyChoices } from "@/components/leads/company-choices";
import { CrmSection } from "@/components/conversation/crm-section";

type PanelData = {
  groups: { group_jid: string; is_admin: boolean; left_at: string | null; group: { name: string | null } | null }[];
  history: Pick<Ticket, "id" | "number" | "status" | "category" | "close_reason" | "opened_at" | "subject">[];
};

const categoryLabel = (value: string | null) => TICKET_CATEGORIES.find((c) => c.value === value)?.label;

export function LeadPanel({ ticket, onNavigate }: { ticket: ThreadTicket; onNavigate?: (ticketId: string) => void }) {
  const { isAdmin } = useApp();
  const queryClient = useQueryClient();
  const contact = ticket.contact;
  const [linkOpen, setLinkOpen] = useState(false);
  // Rascunho só enquanto edita; fora disso mostra o valor salvo (que pode mudar por outro atendente).
  const [draft, setDraft] = useState<string | null>(null);
  const notes = draft ?? contact?.notes ?? "";

  const { data, isLoading } = useQuery({
    queryKey: ["contact", contact?.id, "panel"],
    enabled: !!contact,
    queryFn: async (): Promise<PanelData> => {
      const supabase = createClient();
      const [groups, history] = await Promise.all([
        supabase.from("group_members").select("group_jid, is_admin, left_at, group:wa_groups(name)").eq("contact_id", contact!.id),
        supabase
          .from("tickets")
          .select("id, number, status, category, close_reason, opened_at, subject")
          .eq("contact_id", contact!.id)
          .neq("id", ticket.id)
          .order("opened_at", { ascending: false })
          .limit(5),
      ]);
      return { groups: (groups.data ?? []) as unknown as PanelData["groups"], history: (history.data ?? []) as PanelData["history"] };
    },
  });

  if (!contact) return null;
  const name = contactLabel(contact);
  const unlinked = contact.kind === "customer" && !contact.company_id;

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(contact.phone ?? "");
      toast.success("Telefone copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const saveNotes = async () => {
    if (draft === null || draft === (contact.notes ?? "")) return setDraft(null);
    const res = await updateContactNotes({ contactId: contact.id, notes: draft });
    if (!res.ok) return void toast.error(res.error);
    await queryClient.invalidateQueries({ queryKey: ticketKey(ticket.id) });
    setDraft(null);
  };

  return (
    <aside className="scroll-thin flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar name={name} src={contact.avatar_url} size="lg" />
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{name}</span>
          {contact.phone ? (
            <button type="button" onClick={copyPhone} className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {formatPhone(contact.phone)} <Copy className="size-3" />
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Telefone oculto pelo WhatsApp</span>
          )}
          {contact.email && <span className="truncate text-xs text-muted-foreground" title={contact.email}>{contact.email}</span>}
        </div>
        <span className="flex flex-wrap justify-center gap-1.5">
          <Badge variant={contact.kind === "customer" ? "neutral" : "primary"}>{CONTACT_KIND_LABELS[contact.kind]}</Badge>
          {contact.left_community_at && (
            <Badge variant="outline" title={`Saiu da última comunidade ${formatRelative(contact.left_community_at)}`}>
              Ex-membro
            </Badge>
          )}
        </span>
      </div>

      <GleapSection contactId={contact.id} />

      <CrmSection ticket={ticket} />

      <ParticipantsSection ticket={ticket} onNavigate={onNavigate} />

      <Section title="Empresa">
        {contact.company ? (
          <div className="flex items-start gap-2.5 rounded-md border border-border p-2.5">
            <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{contact.company.name}</span>
              {contact.company.external_id && <span className="text-xs text-muted-foreground">CRM {contact.company.external_id}</span>}
            </div>
          </div>
        ) : unlinked ? (
          <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-xs text-warning">
            <AlertTriangle className="size-4 shrink-0" />
            Sem empresa vinculada. O atendimento não conta para a conta do cliente.
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">{CONTACT_KIND_LABELS[contact.kind]} sem empresa vinculada (opcional).</span>
        )}
        <CompanyChoices
          contactId={contact.id}
          onlyWhenMultiple
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ticketKey(ticket.id) });
            queryClient.invalidateQueries({ queryKey: ["tickets"] });
          }}
        />
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 /> {unlinked ? "Vincular empresa" : "Alterar vínculo"}
          </Button>
        )}
      </Section>

      <Section title="Grupos">
        {isLoading ? (
          <Skeleton className="h-10" />
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {(data?.groups ?? []).map((g) => (
              <li key={g.group_jid} className={cn("flex items-center justify-between gap-2", g.left_at && "text-muted-foreground line-through")}>
                <span className="truncate">{g.group?.name ?? g.group_jid}</span>
                {g.is_admin && <Badge variant="outline">admin</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Histórico">
        <p className="text-xs text-muted-foreground">
          {pluralize(contact.message_count, "mensagem", "mensagens")} · na comunidade {formatRelative(contact.first_seen_at)}
        </p>
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : data?.history.length ? (
          <ul className="flex flex-col gap-2">
            {data.history.map((t) => (
              <li key={t.id} className="flex flex-col gap-0.5 rounded-md border border-border p-2 text-xs">
                <span className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>#{t.number} · {formatRelative(t.opened_at)}</span>
                  <span>{t.status === "open" ? "Aberto" : (categoryLabel(t.category) ?? CLOSE_REASONS[t.close_reason ?? "resolved"])}</span>
                </span>
                <span className="line-clamp-2">{t.subject}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Primeiro atendimento deste lead.</p>
        )}
      </Section>

      <Section title="Notas sobre o lead">
        <Textarea
          value={notes}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveNotes}
          rows={3}
          placeholder="Visível para toda a equipe. Salva ao sair do campo."
          className="text-[13px]"
        />
      </Section>

      <LinkContactDialog
        target={linkOpen ? { ...contact, company: contact.company } : null}
        onClose={() => setLinkOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ticketKey(ticket.id) });
          queryClient.invalidateQueries({ queryKey: ["tickets"] });
        }}
      />
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
