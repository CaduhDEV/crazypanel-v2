"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn, formatPhone, formatRelative, formatTaxId, pluralize } from "@/lib/utils";
import { CONTACT_KIND_LABELS, type Contact } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { gleapStatusLabel, gleapBoardLabel, type ContactGleapTicket } from "@/components/app/use-gleap-tickets";

/** Pessoa com acesso a uma empresa: usuário do Gleap e/ou lead dos grupos. */
export interface Member {
  key: string;
  gleapUserId: string | null;
  contactId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  inCommunity: boolean;
  hasPhone: boolean;
  lastActivityAt: string | null;
  gleapCreatedAt: string | null;
  companyName: string;
}

type Detail = {
  contact: Contact | null;
  groups: { group_jid: string; is_admin: boolean; left_at: string | null; group: { name: string | null } | null }[];
  tickets: { id: string; number: number; status: string; subject: string | null; opened_at: string }[];
  ticketsTotal: number;
  gleap: ContactGleapTicket[];
  /** Usuário do Gleap com o mesmo telefone (quando o modal abre a partir de Leads). */
  gleapUser: { user_id: string; last_activity_at: string | null; gleap_created_at: string | null; company_name: string | null } | null;
};

export function MemberDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">{member && <MemberDetails key={member.key} member={member} />}</DialogContent>
    </Dialog>
  );
}

function MemberDetails({ member }: { member: Member }) {
  const { data, isLoading } = useQuery({
    queryKey: ["member", member.contactId],
    enabled: !!member.contactId,
    queryFn: async (): Promise<Detail> => {
      const supabase = createClient();
      const id = member.contactId!;
      const [contact, groups, tickets, gleap] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", id).maybeSingle(),
        supabase.from("group_members").select("group_jid, is_admin, left_at, group:wa_groups(name)").eq("contact_id", id),
        supabase
          .from("tickets")
          .select("id, number, status, subject, opened_at", { count: "exact" })
          .eq("contact_id", id)
          .order("opened_at", { ascending: false })
          .limit(5),
        supabase.from("contact_gleap_tickets").select("*").eq("contact_id", id),
      ]);
      const phoneKey = (contact.data as { phone_key?: string | null } | null)?.phone_key ?? null;
      const gleapUser =
        !member.gleapUserId && phoneKey
          ? (
              await supabase
                .from("gleap_leads")
                .select("user_id, last_activity_at, gleap_created_at, company_name")
                .eq("phone_key", phoneKey)
                .order("last_activity_at", { ascending: false, nullsFirst: false })
                .limit(1)
                .maybeSingle()
            ).data
          : null;
      return {
        gleapUser: (gleapUser ?? null) as Detail["gleapUser"],
        contact: (contact.data ?? null) as Contact | null,
        groups: (groups.data ?? []) as unknown as Detail["groups"],
        tickets: (tickets.data ?? []) as Detail["tickets"],
        ticketsTotal: tickets.count ?? 0,
        gleap: (gleap.data ?? []) as ContactGleapTicket[],
      };
    },
  });

  const c = data?.contact ?? null;
  const name = member.name ?? c?.name ?? member.email ?? "Sem nome";
  const activeGroups = (data?.groups ?? []).filter((g) => !g.left_at);
  const lastActivityAt = member.lastActivityAt ?? data?.gleapUser?.last_activity_at ?? null;
  const gleapCreatedAt = member.gleapCreatedAt ?? data?.gleapUser?.gleap_created_at ?? null;
  const gleapUserId = member.gleapUserId ?? data?.gleapUser?.user_id ?? null;
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 space-y-0 text-left">
        <Avatar name={name} src={member.avatarUrl ?? c?.avatar_url} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <DialogTitle className="truncate">{name}</DialogTitle>
          <DialogDescription className="truncate">{member.companyName}</DialogDescription>
          <span className="flex flex-wrap gap-1.5">
            <Badge variant={member.inCommunity ? "primary" : "outline"}>{member.inCommunity ? "Na comunidade" : "Fora da comunidade"}</Badge>
            {c && <Badge variant="neutral">{CONTACT_KIND_LABELS[c.kind]}</Badge>}
            {c?.left_community_at && <Badge variant="outline">Ex-membro</Badge>}
          </span>
        </div>
      </DialogHeader>

      <Section title="Contato">
        <Row label="E-mail" value={member.email ?? c?.email} onCopy={(v) => copy(v, "E-mail")} />
        <Row label="Telefone" value={member.phone ? formatPhone(member.phone) : null} copyValue={member.phone} onCopy={(v) => copy(v, "Telefone")} />
      </Section>

      <Section title="CRM e Gleap">
        <Row label="Último acesso ao CRM" value={lastActivityAt ? formatRelative(lastActivityAt) : null} />
        <Row label="Cadastro no Gleap" value={gleapCreatedAt ? formatRelative(gleapCreatedAt) : null} />
        {c?.crm_tax_id && <Row label={c.crm_tax_id.length === 11 ? "CPF" : "CNPJ"} value={formatTaxId(c.crm_tax_id)} />}
        {c?.crm_attendant_name && <Row label="Responsável no CRM" value={c.crm_attendant_name} />}
        {gleapUserId && <Row label="ID no Gleap" value={gleapUserId} mono onCopy={(v) => copy(v, "ID")} />}
      </Section>

      {!member.contactId ? (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {member.inCommunity
            ? "Está num grupo, mas ainda não foi identificado como lead."
            : "Ainda não está em nenhum grupo da comunidade. Aparece em Para convidar."}
        </p>
      ) : isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <>
          {!!data?.gleap.length && (
            <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-xs text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              <span>
                Chamado ativo no Gleap:{" "}
                {data.gleap
                  .map((t) => `${gleapBoardLabel(t)} ${gleapStatusLabel(t.status).toLowerCase()}${t.assignee_name ? ` com ${t.assignee_name}` : ""}`)
                  .join("; ")}
              </span>
            </div>
          )}

          <Section title={`Grupos · ${activeGroups.length}`}>
            {data?.groups.length ? (
              <ul className="col-span-2 flex flex-col gap-1 text-sm">
                {data.groups.map((g) => (
                  <li key={g.group_jid} className={cn("flex items-center justify-between gap-2", g.left_at && "text-muted-foreground line-through")}>
                    <span className="truncate">{g.group?.name ?? g.group_jid}</span>
                    {g.is_admin && <Badge variant="outline">admin</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="col-span-2 text-sm text-muted-foreground">Nenhum grupo conhecido.</p>
            )}
          </Section>

          <Section title={`Atendimentos · ${data?.ticketsTotal ?? 0}`}>
            {data?.tickets.length ? (
              <ul className="col-span-2 flex flex-col gap-1.5">
                {data.tickets.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/atendimento?ticket=${t.id}`}
                      className="flex flex-col gap-0.5 rounded-md border border-border p-2 text-xs hover:bg-accent/40"
                    >
                      <span className="flex justify-between gap-2 text-muted-foreground">
                        <span>
                          #{t.number} · {formatRelative(t.opened_at)}
                        </span>
                        <span>{t.status === "open" ? "Aberto" : "Finalizado"}</span>
                      </span>
                      <span className="line-clamp-2">{t.subject}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="col-span-2 text-sm text-muted-foreground">Nenhum atendimento ainda.</p>
            )}
            {c && (
              <p className="col-span-2 text-xs text-muted-foreground">
                {pluralize(c.message_count, "mensagem", "mensagens")} nos grupos · na comunidade {formatRelative(c.first_seen_at)}
              </p>
            )}
          </Section>

          {c?.notes && (
            <Section title="Notas">
              <p className="col-span-2 whitespace-pre-wrap text-sm">{c.notes}</p>
            </Section>
          )}

          <Button variant="outline" size="sm" asChild className="w-fit">
            <Link href={`/leads?q=${encodeURIComponent(c?.phone ?? name)}`}>
              <ExternalLink /> Ver em Leads
            </Link>
          </Button>
        </>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  copyValue,
  mono,
  onCopy,
}: {
  label: string;
  value: string | null | undefined;
  copyValue?: string | null;
  mono?: boolean;
  onCopy?: (value: string) => void;
}) {
  const raw = copyValue ?? value;
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("flex min-w-0 items-center gap-1.5 break-all", !value && "text-muted-foreground", mono && "font-mono text-xs")}>
        {value || "—"}
        {value && raw && onCopy && (
          <button type="button" onClick={() => onCopy(raw)} className="text-muted-foreground hover:text-foreground" aria-label={`Copiar ${label}`}>
            <Copy className="size-3" />
          </button>
        )}
      </dd>
    </>
  );
}
