"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Copy } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { cn, formatPhone, formatRelative, formatTaxId, pluralize } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MemberDialog, type Member } from "@/components/companies/member-dialog";
import type { CompanyRow } from "@/components/companies/companies-view";

/** Ficha do CRM (mesmos campos do dossiê do TigerPanel), quando disponível. */
type CrmProfile = {
  email?: string | null;
  phone?: string | null;
  createdAt?: string | null;
  blocked?: boolean;
  address?: { street?: string | null; number?: string | null; block?: string | null; city?: string | null; state?: string | null; zip?: string | null };
  plan?: {
    name?: string | null;
    period?: string | null;
    value?: number | null;
    currency?: string;
    inTrial?: boolean;
    nextBillingDate?: string | null;
    hasPaymentIssues?: boolean;
  };
};

type CompanyDetail = {
  notes: string | null;
  email: string | null;
  crm_profile: CrmProfile | null;
  crm_synced_at: string | null;
};

type MemberGroup = { key: "in" | "out" | "nophone"; title: string; hint: string; members: Member[] };

const MEMBERS_LIMIT = 500;
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDate = (iso?: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? dateFmt.format(new Date(iso)) : null);

export function CompanyDialog({ company, onClose }: { company: CompanyRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!company} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-6xl overflow-y-auto">
        {company && <CompanyDetails key={company.tenant_id ?? company.company_id} company={company} />}
      </DialogContent>
    </Dialog>
  );
}

function CompanyDetails({ company }: { company: CompanyRow }) {
  const [member, setMember] = useState<Member | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["company", company.tenant_id, company.company_id],
    queryFn: async () => {
      const supabase = createClient();
      const [detail, gleap, linked] = await Promise.all([
        company.company_id
          ? supabase.from("companies").select("notes, email, crm_profile, crm_synced_at").eq("id", company.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        company.tenant_id
          ? supabase
              .from("gleap_leads")
              .select("user_id, name, email, phone, phone_key, last_activity_at, gleap_created_at")
              .eq("company_tenant_id", company.tenant_id)
              .order("last_activity_at", { ascending: false, nullsFirst: false })
              .limit(MEMBERS_LIMIT)
          : Promise.resolve({ data: [] }),
        company.company_id
          ? supabase.from("contacts").select("id, name, phone, phone_key, email, avatar_url").eq("company_id", company.company_id).limit(MEMBERS_LIMIT)
          : Promise.resolve({ data: [] }),
      ]);

      type GleapRow = { user_id: string; name: string | null; email: string | null; phone: string | null; phone_key: string | null; last_activity_at: string | null; gleap_created_at: string | null };
      type ContactRow = { id: string; name: string | null; phone: string | null; phone_key: string | null; email: string | null; avatar_url: string | null };
      const gleapRows = (gleap.data ?? []) as GleapRow[];
      const linkedRows = (linked.data ?? []) as ContactRow[];

      // Contatos dos grupos com os mesmos telefones (foto, vínculo) e quem está ativo em algum grupo.
      const keys = [...new Set(gleapRows.map((g) => g.phone_key).filter((k): k is string => !!k))];
      const [contactsByKey, communityKeys] = await Promise.all([
        keys.length
          ? supabase.from("contacts").select("id, name, phone, phone_key, email, avatar_url").in("phone_key", keys)
          : Promise.resolve({ data: [] }),
        keys.length ? supabase.from("community_phone_keys").select("phone_key").in("phone_key", keys) : Promise.resolve({ data: [] }),
      ]);
      const contactByKey = new Map(((contactsByKey.data ?? []) as ContactRow[]).map((c) => [c.phone_key!, c]));
      for (const c of linkedRows) if (c.phone_key && !contactByKey.has(c.phone_key)) contactByKey.set(c.phone_key, c);
      const inCommunity = new Set(((communityKeys.data ?? []) as { phone_key: string }[]).map((r) => r.phone_key));

      const members: Member[] = gleapRows.map((g) => {
        const contact = g.phone_key ? contactByKey.get(g.phone_key) : undefined;
        return {
          key: g.user_id,
          gleapUserId: g.user_id,
          contactId: contact?.id ?? null,
          name: g.name ?? contact?.name ?? null,
          email: g.email ?? contact?.email ?? null,
          phone: g.phone?.replace(/\D/g, "") || contact?.phone || null,
          avatarUrl: contact?.avatar_url ?? null,
          inCommunity: !!g.phone_key && inCommunity.has(g.phone_key),
          hasPhone: !!g.phone_key,
          lastActivityAt: g.last_activity_at,
          gleapCreatedAt: g.gleap_created_at,
          companyName: company.name,
        };
      });
      // Leads vinculados à empresa que não aparecem no Gleap.
      const seen = new Set(gleapRows.map((g) => g.phone_key).filter(Boolean));
      for (const c of linkedRows) {
        if (c.phone_key && seen.has(c.phone_key)) continue;
        members.push({
          key: `c:${c.id}`,
          gleapUserId: null,
          contactId: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          avatarUrl: c.avatar_url,
          inCommunity: true,
          hasPhone: !!c.phone_key,
          lastActivityAt: null,
          gleapCreatedAt: null,
          companyName: company.name,
        });
      }

      return { detail: (detail.data ?? null) as CompanyDetail | null, members, truncated: gleapRows.length >= MEMBERS_LIMIT };
    },
  });

  const groups: MemberGroup[] = [
    { key: "in", title: "Na comunidade", hint: "Estão em pelo menos um grupo", members: (data?.members ?? []).filter((m) => m.inCommunity) },
    { key: "out", title: "Fora da comunidade", hint: "Têm telefone, mas não estão em nenhum grupo", members: (data?.members ?? []).filter((m) => !m.inCommunity && m.hasPhone) },
    { key: "nophone", title: "Sem telefone", hint: "Não dá para saber se estão nos grupos", members: (data?.members ?? []).filter((m) => !m.inCommunity && !m.hasPhone) },
  ];

  const profile = data?.detail?.crm_profile ?? null;
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
      <DialogHeader className="flex-row items-start gap-4 space-y-0 text-left">
        <Avatar name={company.name} src={company.image_url} size="lg" className="size-14 rounded-lg text-base" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <DialogTitle className="truncate text-lg">{company.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {company.niche && <span>{company.niche}</span>}
            {profile?.createdAt && <span>cliente desde {fmtDate(profile.createdAt)}</span>}
            {profile && (
              <span className="flex items-center gap-1.5">
                <span className={cn("size-1.5 rounded-full", profile.blocked ? "bg-destructive" : "bg-success")} aria-hidden />
                {profile.blocked ? "Bloqueada" : "Ativa"}
              </span>
            )}
          </DialogDescription>
          {company.tenant_id && (
            <button
              type="button"
              onClick={() => copy(company.tenant_id!, "Tenant id")}
              className="flex w-fit items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              {company.tenant_id} <Copy className="size-3" />
            </button>
          )}
        </div>
      </DialogHeader>

      <div className="grid gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-2">
        <Section title="Cadastro">
          <Field label="CNPJ" value={company.cnpj ? formatTaxId(company.cnpj) : null} mono />
          <Field label="E-mail" value={profile?.email ?? data?.detail?.email ?? company.email} />
          <Field label="Telefone" value={profile?.phone ? formatPhone(profile.phone.replace(/\D/g, "")) : null} />
          <Field label="Último acesso ao CRM" value={company.last_activity_at ? formatRelative(company.last_activity_at) : null} />
        </Section>
        <Section title="Comunidade">
          <Field label="Usuários com acesso" value={company.users_count.toLocaleString("pt-BR")} />
          <Field label="Nos grupos" value={company.users_with_phone ? `${company.users_in_community} de ${company.users_with_phone} com telefone` : "—"} />
          <Field label="Leads vinculados" value={String(company.leads_count)} />
        </Section>
        {profile?.address && (
          <Section title="Endereço">
            <Field label="Logradouro" value={[profile.address.street, profile.address.number].filter(Boolean).join(", ") || null} />
            <Field label="Bairro" value={profile.address.block ?? null} />
            <Field label="Cidade" value={[profile.address.city, profile.address.state].filter(Boolean).join(" · ") || null} />
            <Field label="CEP" value={profile.address.zip ?? null} />
          </Section>
        )}
        {profile?.plan && (
          <Section title="Plano">
            <Field label="Plano" value={[profile.plan.name, profile.plan.period].filter(Boolean).join(" · ") || null} />
            <Field
              label="Valor"
              value={
                profile.plan.value != null
                  ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: profile.plan.currency ?? "BRL" }).format(profile.plan.value)
                  : null
              }
            />
            <Field label="Próxima cobrança" value={fmtDate(profile.plan.nextBillingDate)} />
            <Field label="Pagamentos" value={profile.plan.hasPaymentIssues ? "Com pendência" : "Em dia"} alert={profile.plan.hasPaymentIssues} />
          </Section>
        )}
      </div>
      {!profile && !isLoading && (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Logo, nicho, endereço e plano vêm da ficha da empresa no CRM, que a chave atual (Pós Vendas) não acessa para outros tenants.
        </p>
      )}
      {data?.detail?.notes && (
        <Section title="Notas">
          <p className="whitespace-pre-wrap text-sm">{data.detail.notes}</p>
        </Section>
      )}

      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Quem tem acesso</h3>
          {data && (
            <span className="text-xs text-muted-foreground">
              {pluralize(data.members.length, "pessoa", "pessoas")}
              {data.truncated && ` (mostrando as ${MEMBERS_LIMIT} mais recentes)`}
            </span>
          )}
        </div>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : !data?.members.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="size-4" /> Ninguém desta empresa na base do Gleap ainda.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {groups.map((g) => (
              <div
                key={g.key}
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-lg border p-3",
                  g.key === "in" ? "border-primary/30 bg-primary-soft/40" : "border-border bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{g.title}</span>
                  <Badge variant={g.key === "in" ? "primary" : "outline"}>{g.members.length}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">{g.hint}</p>
                <ul className="scroll-thin flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {g.members.map((m) => (
                    <li key={m.key}>
                      <button
                        type="button"
                        onClick={() => setMember(m)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/60"
                      >
                        <Avatar name={m.name ?? m.email} src={m.avatarUrl} size="xs" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[13px]">{m.name ?? m.email ?? "Sem nome"}</span>
                          <span className="truncate text-[11px] text-muted-foreground">
                            {m.phone ? formatPhone(m.phone) : (m.email ?? "")}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {g.members.length === 0 && <li className="px-1.5 text-xs text-muted-foreground">Ninguém.</li>}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <MemberDialog member={member} onClose={() => setMember(null)} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Field({ label, value, mono, alert }: { label: string; value: string | null | undefined; mono?: boolean; alert?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", !value && "text-muted-foreground", mono && "font-mono tabular", alert && "text-destructive")}>
        {value || "—"}
      </dd>
    </>
  );
}
