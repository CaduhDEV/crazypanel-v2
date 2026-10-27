"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Bot, Brain, Check, ChevronDown, Copy, ExternalLink, History, Loader2, Pencil, Play, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  editBrainItem,
  listBrainHistory,
  resolveBrainProposal,
  runBrainNow,
  setBrainEnabled,
  setBrainStatus,
  type BrainSourceRow,
  type BrainVersionRow,
} from "@/lib/brain/actions";
import { BRAIN_AGENT_INSTRUCTIONS, BRAIN_PROMPT, BRAIN_TOOLS } from "@/lib/ai/brain-prompt";
import { activeCategories, classificationLabel } from "@/lib/taxonomy";
import { cn, formatDayLabel, formatRelative } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { EmptyState, Switch } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/components/app/app-context";
import { OpenTicketLink } from "@/components/conversation/open-ticket-link";

export interface BrainItem {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  topic: string | null;
  status: "draft" | "approved" | "archived";
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  answer_changed_at: string;
  proposed_answer: string | null;
  proposed_at: string | null;
  confidence: number | null;
  edited: boolean;
}

export interface BrainStats {
  total: number;
  approved: number;
  drafts: number;
  changed: number;
  pending: number;
}

export interface BrainRequestRow {
  id: string;
  status: "sent" | "done" | "rejected" | "failed";
  sent_at: string;
  ticket_ids: string[];
  created: number;
  confirmed: number;
  updated: number;
  skipped: number;
  error: string | null;
}

const ALL = "__all";
const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "draft", label: "Para revisar" },
  { value: "approved", label: "Revisados" },
  { value: "changed", label: "Resposta nova" },
  { value: "archived", label: "Arquivados" },
];
/** Sem aparecer há mais que isso, pode estar desatualizado (igual à busca do agente). */
const STALE_DAYS = 120;

const date = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function BrainView({
  items,
  stats,
  filters,
  enabled,
  configured,
  requests,
  urls,
  error,
}: {
  items: BrainItem[];
  stats: BrainStats;
  filters: { q: string; status: string; category: string; order: "frequentes" | "recentes" };
  enabled: boolean;
  configured: boolean;
  requests: BrainRequestRow[];
  urls: { busca: string; panorama: string; callback: string };
  error: string | null;
}) {
  const router = useRouter();
  const { taxonomy } = useApp();
  const [search, setSearch] = useState(filters.q);
  const [now] = useState(() => Date.now());

  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const next = { q: filters.q, status: filters.status, categoria: filters.category, ordem: filters.order === "recentes" ? "recentes" : "", ...patch };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    router.push(p.size ? `/cerebro?${p}` : "/cerebro");
  };

  return (
    <main className="flex-1 px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Itens no cérebro" value={stats.total} />
          <Stat label="Revisados" value={stats.approved} tone="success" />
          <Stat label="Para revisar" value={stats.drafts} tone="warning" />
          <Stat label="Com resposta nova" value={stats.changed} tone="primary" />
          <Stat label="Atendimentos a ler" value={stats.pending} />
        </div>

        <AgentPanel enabled={enabled} configured={configured} requests={requests} urls={urls} pending={stats.pending} onChanged={() => router.refresh()} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {STATUS_TABS.map((t) => (
              <Button key={t.value || "all"} size="sm" variant={filters.status === t.value ? "default" : "outline"} onClick={() => go({ status: t.value })}>
                {t.label}
              </Button>
            ))}
          </div>
          <Select value={filters.category || ALL} onValueChange={(v) => go({ categoria: v === ALL ? null : v })}>
            <SelectTrigger className="w-44" aria-label="Categoria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as categorias</SelectItem>
              {activeCategories(taxonomy).map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!filters.q && (
            <Select value={filters.order} onValueChange={(v) => go({ ordem: v === "recentes" ? "recentes" : null })}>
              <SelectTrigger className="w-40" aria-label="Ordem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="frequentes">Mais frequentes</SelectItem>
                <SelectItem value="recentes">Vistos por último</SelectItem>
              </SelectContent>
            </Select>
          )}
          <form
            className="ml-auto flex w-full items-center gap-2 sm:w-96"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: search.trim() || null });
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Perguntar ao cérebro (ex.: disparo não chega)" className="pl-8" aria-label="Buscar" />
            </div>
            <Button type="submit" variant="outline">
              Buscar
            </Button>
          </form>
        </div>

        {filters.q && <p className="text-xs text-muted-foreground">Ordenado como o agente vê: texto, frequência e quando a resposta foi vista por último.</p>}

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Brain}
            title={filters.q ? "Nada encontrado" : "O cérebro ainda está vazio"}
            description={filters.q ? "Tente outras palavras." : "Ligue a leitura acima: a IA lê os atendimentos resolvidos e monta os itens aqui."}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} now={now} label={classificationLabel(taxonomy, item.category, item.topic)} onChanged={() => router.refresh()} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "primary" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl font-semibold tabular",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "primary" && "text-primary dark:text-[#9fc0ef]",
        )}
      >
        {value.toLocaleString("pt-BR")}
      </span>
    </div>
  );
}

function ItemCard({ item, now, label, onChanged }: { item: BrainItem; now: number; label: string | null; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const idleDays = Math.floor((now - Date.parse(item.last_seen_at)) / 86_400_000);
  const changedLater = item.answer_changed_at.slice(0, 10) !== item.first_seen_at.slice(0, 10);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(ok);
      onChanged();
    });

  return (
    <article className={cn("flex flex-col gap-3 rounded-lg border border-border bg-card p-4", item.status === "archived" && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.status === "approved" ? (
              <Badge variant="success">Revisado</Badge>
            ) : item.status === "archived" ? (
              <Badge variant="neutral">Arquivado</Badge>
            ) : (
              <Badge variant="warning" className="gap-1">
                <Bot className="size-3" /> Para revisar
              </Badge>
            )}
            {label && <Badge variant="outline">{label}</Badge>}
            {idleDays > STALE_DAYS && <Badge variant="outline">Não aparece há {idleDays} dias</Badge>}
          </div>
          <h3 className="text-[15px] font-semibold leading-snug">{item.question}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.status !== "approved" && item.status !== "archived" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setBrainStatus({ id: item.id, status: "approved" }), "Item revisado.")}>
              <Check /> Aprovar
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Editar">
            <Pencil />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setHistory(true)} aria-label="Linha do tempo">
            <History />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={pending}
            aria-label={item.status === "archived" ? "Restaurar" : "Arquivar"}
            onClick={() =>
              run(
                () => setBrainStatus({ id: item.id, status: item.status === "archived" ? "draft" : "archived" }),
                item.status === "archived" ? "Item restaurado." : "Item arquivado: sai da busca do agente.",
              )
            }
          >
            {item.status === "archived" ? <ArchiveRestore /> : <Archive />}
          </Button>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/90">{item.answer}</p>

      {item.proposed_answer && (
        <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary-soft/50 p-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary dark:text-[#9fc0ef]">
            <Sparkles className="size-3.5" /> Resposta mais recente{item.proposed_at ? `, de ${date(item.proposed_at)}` : ""}: a informação pode ter mudado
          </span>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{item.proposed_answer}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => resolveBrainProposal({ id: item.id, accept: true }), "Resposta atualizada.")}>
              Usar a nova
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveBrainProposal({ id: item.id, accept: false }), "Mantida a resposta atual.")}>
              Manter a atual
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">
          {item.occurrences} {item.occurrences === 1 ? "atendimento" : "atendimentos"}
        </span>
        <span>Visto por último {formatRelative(item.last_seen_at)}</span>
        <span>Desde {date(item.first_seen_at)}</span>
        {changedLater && <span>Resposta atualizada em {date(item.answer_changed_at)}</span>}
        {item.edited && <span>Editado pela equipe</span>}
        {item.confidence != null && item.status === "draft" && <span>{Math.round(Number(item.confidence) * 100)}% de certeza da IA</span>}
      </div>

      {editing && <EditDialog item={item} onClose={() => setEditing(false)} onSaved={onChanged} />}
      {history && <HistoryDialog item={item} onClose={() => setHistory(false)} />}
    </article>
  );
}

function EditDialog({ item, onClose, onSaved }: { item: BrainItem; onClose: () => void; onSaved: () => void }) {
  const [question, setQuestion] = useState(item.question);
  const [answer, setAnswer] = useState(item.answer);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await editBrainItem({ id: item.id, question, answer, approve: true });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Item salvo e revisado.");
      onClose();
      onSaved();
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar item</DialogTitle>
          <DialogDescription>Ao salvar, o item fica revisado. Respostas novas da IA passam a chegar como sugestão.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brain-q">Pergunta</Label>
          <Input id="brain-q" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brain-a">Resposta</Label>
          <Textarea id="brain-a" rows={8} maxLength={4000} value={answer} onChange={(e) => setAnswer(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={pending || question.trim().length < 3 || answer.trim().length < 3}>
            {pending && <Loader2 className="animate-spin" />} Salvar e revisar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SOURCE_TEXT: Record<BrainSourceRow["action"], string> = { new: "Criou o item", same: "Confirmou a resposta", update: "Trouxe resposta nova" };

function HistoryDialog({ item, onClose }: { item: BrainItem; onClose: () => void }) {
  const [data, setData] = useState<{ sources: BrainSourceRow[]; versions: BrainVersionRow[] } | null>(null);
  useEffect(() => {
    let alive = true;
    listBrainHistory({ id: item.id }).then((res) => {
      if (!alive) return;
      if (!res.ok) return void toast.error(res.error);
      setData(res.data);
    });
    return () => {
      alive = false;
    };
  }, [item.id]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Linha do tempo</DialogTitle>
          <DialogDescription className="line-clamp-2">{item.question}</DialogDescription>
        </DialogHeader>
        {!data ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="scroll-thin flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <section className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Atendimentos ({data.sources.length})</span>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
                {data.sources.map((s) => (
                  <li key={s.ticket_id} className="flex flex-col gap-1 px-3 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cn("font-medium", s.action === "update" && "text-primary dark:text-[#9fc0ef]")}>{SOURCE_TEXT[s.action]}</span>
                      <span className="text-muted-foreground">{formatDayLabel(s.seen_at)}</span>
                      <OpenTicketLink ticketId={s.ticket_id} className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline">
                        <ExternalLink className="size-3" /> #{s.ticket?.number ?? "—"}
                      </OpenTicketLink>
                    </span>
                    {s.action === "update" && s.answer && <span className="line-clamp-3 text-muted-foreground">{s.answer}</span>}
                  </li>
                ))}
              </ul>
            </section>
            {data.versions.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Respostas anteriores</span>
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
                  {data.versions.map((v) => (
                    <li key={v.id} className="flex flex-col gap-1 px-3 py-2">
                      <span className="text-muted-foreground">
                        Valeu até {date(v.valid_until)}
                        {v.changer ? ` · trocada por ${v.changer.name}` : " · trocada por um atendimento mais novo"}
                      </span>
                      <span className="whitespace-pre-wrap text-foreground/80">{v.answer}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const REQUEST_TEXT: Record<BrainRequestRow["status"], string> = { sent: "Aguardando a IA", done: "Lido", rejected: "Retorno recusado", failed: "Falhou" };

function AgentPanel({
  enabled,
  configured,
  requests,
  urls,
  pending,
  onChanged,
}: {
  enabled: boolean;
  configured: boolean;
  requests: BrainRequestRow[];
  urls: { busca: string; panorama: string; callback: string };
  pending: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(!configured || !enabled);
  const [busy, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const toggle = (v: boolean) =>
    start(async () => {
      const res = await setBrainEnabled({ enabled: v });
      if (!res.ok) return void toast.error(res.error);
      toast.success(v ? "Leitura ligada: os atendimentos resolvidos vão para a IA, do mais antigo ao mais novo." : "Leitura desligada.");
      onChanged();
    });

  const runNow = () =>
    start(async () => {
      const res = await runBrainNow();
      if (!res.ok) return void toast.error(res.error);
      if (res.data.sent) toast.success(`${res.data.tickets} atendimentos enviados para a IA.`);
      else toast.message(res.data.reason ?? "Nada enviado.");
      onChanged();
    });

  const btn = (k: string, text: string, label: string) => (
    <CopyButton copied={copied === k} disabled={!configured && k.startsWith("url")} label={label} onClick={() => copy(k, text)} />
  );

  return (
    <section className="rounded-lg border border-border bg-card">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <Brain className="size-4 text-primary" />
        <span className="flex-1 text-sm font-semibold">Agentes do cérebro</span>
        <Badge variant={enabled && configured ? "success" : "outline"}>{!configured ? "Não configurado" : enabled ? "Lendo" : "Desligado"}</Badge>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-5 border-t border-border p-4">
          {!configured && (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              Falta configurar <span className="font-mono">AI_BRAIN_WEBHOOK_URL</span> (webhook do agente que monta o cérebro) nas variáveis do painel.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="text-[13px] font-semibold">1. Agente que monta o cérebro</h3>
              <label className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium">Ler atendimentos resolvidos</span>
                  <span className="text-xs text-muted-foreground">
                    Do mais antigo ao mais novo, 15 por vez. Faltam {pending.toLocaleString("pt-BR")}. Os novos entram sozinhos.
                  </span>
                </span>
                <Switch checked={enabled} onCheckedChange={toggle} disabled={busy || !configured} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={runNow} disabled={busy || !configured}>
                  {busy ? <Loader2 className="animate-spin" /> : <Play />} Ler agora
                </Button>
                {btn("prompt", BRAIN_PROMPT, "Copiar prompt")}
                {btn("url-callback", urls.callback, "Copiar retorno")}
              </div>
              {requests.length > 0 && (
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
                  {requests.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">
                          {r.ticket_ids.length} atendimentos · {REQUEST_TEXT[r.status]}
                          {r.status === "done" && ` · ${r.created} novos, ${r.confirmed} confirmados, ${r.updated} atualizados`}
                        </span>
                        {r.error && <span className="truncate text-muted-foreground">{r.error}</span>}
                      </span>
                      <span className={cn("shrink-0 text-muted-foreground", (r.status === "failed" || r.status === "rejected") && "text-destructive")}>{formatRelative(r.sent_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-[13px] font-semibold">2. Agente da equipe (ferramentas MCP)</h3>
              <p className="text-xs text-muted-foreground">
                Crie no DC as duas ferramentas abaixo. Em cada fluxo, o bloco de API chama a URL com os parâmetros (GET na URL ou POST com JSON). A chave já
                vai na URL.
              </p>
              {BRAIN_TOOLS.map((t) => (
                <div key={t.name} className="flex flex-col gap-1.5 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[12.5px] font-semibold">{t.name}</span>
                    {btn(`url-${t.name}`, t.name === "consultar_cerebro" ? urls.busca : urls.panorama, "Copiar URL")}
                  </div>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                  <ul className="flex flex-col gap-0.5 text-xs">
                    {t.params.map((p) => (
                      <li key={p.name}>
                        <span className="font-mono">{p.name}</span>
                        {p.required ? " (obrigatório)" : " (opcional)"}: <span className="text-muted-foreground">{p.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div>
                {btn("instr", BRAIN_AGENT_INSTRUCTIONS, "Copiar instrução do agente")}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CopyButton({ copied, disabled, label, onClick }: { copied: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={disabled}>
      {copied ? <Check /> : <Copy />} {label}
    </Button>
  );
}
