"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, ChevronLeft, ChevronRight, Copy, ExternalLink, Flag, Loader2, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { setFlagExempt } from "@/lib/moderation/actions";
import { cn, contactLabel, formatPhone, formatRelative, formatTaxId, formatTime, pluralize } from "@/lib/utils";
import { CONTACT_KIND_LABELS, type Company, type Contact } from "@/lib/types";
import { activeCategories, classificationLabel, topicsOf } from "@/lib/taxonomy";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApp } from "@/components/app/app-context";
import { CompanyChoices } from "@/components/leads/company-choices";
import { OpenTicketLink } from "@/components/conversation/open-ticket-link";
import { gleapBoardLabel, gleapStatusLabel, type ContactGleapTicket } from "@/components/app/use-gleap-tickets";

type LeadContact = Contact & {
  phone_key: string | null;
  company: (Pick<Company, "id" | "name" | "external_id" | "email"> & { cnpj: string | null }) | null;
};

interface LeadStats {
  mensagens: number;
  primeira: string | null;
  ultima: string | null;
  atendimentos: number;
  participou: number;
  abertos: number;
  duvidas: number;
  tecnicos: number;
  reclamacoes: number;
  elogios: number;
  resolveu_para_outros: number;
  por_tipo: Record<string, number>;
  por_grupo: { jid: string; nome: string | null; mensagens: number }[];
}

type MessageRow = {
  id: string;
  body: string | null;
  kind: string;
  sent_at: string;
  group_jid: string;
  ticket_id: string | null;
  category: string | null;
  topic: string | null;
  flagged_at?: string | null;
  group: { name: string | null } | null;
};

const PAGE_SIZE = 30;
const ALL = "__all__";
const KIND_LABELS: Record<string, string> = {
  text: "Texto",
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contact: "Contato",
  poll: "Enquete",
};

const date = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" });

export function LeadPage({ contactId }: { contactId: string }) {
  const { isAdmin } = useApp();
  const queryClient = useQueryClient();
  const profileKey = ["lead-page", contactId];

  const { data, isLoading } = useQuery({
    queryKey: profileKey,
    queryFn: async () => {
      const supabase = createClient();
      const [contact, stats, groups, tickets, gleapTickets] = await Promise.all([
        supabase.from("contacts").select("*, company:companies(id, name, external_id, email, cnpj)").eq("id", contactId).maybeSingle(),
        supabase.rpc("lead_profile_stats", { p_contact: contactId }),
        supabase.from("group_members").select("group_jid, is_admin, joined_at, left_at, group:wa_groups(name)").eq("contact_id", contactId),
        supabase
          .from("tickets")
          .select("id, number, status, subject, category, topic, opened_at, group:wa_groups(name)")
          .eq("contact_id", contactId)
          .order("opened_at", { ascending: false })
          .limit(20),
        supabase.from("contact_gleap_tickets").select("*").eq("contact_id", contactId),
      ]);
      const c = (contact.data ?? null) as LeadContact | null;
      const gleapUsers = c?.phone_key
        ? await supabase.from("gleap_leads").select("user_id, name, email, company_name, last_activity_at").eq("phone_key", c.phone_key).limit(10)
        : { data: [] };
      return {
        contact: c,
        stats: stats.data as LeadStats | null,
        groups: (groups.data ?? []) as unknown as { group_jid: string; is_admin: boolean; joined_at: string; left_at: string | null; group: { name: string | null } | null }[],
        tickets: (tickets.data ?? []) as unknown as { id: string; number: number; status: string; subject: string | null; category: string | null; topic: string | null; opened_at: string; group: { name: string | null } | null }[],
        gleapTickets: (gleapTickets.data ?? []) as ContactGleapTicket[],
        gleapUsers: (gleapUsers.data ?? []) as { user_id: string; name: string | null; email: string | null; company_name: string | null; last_activity_at: string | null }[],
      };
    },
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: profileKey });
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  if (isLoading) {
    return (
      <main className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6" aria-busy="true">
        <Skeleton className="h-24 opacity-50" />
        <Skeleton className="h-20 opacity-40" />
        <Skeleton className="h-96 opacity-30" />
      </main>
    );
  }
  const c = data?.contact;
  if (!c) return <main className="px-6 py-8 text-sm text-muted-foreground">Lead não encontrado.</main>;
  const name = contactLabel(c);
  const s = data.stats;
  const taxId = c.company?.cnpj ?? c.crm_tax_id;
  const activeGroups = data.groups.filter((g) => !g.left_at);

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      <Link href="/leads" className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Leads
      </Link>

      <section className="flex flex-wrap items-start gap-4 rounded-lg border border-border bg-card p-4">
        <Avatar name={name} src={c.avatar_url} size="lg" className="size-20 text-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="truncate text-lg font-semibold">{name}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {c.phone && <CopyText value={formatPhone(c.phone)} onCopy={() => copy(c.phone!, "Telefone")} />}
            {c.email && <CopyText value={c.email} onCopy={() => copy(c.email!, "E-mail")} />}
            {c.lid && <CopyText value={`${c.lid}@lid`} mono onCopy={() => copy(`${c.lid}@lid`, "@lid")} />}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={c.kind === "customer" ? "neutral" : "primary"}>{CONTACT_KIND_LABELS[c.kind]}</Badge>
            <Badge variant={activeGroups.length ? "primary" : "outline"}>{activeGroups.length ? "Na comunidade" : "Fora da comunidade"}</Badge>
            {c.strikes > 0 && (
              <Badge variant="destructive" className="gap-1">
                <Flag className="size-3" /> {pluralize(c.strikes, "flag", "flags")}
              </Badge>
            )}
            {c.flag_exempt && (
              <Badge variant="success" title={c.flag_exempt_note ?? undefined}>
                Divulgador autorizado
              </Badge>
            )}
            {data.gleapTickets.length > 0 && <Badge variant="warning">Chamado ativo no Gleap</Badge>}
          </div>
        </div>
        {isAdmin && <ExemptToggle contactId={c.id} exempt={!!c.flag_exempt} onDone={reload} />}
      </section>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        <Stat label="Mensagens" value={s?.mensagens ?? 0} />
        <Stat label="Atendimentos" value={s?.atendimentos ?? 0} foot={s?.abertos ? `${s.abertos} aberto(s)` : undefined} />
        <Stat label="Dúvidas" value={s?.duvidas ?? 0} />
        <Stat label="Problemas técnicos" value={s?.tecnicos ?? 0} />
        <Stat label="Reclamações" value={s?.reclamacoes ?? 0} tone={s?.reclamacoes ? "bad" : undefined} />
        <Stat label="Elogios" value={s?.elogios ?? 0} tone={s?.elogios ? "good" : undefined} />
        <Stat label="Ajudou outras pessoas" value={s?.resolveu_para_outros ?? 0} foot={`participou de ${s?.participou ?? 0}`} />
      </dl>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Messages contactId={c.id} groups={s?.por_grupo ?? []} kinds={Object.keys(s?.por_tipo ?? {})} />

        <aside className="flex min-w-0 flex-col gap-3">
          <Card title="Empresas vinculadas">
            {c.company ? (
              <div className="flex flex-col gap-0.5 text-[13px]">
                <span className="font-medium">{c.company.name}</span>
                {c.company.external_id && <span className="font-mono text-xs text-muted-foreground">Tenant {c.company.external_id}</span>}
                {taxId && taxId.length === 14 && <span className="font-mono text-xs text-muted-foreground">CNPJ {formatTaxId(taxId)}</span>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Sem empresa vinculada.</p>
            )}
            <CompanyChoices contactId={c.id} onlyWhenMultiple onChanged={reload} />
          </Card>

          <Card title={`Grupos · ${activeGroups.length} ativo${activeGroups.length === 1 ? "" : "s"}`}>
            <ul className="flex flex-col gap-1 text-[13px]">
              {data.groups.map((g) => (
                <li key={g.group_jid} className="flex items-center justify-between gap-2">
                  <span className={cn("flex min-w-0 items-center gap-1.5", g.left_at && "text-muted-foreground line-through")}>
                    <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{g.group?.name ?? g.group_jid}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{s?.por_grupo.find((x) => x.jid === g.group_jid)?.mensagens ?? 0} msgs</span>
                </li>
              ))}
              {!data.groups.length && <li className="text-xs text-muted-foreground">Nenhum grupo conhecido.</li>}
            </ul>
          </Card>

          <Card title={`Gleap · ${pluralize(data.gleapTickets.length, "chamado ativo", "chamados ativos")}`}>
            <ul className="flex flex-col gap-1 text-xs">
              {data.gleapTickets.map((t, i) => (
                <li key={i} className="rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-warning">
                  {gleapBoardLabel(t)} · {gleapStatusLabel(t.status)}
                  {t.assignee_name ? ` · ${t.assignee_name}` : ""}
                </li>
              ))}
              {data.gleapUsers.map((u) => (
                <li key={u.user_id} className="flex flex-col rounded-md border border-border px-2 py-1">
                  <span className="truncate font-medium">{u.company_name ?? "Sem empresa"}</span>
                  <span className="truncate text-muted-foreground">{[u.name, u.email].filter(Boolean).join(" · ")}</span>
                  {u.last_activity_at && <span className="text-muted-foreground">Acessou {formatRelative(u.last_activity_at)}</span>}
                </li>
              ))}
              {!data.gleapUsers.length && !data.gleapTickets.length && <li className="text-muted-foreground">Não encontrado no Gleap.</li>}
            </ul>
          </Card>

          <Card title="Atendimentos recentes">
            <ul className="flex flex-col gap-1 text-xs">
              {data.tickets.map((t) => (
                <li key={t.id}>
                  <TicketLine ticket={t} />
                </li>
              ))}
              {!data.tickets.length && <li className="text-muted-foreground">Nenhum atendimento ainda.</li>}
            </ul>
          </Card>

          <Card title="Registro">
            <p className="text-xs text-muted-foreground">Visto pela 1ª vez {formatRelative(c.first_seen_at)}</p>
            {s?.ultima && <p className="text-xs text-muted-foreground">Última mensagem {formatRelative(s.ultima)}</p>}
            {c.notes && <p className="whitespace-pre-wrap text-[13px]">{c.notes}</p>}
          </Card>
        </aside>
      </div>
    </main>
  );
}

function TicketLine({ ticket: t }: { ticket: { id: string; number: number; status: string; subject: string | null; category: string | null; topic: string | null; opened_at: string } }) {
  const { taxonomy } = useApp();
  return (
    <OpenTicketLink ticketId={t.id} className="flex flex-col rounded-md border border-border px-2 py-1 hover:bg-accent/40">
      <span className="flex justify-between gap-2 text-muted-foreground">
        <span>#{t.number} · {date(t.opened_at)}</span>
        <span className="truncate">{t.status === "open" ? "Aberto" : (classificationLabel(taxonomy, t.category, t.topic) ?? "Finalizado")}</span>
      </span>
      <span className="line-clamp-1 text-[13px]">{t.subject ?? "Sem assunto"}</span>
    </OpenTicketLink>
  );
}

/** Todas as mensagens do lead, com filtros por texto, categoria, tipo, grupo e período. */
function Messages({ contactId, groups, kinds }: { contactId: string; groups: { jid: string; nome: string | null }[]; kinds: string[] }) {
  const { taxonomy } = useApp();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [classification, setClassification] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [group, setGroup] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);
  const filter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(0);
  };

  const { data, isFetching } = useQuery({
    queryKey: ["lead-page", contactId, "messages", q, classification, kind, group, from, to, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = createClient()
        .from("messages")
        .select("id, body, kind, sent_at, group_jid, ticket_id, category, topic, flagged_at, group:wa_groups(name)", { count: "exact" })
        .eq("contact_id", contactId)
        .eq("is_note", false)
        .is("deleted_at", null);
      if (q) query = query.ilike("body", `%${q.replace(/[%_]/g, "\\$&")}%`);
      if (kind !== ALL) query = query.eq("kind", kind);
      if (group !== ALL) query = query.eq("group_jid", group);
      if (from) query = query.gte("sent_at", new Date(`${from}T00:00:00-03:00`).toISOString());
      if (to) query = query.lt("sent_at", new Date(new Date(`${to}T00:00:00-03:00`).getTime() + 86_400_000).toISOString());
      if (classification !== ALL) {
        const [cat, topic] = classification.split("/");
        query = query.eq("category", cat);
        if (topic) query = query.eq("topic", topic);
      }
      const { data: rows, count, error } = await query.order("sent_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: (rows ?? []) as unknown as MessageRow[], total: count ?? 0 };
    },
  });
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Mensagens · {total.toLocaleString("pt-BR")}</h2>
        {isFetching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar no texto" className="h-9 pl-8" aria-label="Buscar no texto" />
        </div>
        <Select value={classification} onValueChange={filter(setClassification)}>
          <SelectTrigger className="h-9 w-48" aria-label="Categoria">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {activeCategories(taxonomy).flatMap((cat) => [
              <SelectItem key={cat.key} value={cat.key}>
                {cat.label}
              </SelectItem>,
              ...topicsOf(taxonomy, cat.key).map((t) => (
                <SelectItem key={`${cat.key}/${t.key}`} value={`${cat.key}/${t.key}`}>
                  {cat.label} · {t.label}
                </SelectItem>
              )),
            ])}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={filter(setKind)}>
          <SelectTrigger className="h-9 w-36" aria-label="Tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os tipos</SelectItem>
            {kinds.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABELS[k] ?? k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={group} onValueChange={filter(setGroup)}>
          <SelectTrigger className="h-9 w-44" aria-label="Grupo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os grupos</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.jid} value={g.jid}>
                {g.nome ?? g.jid}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={from} max={to || undefined} onChange={(e) => filter(setFrom)(e.target.value)} className="h-9 w-36" aria-label="De" />
        <Input type="date" value={to} min={from || undefined} onChange={(e) => filter(setTo)(e.target.value)} className="h-9 w-36" aria-label="Até" />
      </div>

      <ul className={cn("flex flex-col divide-y divide-border transition-opacity", isFetching && "opacity-70")}>
        {(data?.rows ?? []).map((m) => (
          <li key={m.id} className="flex flex-col gap-1 py-2.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted-foreground">
              <span>{date(m.sent_at)} {formatTime(m.sent_at)}</span>
              <span>· {m.group?.name ?? "Grupo"}</span>
              {m.kind !== "text" && <Badge variant="outline">{KIND_LABELS[m.kind] ?? m.kind}</Badge>}
              {m.category && <Badge variant="neutral">{classificationLabel(taxonomy, m.category, m.topic)}</Badge>}
              {m.flagged_at && <Flag className="size-3 fill-destructive text-destructive" aria-label="Mensagem com flag" />}
              {m.ticket_id && (
                <OpenTicketLink ticketId={m.ticket_id} className="ml-auto inline-flex items-center gap-1 text-primary hover:underline dark:text-[#9fc0ef]">
                  <ExternalLink className="size-3" /> Atendimento
                </OpenTicketLink>
              )}
            </span>
            <p className="whitespace-pre-wrap break-words text-[13.5px]">{m.body || <em className="text-muted-foreground">({KIND_LABELS[m.kind] ?? m.kind} sem legenda)</em>}</p>
          </li>
        ))}
        {data && !data.rows.length && <li className="py-8 text-center text-sm text-muted-foreground">Nenhuma mensagem com esses filtros.</li>}
      </ul>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Button variant="outline" size="icon-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          Página {page + 1} de {pages}
          <Button variant="outline" size="icon-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Próxima página">
            <ChevronRight />
          </Button>
        </div>
      )}
    </section>
  );
}

function ExemptToggle({ contactId, exempt, onDone }: { contactId: string; exempt: boolean; onDone: () => void }) {
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      let note: string | undefined;
      if (!exempt) {
        const answer = window.prompt("Autorizar a divulgar? O lead deixa de receber flags. Motivo (opcional):", "");
        if (answer === null) return;
        note = answer;
      }
      const res = await setFlagExempt({ contactId, exempt: !exempt, note });
      if (!res.ok) return void toast.error(res.error);
      toast.success(exempt ? "Autorização retirada." : "Divulgador autorizado: não recebe mais flags.");
      onDone();
    });
  return (
    <Button variant={exempt ? "default" : "outline"} size="sm" onClick={toggle} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <BadgeCheck />} {exempt ? "Divulgador autorizado" : "Autorizar a divulgar"}
    </Button>
  );
}

function CopyText({ value, mono, onCopy }: { value: string; mono?: boolean; onCopy: () => void }) {
  return (
    <button type="button" onClick={onCopy} className={cn("flex items-center gap-1 hover:text-foreground", mono && "font-mono text-xs")}>
      {value} <Copy className="size-3" />
    </button>
  );
}

function Stat({ label, value, foot, tone }: { label: string; value: number; foot?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-xl font-semibold tabular", tone === "good" && "text-success", tone === "bad" && "text-destructive")}>{value.toLocaleString("pt-BR")}</dd>
      {foot && <span className="text-[11px] text-muted-foreground">{foot}</span>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
