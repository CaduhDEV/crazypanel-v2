"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Loader2, MessageSquareText, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { callApi } from "@/lib/api-client";
import { deleteContact, getContactDeletionImpact } from "@/lib/leads/actions";
import { cn, contactLabel, formatDuration, formatPhone, formatRelative, formatTaxId, pluralize } from "@/lib/utils";
import { CLOSE_REASONS, CONTACT_KIND_LABELS, type Company, type Contact } from "@/lib/types";
import { classificationLabel } from "@/lib/taxonomy";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton, Tip } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/components/app/app-context";
import { useNow } from "@/components/app/use-now";
import { CompanyChoices } from "@/components/leads/company-choices";
import { gleapStatusLabel, gleapBoardLabel, type ContactGleapTicket } from "@/components/app/use-gleap-tickets";

type ProfileContact = Contact & {
  phone_key: string | null;
  linked_at: string | null;
  linked_by: string | null;
  company: (Pick<Company, "id" | "name" | "external_id" | "email"> & { cnpj: string | null }) | null;
};

type TicketItem = {
  id: string;
  number: number;
  status: "open" | "closed";
  subject: string | null;
  assignee_id: string | null;
  category: string | null;
  topic?: string | null;
  close_reason: string | null;
  opened_at: string;
  closed_at: string | null;
  first_response_at: string | null;
  message_count: number;
  group: { name: string | null } | null;
  role: "owner" | "participant";
};

type Profile = {
  contact: ProfileContact | null;
  groups: { group_jid: string; is_admin: boolean; joined_at: string; left_at: string | null; group: { name: string | null; listening: boolean } | null }[];
  tickets: TicketItem[];
  messages: { id: string; body: string | null; kind: string; sent_at: string; group: { name: string | null } | null }[];
  gleapUsers: { user_id: string; name: string | null; email: string | null; company_name: string | null; company_tenant_id: string | null; last_activity_at: string | null; gleap_created_at: string | null }[];
  gleapTickets: ContactGleapTicket[];
};

const profileKey = (id: string) => ["lead-profile", id] as const;
const TICKET_SELECT =
  "id, number, status, subject, assignee_id, category, topic, close_reason, opened_at, closed_at, first_response_at, message_count, group:wa_groups(name)";

export function LeadProfileDialog({ contactId, onClose, onDeleted }: { contactId: string | null; onClose: () => void; onDeleted?: () => void }) {
  return (
    <Dialog open={!!contactId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto">
        {contactId && <LeadProfile key={contactId} contactId={contactId} onDeleted={() => (onClose(), onDeleted?.())} />}
      </DialogContent>
    </Dialog>
  );
}

function LeadProfile({ contactId, onDeleted }: { contactId: string; onDeleted: () => void }) {
  const { memberById, isAdmin, taxonomy } = useApp();
  const queryClient = useQueryClient();
  const [refreshing, startRefresh] = useTransition();
  const now = useNow();

  const { data, isLoading } = useQuery({
    queryKey: profileKey(contactId),
    queryFn: async (): Promise<Profile> => {
      const supabase = createClient();
      const [contact, groups, owned, participations, messages, gleapTickets] = await Promise.all([
        supabase.from("contacts").select("*, company:companies(id, name, external_id, email, cnpj)").eq("id", contactId).maybeSingle(),
        supabase.from("group_members").select("group_jid, is_admin, joined_at, left_at, group:wa_groups(name, listening)").eq("contact_id", contactId),
        supabase.from("tickets").select(TICKET_SELECT).eq("contact_id", contactId).order("opened_at", { ascending: false }).limit(30),
        supabase.from("ticket_participants").select("ticket_id").eq("contact_id", contactId).is("removed_at", null),
        supabase
          .from("messages")
          .select("id, body, kind, sent_at, group:wa_groups(name)")
          .eq("contact_id", contactId)
          .eq("is_note", false)
          .is("deleted_at", null)
          .order("sent_at", { ascending: false })
          .limit(6),
        supabase.from("contact_gleap_tickets").select("*").eq("contact_id", contactId),
      ]);

      const c = (contact.data ?? null) as ProfileContact | null;
      const ownedRows = ((owned.data ?? []) as unknown as Omit<TicketItem, "role">[]).map((t) => ({ ...t, role: "owner" as const }));
      const ownedIds = new Set(ownedRows.map((t) => t.id));
      const otherIds = ((participations.data ?? []) as { ticket_id: string }[]).map((p) => p.ticket_id).filter((id) => !ownedIds.has(id));

      const [joined, gleapUsers] = await Promise.all([
        otherIds.length
          ? supabase.from("tickets").select(TICKET_SELECT).in("id", otherIds.slice(0, 30))
          : Promise.resolve({ data: [] }),
        c?.phone_key
          ? supabase
              .from("gleap_leads")
              .select("user_id, name, email, company_name, company_tenant_id, last_activity_at, gleap_created_at")
              .eq("phone_key", c.phone_key)
              .order("last_activity_at", { ascending: false, nullsFirst: false })
              .limit(10)
          : Promise.resolve({ data: [] }),
      ]);
      const joinedRows = ((joined.data ?? []) as unknown as Omit<TicketItem, "role">[]).map((t) => ({ ...t, role: "participant" as const }));

      return {
        contact: c,
        groups: (groups.data ?? []) as unknown as Profile["groups"],
        tickets: [...ownedRows, ...joinedRows].sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at)),
        messages: (messages.data ?? []) as unknown as Profile["messages"],
        gleapUsers: (gleapUsers.data ?? []) as Profile["gleapUsers"],
        gleapTickets: (gleapTickets.data ?? []) as ContactGleapTicket[],
      };
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <DialogTitle className="sr-only">Carregando perfil</DialogTitle>
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  const c = data?.contact;
  if (!c) {
    return <DialogTitle>Lead não encontrado</DialogTitle>;
  }

  const name = contactLabel(c);
  const activeGroups = data.groups.filter((g) => !g.left_at);
  const owned = data.tickets.filter((t) => t.role === "owner");
  const openCount = data.tickets.filter((t) => t.status === "open").length;
  const responseTimes = owned
    .filter((t) => t.first_response_at)
    .map((t) => (Date.parse(t.first_response_at!) - Date.parse(t.opened_at)) / 1000)
    .filter((s) => s >= 0);
  const avgResponse = responseTimes.length ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;
  const taxId = c.company?.cnpj ?? c.crm_tax_id;
  const linkedBy = c.linked_by ? memberById.get(c.linked_by)?.name : null;
  const crmRecent = c.crm_last_received_at && now - Date.parse(c.crm_last_received_at) < 24 * 3600 * 1000;

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };
  const refreshCrm = () =>
    startRefresh(async () => {
      const res = await callApi<boolean>(`/api/contacts/${c.id}/crm?force=1`, { method: "POST" });
      if (!res.ok) return void toast.error(res.error);
      await queryClient.invalidateQueries({ queryKey: profileKey(c.id) });
    });

  return (
    <>
      <DialogHeader className="flex-row items-start gap-4 space-y-0 text-left">
        <Avatar name={name} src={c.avatar_url} size="lg" className="size-16 text-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <DialogTitle className="truncate text-lg">{name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {c.phone ? (
              <button type="button" onClick={() => copy(c.phone!, "Telefone")} className="flex items-center gap-1 hover:text-foreground">
                {formatPhone(c.phone)} <Copy className="size-3" />
              </button>
            ) : (
              <span>Telefone oculto pelo WhatsApp</span>
            )}
            {c.email && (
              <button type="button" onClick={() => copy(c.email!, "E-mail")} className="flex items-center gap-1 hover:text-foreground">
                {c.email} <Copy className="size-3" />
              </button>
            )}
          </DialogDescription>
          <span className="flex flex-wrap gap-1.5">
            <Badge variant={c.kind === "customer" ? "neutral" : "primary"}>{CONTACT_KIND_LABELS[c.kind]}</Badge>
            <Badge variant={activeGroups.length ? "primary" : "outline"}>{activeGroups.length ? "Na comunidade" : "Fora da comunidade"}</Badge>
            {c.left_community_at && <Badge variant="outline">Ex-membro desde {formatRelative(c.left_community_at)}</Badge>}
            {c.kind === "customer" && !c.company_id && <Badge variant="warning">Sem empresa vinculada</Badge>}
            {c.strikes > 0 && <Badge variant="destructive">{pluralize(c.strikes, "advertência", "advertências")}</Badge>}
          </span>
        </div>
      </DialogHeader>

      {/* Números rápidos */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Mensagens nos grupos" value={c.message_count.toLocaleString("pt-BR")} />
        <Stat label="Atendimentos" value={`${owned.length}${openCount ? ` · ${openCount} aberto${openCount > 1 ? "s" : ""}` : ""}`} />
        <Stat label="1ª resposta média" value={avgResponse != null ? formatDuration(avgResponse) : "—"} />
        <Stat label="Última mensagem" value={c.last_message_at ? formatRelative(c.last_message_at) : "Nunca falou"} />
      </dl>

      {(data.gleapTickets.length > 0 || (crmRecent && c.crm_pending)) && (
        <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-xs text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            {data.gleapTickets.length > 0 &&
              `Chamado ativo no Gleap: ${data.gleapTickets
                .map((t) => `${gleapBoardLabel(t)} ${gleapStatusLabel(t.status).toLowerCase()}${t.assignee_name ? ` com ${t.assignee_name}` : ""}`)
                .join("; ")}. `}
            {crmRecent && c.crm_pending && `Aguardando resposta no WhatsApp do CRM desde ${formatRelative(c.crm_last_received_at!)}.`}
          </span>
        </div>
      )}

      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        <Section title="Empresa">
          {c.company ? (
            <>
              <Row label="Empresa" value={c.company.name} />
              <Row label="Tenant (CRM)" value={c.company.external_id} mono onCopy={(v) => copy(v, "Tenant id")} />
              <Row label="CNPJ" value={taxId && taxId.length === 14 ? formatTaxId(taxId) : null} mono />
              <Row label="Vinculado" value={c.linked_at ? `${formatRelative(c.linked_at)}${linkedBy ? ` por ${linkedBy}` : c.gleap_status === "linked" ? " pelo Gleap" : ""}` : null} />
            </>
          ) : (
            <p className="col-span-2 text-sm text-muted-foreground">
              {c.kind === "customer"
                ? c.gleap_status === "ambiguous"
                  ? "O telefone aparece em mais de uma empresa no Gleap: escolha a principal abaixo."
                  : "Sem empresa vinculada."
                : `${CONTACT_KIND_LABELS[c.kind]} sem empresa vinculada (opcional).`}
            </p>
          )}
          <div className="col-span-2 pt-1">
            <CompanyChoices contactId={c.id} onlyWhenMultiple onChanged={() => queryClient.invalidateQueries({ queryKey: profileKey(c.id) })} />
          </div>
        </Section>

        <Section
          title="CRM DataCrazy"
          action={
            c.phone && (
              <Tip label={c.crm_checked_at ? `Consultado ${formatRelative(c.crm_checked_at)}` : "Nunca consultado"}>
                <Button variant="ghost" size="icon-sm" onClick={refreshCrm} disabled={refreshing} aria-label="Consultar o CRM agora">
                  {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </Button>
              </Tip>
            )
          }
        >
          {!c.crm_checked_at ? (
            <p className="col-span-2 text-sm text-muted-foreground">Ainda não consultado no CRM.</p>
          ) : !c.crm_lead_id ? (
            <p className="col-span-2 text-sm text-muted-foreground">Telefone não encontrado no CRM.</p>
          ) : (
            <>
              <Row label={c.crm_tax_id?.length === 11 ? "CPF" : "Documento"} value={c.crm_tax_id ? formatTaxId(c.crm_tax_id) : null} mono />
              <Row label="Responsável" value={c.crm_attendant_name ?? "Ninguém"} />
              <Row label="WhatsApp: recebeu" value={c.crm_last_received_at ? formatRelative(c.crm_last_received_at) : null} />
              <Row label="WhatsApp: enviou" value={c.crm_last_sent_at ? formatRelative(c.crm_last_sent_at) : null} />
              <Row label="Pendente" value={c.crm_pending == null ? null : c.crm_pending ? "Sim, aguardando resposta" : "Não"} />
            </>
          )}
        </Section>

        <Section title={`Gleap · ${pluralize(data.gleapUsers.length, "usuário", "usuários")}`}>
          {data.gleapUsers.length ? (
            <ul className="col-span-2 flex flex-col gap-1.5">
              {data.gleapUsers.map((u) => (
                <li key={u.user_id} className="flex flex-col gap-0.5 rounded-md border border-border p-2 text-xs">
                  <span className="flex justify-between gap-2">
                    <span className="truncate font-medium">{u.company_name ?? "Sem empresa"}</span>
                    <span className="shrink-0 text-muted-foreground">{u.last_activity_at ? `acessou ${formatRelative(u.last_activity_at)}` : ""}</span>
                  </span>
                  <span className="truncate text-muted-foreground">
                    {[u.name, u.email].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="col-span-2 text-sm text-muted-foreground">{c.phone ? "Telefone não encontrado na base do Gleap." : "Sem telefone para buscar no Gleap."}</p>
          )}
        </Section>

        <Section title={`Grupos · ${activeGroups.length} ativo${activeGroups.length === 1 ? "" : "s"}`}>
          {data.groups.length ? (
            <ul className="col-span-2 flex flex-col gap-1 text-sm">
              {data.groups.map((g) => (
                <li key={g.group_jid} className="flex items-center justify-between gap-2">
                  <span className={cn("flex min-w-0 items-center gap-1.5", g.left_at && "text-muted-foreground")}>
                    <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className={cn("truncate", g.left_at && "line-through")}>{g.group?.name ?? g.group_jid}</span>
                    {g.group && !g.group.listening && <span className="shrink-0 text-[11px] text-muted-foreground">(não escutado)</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    {g.is_admin && <Badge variant="outline">admin</Badge>}
                    {g.left_at ? `saiu ${formatRelative(g.left_at)}` : `entrou ${formatRelative(g.joined_at)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="col-span-2 text-sm text-muted-foreground">Nenhum grupo conhecido.</p>
          )}
        </Section>
      </div>

      <Section title={`Atendimentos · ${data.tickets.length}`}>
        {data.tickets.length ? (
          <ul className="col-span-2 grid gap-1.5 sm:grid-cols-2">
            {data.tickets.map((t) => {
              const assignee = t.assignee_id ? memberById.get(t.assignee_id)?.name : null;
              const category = classificationLabel(taxonomy, t.category, t.topic);
              return (
                <li key={t.id}>
                  <Link href={`/atendimento?ticket=${t.id}`} className="flex flex-col gap-0.5 rounded-md border border-border p-2 text-xs hover:bg-accent/40">
                    <span className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span className="truncate">
                        #{t.number} · {t.group?.name ?? "Grupo"} · {formatRelative(t.opened_at)}
                      </span>
                      <span className="shrink-0">
                        {t.status === "open" ? "Aberto" : (category ?? CLOSE_REASONS[(t.close_reason as keyof typeof CLOSE_REASONS) ?? "resolved"])}
                      </span>
                    </span>
                    <span className="line-clamp-1 text-[13px]">{t.subject ?? "Sem assunto"}</span>
                    <span className="text-muted-foreground">
                      {t.role === "participant" ? "Participou · " : ""}
                      {assignee ? `com ${assignee}` : "sem responsável"} · {pluralize(t.message_count, "mensagem", "mensagens")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="col-span-2 text-sm text-muted-foreground">Nenhum atendimento ainda.</p>
        )}
      </Section>

      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        <Section title="Últimas mensagens">
          {data.messages.length ? (
            <ul className="col-span-2 flex flex-col gap-1.5">
              {data.messages.map((m) => (
                <li key={m.id} className="flex gap-2 text-xs">
                  <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 text-[13px]">{m.body || `(${m.kind})`}</span>
                    <span className="text-muted-foreground">
                      {m.group?.name ?? "Grupo"} · {formatRelative(m.sent_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="col-span-2 text-sm text-muted-foreground">Nenhuma mensagem registrada.</p>
          )}
        </Section>

        <Section title="Registro">
          <Row label="Visto pela 1ª vez" value={formatRelative(c.first_seen_at)} />
          <Row label="Identificador @lid" value={c.lid} mono />
          {c.notes && (
            <>
              <dt className="col-span-2 pt-1 text-muted-foreground">Notas</dt>
              <dd className="col-span-2 whitespace-pre-wrap text-sm">{c.notes}</dd>
            </>
          )}
        </Section>
      </div>

      {isAdmin && <DeleteLead contactId={c.id} name={name} onDeleted={onDeleted} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-semibold tabular">{value}</dd>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 border-t border-border pt-3">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
        {action}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Row({ label, value, mono, onCopy }: { label: string; value: string | null | undefined; mono?: boolean; onCopy?: (value: string) => void }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("flex min-w-0 items-center gap-1.5 break-all", !value && "text-muted-foreground", mono && "font-mono text-xs")}>
        {value || "—"}
        {value && onCopy && (
          <button type="button" onClick={() => onCopy(value)} className="text-muted-foreground hover:text-foreground" aria-label={`Copiar ${label}`}>
            <Copy className="size-3" />
          </button>
        )}
      </dd>
    </>
  );
}

/** Excluir lead: confirma mostrando o que vai junto (atendimentos e mensagens). */
function DeleteLead({ contactId, name, onDeleted }: { contactId: string; name: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { data: impact, isLoading } = useQuery({
    queryKey: ["lead-delete-impact", contactId],
    enabled: open,
    queryFn: async () => {
      const res = await getContactDeletionImpact({ contactId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });

  const remove = () =>
    start(async () => {
      const res = await deleteContact({ contactId });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${name} foi excluído.`);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onDeleted();
    });

  return (
    <div className="flex justify-end border-t border-border pt-4">
      <Button variant="destructive-ghost" size="sm" onClick={() => setOpen(true)}>
        <Trash2 /> Excluir lead
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir {name}?</DialogTitle>
            <DialogDescription>Essa ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          {isLoading || !impact ? (
            <Skeleton className="h-16" />
          ) : (
            <ul className="flex flex-col gap-1.5 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-sm text-destructive">
              <li>O lead e o perfil dele saem do painel.</li>
              {impact.tickets > 0 && (
                <li>
                  {pluralize(impact.tickets, "atendimento", "atendimentos")} em que ele é o principal, com{" "}
                  {pluralize(impact.messages, "mensagem", "mensagens")}, também serão apagados.
                </li>
              )}
              {impact.groups > 0 && <li>Ele continua nos grupos do WhatsApp; só sai da base do painel.</li>}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending || isLoading}>
              {pending && <Loader2 className="animate-spin" />} Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
