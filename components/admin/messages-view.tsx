"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Contact as ContactIcon,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageSquareText,
  Mic,
  Search,
  Smile,
  StickyNote,
  Vote,
  X,
  Video,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MESSAGE_COLUMNS, MESSAGE_KINDS, type MessageFilters, type MessagePeriod } from "@/lib/messages/query";
import { cn, contactLabel, formatPhone, nameColor, pluralize } from "@/lib/utils";
import { type ContactKind, type Message } from "@/lib/types";
import { classificationLabel } from "@/lib/taxonomy";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp, type Member } from "@/components/app/app-context";
import { FormattedText } from "@/components/conversation/formatted-text";
import { MessageMedia } from "@/components/conversation/message-media";
import { messageSnippet } from "@/components/conversation/message-utils";
import { OpenTicketLink } from "@/components/conversation/open-ticket-link";

export interface MessageRow extends Pick<
  Message,
  | "id"
  | "wa_id"
  | "group_jid"
  | "ticket_id"
  | "contact_id"
  | "author_id"
  | "from_me"
  | "is_note"
  | "sender_name"
  | "kind"
  | "body"
  | "media_path"
  | "media_store"
  | "media_name"
  | "media_mime"
  | "media_size"
  | "media_duration"
  | "media_status"
  | "quoted_wa_id"
  | "status"
  | "edited_at"
  | "deleted_at"
  | "sent_at"
> {
  legacy_id: string | null;
  category: string | null;
  topic: string | null;
  category_source: "atendimento" | "regras" | "herdada" | null;
  contact: { id: string; name: string | null; phone: string | null; lid: string | null; kind: ContactKind; avatar_url: string | null; company: { name: string } | null } | null;
  group: { name: string | null } | null;
  ticket: { number: number; category: string | null; topic: string | null; status: string } | null;
}

const ALL = "__all__";
const PERIODS: { value: MessagePeriod; label: string }[] = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "intervalo", label: "Período" },
  { value: "tudo", label: "Tudo" },
];
const KIND_ICON: Record<string, LucideIcon> = {
  text: MessageSquareText,
  image: ImageIcon,
  audio: Mic,
  video: Video,
  document: FileText,
  sticker: Smile,
  location: MapPin,
  contact: ContactIcon,
  poll: Vote,
  nota: StickyNote,
};
const kindOf = (m: Pick<MessageRow, "kind" | "is_note">) => (m.is_note ? "nota" : m.kind);
const kindLabel = (k: string) => MESSAGE_KINDS.find((x) => x.value === k)?.label ?? "Outro";

const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const fullDate = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" });

/** Quem escreveu: atendente do painel, número da comunidade, equipe ou membro. */
function authorOf(m: MessageRow, memberById: Map<string, Member>) {
  const member = m.author_id ? memberById.get(m.author_id) : undefined;
  const team = m.from_me || !!m.author_id || m.contact?.kind === "team";
  const name = member?.name ?? (m.contact ? contactLabel(m.contact) : null) ?? m.sender_name ?? (m.from_me ? "Comunidade DataCrazy" : "Desconhecido");
  const tag = team ? "Equipe" : m.contact?.kind === "partner" ? "Parceiro" : null;
  return { name, team, tag, avatar: member?.avatar_url ?? m.contact?.avatar_url ?? null, company: m.contact?.company?.name ?? null, seed: m.contact_id ?? name };
}

export function MessagesView({
  rows,
  total,
  page,
  pageSize,
  filters,
  groups,
  error,
}: {
  rows: MessageRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: MessageFilters;
  groups: { jid: string; name: string | null }[];
  error: string | null;
}) {
  const { memberById, taxonomy } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [search, setSearch] = useState(filters.q);
  const [open, setOpen] = useState<MessageRow | null>(null);

  const update = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (!("pagina" in patch)) params.delete("pagina");
    startNav(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  };

  useEffect(() => {
    if (search === filters.q) return;
    const timer = setTimeout(() => update({ q: search.trim() || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = !!(filters.q || filters.period !== "30" || filters.group || filters.kind || filters.category);
  const topics = filters.category ? taxonomy.topics.filter((t) => t.category === filters.category) : [];

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Texto, nome ou telefone do contato" className="pl-8" aria-label="Buscar mensagens" />
          </div>
          <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="tab"
                aria-selected={filters.period === p.value}
                onClick={() => update({ periodo: p.value === "30" ? null : p.value, ...(p.value !== "intervalo" ? { de: null, ate: null } : {}) })}
                className={cn(
                  "rounded px-2.5 py-1 text-[13px] transition-colors",
                  filters.period === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {filters.period === "intervalo" && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                De
                <Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ de: e.target.value || null })} className="h-9 w-36" aria-label="De" />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                até
                <Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ ate: e.target.value || null })} className="h-9 w-36" aria-label="Até" />
              </label>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.group || ALL} onValueChange={(v) => update({ grupo: v === ALL ? null : v })}>
            <SelectTrigger className="w-56" aria-label="Grupo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os grupos</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.jid} value={g.jid}>
                  {g.name ?? g.jid}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.kind || ALL} onValueChange={(v) => update({ tipo: v === ALL ? null : v })}>
            <SelectTrigger className="w-44" aria-label="Tipo de mensagem">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os tipos</SelectItem>
              {MESSAGE_KINDS.map((k) => {
                const Icon = KIND_ICON[k.value] ?? MessageSquareText;
                return (
                  <SelectItem key={k.value} value={k.value}>
                    <span className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      {k.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={filters.category || ALL} onValueChange={(v) => update({ categoria: v === ALL ? null : v, subcategoria: null })}>
            <SelectTrigger className="w-44" aria-label="Categoria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as categorias</SelectItem>
              {taxonomy.categories.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                  {c.archived ? " (arquivada)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {topics.length > 0 && (
            <Select value={filters.topic || ALL} onValueChange={(v) => update({ subcategoria: v === ALL ? null : v })}>
              <SelectTrigger className="w-44" aria-label="Subcategoria">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as subcategorias</SelectItem>
                {topics.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                    {t.archived ? " (arquivada)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                startNav(() => router.replace(pathname, { scroll: false }));
              }}
            >
              <X /> Limpar
            </Button>
          )}
          {navigating && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <span className="ml-auto text-sm text-muted-foreground tabular">{pluralize(total, "mensagem", "mensagens")}</span>
        </div>
        {filters.category && (
          <p className="text-xs text-muted-foreground">Categoria da mensagem: a do atendimento ou, fora dele, pelas regras e pelo assunto da conversa.</p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="w-[11%] px-4 py-2.5 font-semibold">Data</th>
              <th className="w-[18%] px-4 py-2.5 font-semibold">Remetente</th>
              <th className="w-[36%] px-4 py-2.5 font-semibold">Mensagem</th>
              <th className="w-[10%] px-4 py-2.5 font-semibold">Tipo</th>
              <th className="w-[12%] px-4 py-2.5 font-semibold">Grupo</th>
              <th className="w-[13%] px-4 py-2.5 font-semibold">Categoria</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const a = authorOf(m, memberById);
              const k = kindOf(m);
              const Icon = KIND_ICON[k] ?? MessageSquareText;
              const classification = classificationLabel(taxonomy, m.category, m.topic);
              return (
                <tr
                  key={m.id}
                  onClick={() => setOpen(m)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(m))}
                  tabIndex={0}
                  aria-label={`Abrir mensagem de ${a.name}`}
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                >
                  <td className="px-4 py-2.5 font-mono text-[12px] tabular text-muted-foreground">{dateTime.format(new Date(m.sent_at))}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <Avatar name={a.name} src={a.avatar} size="xs" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{a.name}</span>
                        <span className="truncate text-[11px] text-muted-foreground">{a.tag ?? a.company ?? (m.contact?.phone ? formatPhone(m.contact.phone) : "")}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("line-clamp-2 break-words", m.deleted_at && "italic text-muted-foreground")}>
                      {m.deleted_at ? "Mensagem apagada" : messageSnippet(m)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Icon className="size-3.5 shrink-0" />
                      <span className="truncate">{kindLabel(k)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="line-clamp-1 text-muted-foreground">{m.group?.name ?? m.group_jid}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-col">
                      <span className="truncate">{classification ?? <span className="text-muted-foreground">—</span>}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground tabular">{m.ticket ? `#${m.ticket.number}` : "fora de atendimento"}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <EmptyState
            icon={MessageSquareText}
            title={error ? "Não foi possível carregar as mensagens" : "Nenhuma mensagem encontrada"}
            description={error ? "Tente novamente em instantes." : hasFilters ? "Ajuste ou limpe os filtros." : "As mensagens aparecem aqui assim que chegam dos grupos."}
          />
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground tabular">
            Página {page} de {pages}
          </span>
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => update({ pagina: String(page - 1) })} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => update({ pagina: String(page + 1) })} aria-label="Próxima página">
            <ChevronRight />
          </Button>
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          {open && <MessageContext key={open.id} initial={open} />}
        </DialogContent>
      </Dialog>
    </main>
  );
}

// --- modal: anterior, a mensagem e a seguinte (mesmo grupo) ------------------------

const COLUMNS = `${MESSAGE_COLUMNS}, ticket:tickets!messages_ticket_id_fkey(number, category, topic, status)`;

async function neighbor(m: MessageRow, dir: "prev" | "next"): Promise<MessageRow | null> {
  const s = m.sent_at;
  let q = createClient().from("messages").select(COLUMNS).eq("group_jid", m.group_jid).eq("is_note", false);
  q =
    dir === "prev"
      ? q.or(`sent_at.lt.${s},and(sent_at.eq.${s},id.lt.${m.id})`).order("sent_at", { ascending: false }).order("id", { ascending: false })
      : q.or(`sent_at.gt.${s},and(sent_at.eq.${s},id.gt.${m.id})`).order("sent_at", { ascending: true }).order("id", { ascending: true });
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw error;
  return (data as unknown as MessageRow | null) ?? null;
}

function MessageContext({ initial }: { initial: MessageRow }) {
  const { memberById, taxonomy } = useApp();
  const [current, setCurrent] = useState(initial);
  const { data, isFetching } = useQuery({
    queryKey: ["message-context", current.id],
    queryFn: async () => {
      const [prev, next, quoted] = await Promise.all([
        neighbor(current, "prev"),
        neighbor(current, "next"),
        current.quoted_wa_id
          ? createClient().from("messages").select(COLUMNS).eq("wa_id", current.quoted_wa_id).maybeSingle().then((r) => (r.data as unknown as MessageRow | null) ?? null)
          : Promise.resolve(null),
      ]);
      return { prev, next, quoted };
    },
  });

  // Setas do teclado andam pela conversa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && data?.prev) setCurrent(data.prev);
      if (e.key === "ArrowRight" && data?.next) setCurrent(data.next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data]);

  const classification = classificationLabel(taxonomy, current.category, current.topic);
  const SOURCE: Record<string, string> = { atendimento: "do atendimento", regras: "por regras", herdada: "herdada da conversa" };

  return (
    <>
      <DialogHeader className="gap-2 border-b border-border p-5 pr-12 text-left">
        <DialogTitle className="text-base">{current.group?.name ?? current.group_jid}</DialogTitle>
        <DialogDescription className="first-letter:uppercase">{fullDate.format(new Date(current.sent_at))}</DialogDescription>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{kindLabel(kindOf(current))}</Badge>
          {classification && (
            <Badge variant="neutral" title={current.category_source ? `Categoria ${SOURCE[current.category_source]}` : undefined}>
              {classification}
            </Badge>
          )}
          {current.ticket && <Badge variant="outline">Atendimento #{current.ticket.number}</Badge>}
          {current.legacy_id && <Badge variant="outline">Sistema antigo</Badge>}
          {current.ticket_id && (
            <Button variant="ghost" size="sm" className="ml-auto h-7" asChild>
              <OpenTicketLink ticketId={current.ticket_id}>
                <ExternalLink /> Abrir atendimento
              </OpenTicketLink>
            </Button>
          )}
        </div>
      </DialogHeader>

      <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-background px-3 py-4 sm:px-5">
        <Slot label="Anterior" loading={isFetching && !data} message={data?.prev ?? null} memberById={memberById} onPick={setCurrent} />
        <Bubble message={current} memberById={memberById} quoted={data?.quoted ?? null} highlight />
        <Slot label="Seguinte" loading={isFetching && !data} message={data?.next ?? null} memberById={memberById} onPick={setCurrent} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
        <Button variant="outline" size="sm" disabled={!data?.prev} onClick={() => data?.prev && setCurrent(data.prev)}>
          <ChevronLeft /> Anterior
        </Button>
        <span className="hidden text-xs text-muted-foreground sm:inline">Use as setas ← → do teclado</span>
        <Button variant="outline" size="sm" disabled={!data?.next} onClick={() => data?.next && setCurrent(data.next)}>
          Seguinte <ChevronRight />
        </Button>
      </div>
    </>
  );
}

function Slot({
  label,
  loading,
  message,
  memberById,
  onPick,
}: {
  label: string;
  loading: boolean;
  message: MessageRow | null;
  memberById: Map<string, Member>;
  onPick: (m: MessageRow) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-14 w-2/3" />
      ) : message ? (
        <button type="button" onClick={() => onPick(message)} className="rounded-xl text-left opacity-80 transition-opacity hover:opacity-100" aria-label={`Ir para a mensagem ${label.toLowerCase()}`}>
          <Bubble message={message} memberById={memberById} quoted={null} />
        </button>
      ) : (
        <p className="px-1 text-[13px] text-muted-foreground">Nenhuma mensagem {label === "Anterior" ? "antes desta" : "depois desta"} no grupo.</p>
      )}
    </div>
  );
}

function Bubble({ message: m, memberById, quoted, highlight }: { message: MessageRow; memberById: Map<string, Member>; quoted: MessageRow | null; highlight?: boolean }) {
  const a = authorOf(m, memberById);
  const time = new Date(m.sent_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (m.is_note) {
    return (
      <div className={cn("rounded-lg border border-note-border bg-note px-3 py-2 text-[13px] text-note-foreground", highlight && "ring-2 ring-primary/60")}>
        <span className="mb-0.5 block text-[11px] font-semibold">Nota interna · {a.name}</span>
        <FormattedText text={m.body ?? ""} className="whitespace-pre-wrap break-words" />
        <span className="mt-1 block text-right text-[10.5px] opacity-70">{time}</span>
      </div>
    );
  }
  return (
    <div className={cn("flex w-full", a.team ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[min(38rem,90%)] flex-col gap-1 rounded-xl border px-3 py-2 text-[13.5px] shadow-sm",
          a.team ? "rounded-tr-sm border-bubble-me-border bg-bubble-me" : "rounded-tl-sm border-border bg-bubble",
          highlight && "ring-2 ring-primary/60",
        )}
      >
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] font-semibold" style={a.team ? undefined : { color: nameColor(a.seed) }}>
          {a.name}
          {a.tag && <span className="text-[10.5px] font-medium text-muted-foreground">{a.tag}</span>}
          {a.company && <span className="text-[10.5px] font-normal text-muted-foreground">· {a.company}</span>}
        </span>
        {quoted && (
          <span className="rounded-md border-l-2 border-primary/60 bg-muted/60 px-2 py-1 text-[12px] text-muted-foreground">
            <span className="block font-medium text-foreground/80">{authorOf(quoted, memberById).name}</span>
            <span className="line-clamp-2">{messageSnippet(quoted)}</span>
          </span>
        )}
        {m.deleted_at ? (
          <span className="italic text-muted-foreground">Mensagem apagada</span>
        ) : (
          <>
            {m.kind !== "text" && <MessageMedia message={m as unknown as Message} />}
            {m.body && <FormattedText text={m.body} className="whitespace-pre-wrap break-words" />}
          </>
        )}
        <span className="self-end text-[10.5px] text-muted-foreground">
          {m.edited_at && "editada · "}
          {time}
        </span>
      </div>
    </div>
  );
}
