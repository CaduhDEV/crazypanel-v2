"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, ChevronDown, ChevronRight, Loader2, RefreshCw, RotateCw, Send, Trash2, Unplug, Webhook } from "lucide-react";
import { toast } from "sonner";
import {
  getAlertSettings,
  getWebhookEventPayload,
  listConnectionLogs,
  listWebhookEvents,
  reprocessEvent,
  saveAlertSettings,
  sendTestAlert,
  type AlertSettingsView,
  type ConnectionLogRow,
  type WebhookEventRow,
} from "@/lib/admin/logs";
import { reprocessFailedEvents } from "@/lib/admin/whatsapp";
import { createClient } from "@/lib/supabase/client";
import { cn, formatRelative } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EmptyState, Skeleton, Switch, Tip } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type LogsTab = "conexao" | "eventos" | "alertas";

const TAB_LABELS: Record<LogsTab, string> = { conexao: "Conexão", eventos: "Eventos do webhook", alertas: "Alertas no Discord" };

const STATUS: Record<string, { label: string; dot: string }> = {
  connected: { label: "Conectado", dot: "bg-success" },
  connecting: { label: "Conectando", dot: "bg-warning" },
  disconnected: { label: "Desconectado", dot: "bg-destructive" },
  hibernated: { label: "Hibernado", dot: "bg-muted-foreground" },
};

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" });
const fmt = (iso: string) => dateTime.format(new Date(iso));

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const res = await p;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function LogsView({
  initialTab,
  instance,
}: {
  initialTab: LogsTab;
  instance: { status: string; phone: string | null; lastEventAt: string | null; lastDisconnectReason: string | null };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<LogsTab>(initialTab);

  const choose = (t: LogsTab) => {
    setTab(t);
    router.replace(`${pathname}?aba=${t}`, { scroll: false });
  };

  const st = STATUS[instance.status] ?? { label: instance.status, dot: "bg-muted-foreground" };

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <span className={cn("size-2 rounded-full", st.dot)} aria-hidden /> {st.label}
        </span>
        {instance.phone && <span className="text-muted-foreground">+{instance.phone}</span>}
        {instance.lastEventAt && <span className="text-muted-foreground">último evento {formatRelative(instance.lastEventAt)}</span>}
        {instance.status !== "connected" && instance.lastDisconnectReason && (
          <span className="text-destructive">Motivo: {instance.lastDisconnectReason}</span>
        )}
      </div>

      <div className="flex w-fit gap-1 rounded-md border border-border bg-card p-0.5" role="tablist" aria-label="Logs">
        {(Object.keys(TAB_LABELS) as LogsTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => choose(t)}
            className={cn(
              "rounded px-3 py-1.5 text-sm transition-colors",
              tab === t ? "bg-primary-soft font-medium text-primary dark:text-[#9fc0ef]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "conexao" && <ConnectionTab />}
      {tab === "eventos" && <EventsTab />}
      {tab === "alertas" && <AlertsTab />}
    </main>
  );
}

// =============================================================================
// Conexão
// =============================================================================
const ALERT_LABEL: Record<string, string> = { sent: "Avisado no Discord", skipped: "Sem aviso", failed: "Falha no aviso" };

function ConnectionTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["logs", "connection"], queryFn: () => unwrap(listConnectionLogs()) });

  // Atualiza na hora quando a conexão muda.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("connection-logs")
      .on("postgres_changes", { event: "*", schema: "public", table: "connection_logs" }, () =>
        queryClient.invalidateQueries({ queryKey: ["logs", "connection"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Tempo fora do ar: de cada queda até a próxima volta.
  const downtime = new Map<number, number>();
  if (data) {
    const asc = [...data].reverse();
    for (let i = 0; i < asc.length; i++) {
      if (asc[i].status !== "disconnected" && asc[i].status !== "hibernated") continue;
      const back = asc.slice(i + 1).find((l) => l.status === "connected");
      if (back) downtime.set(asc[i].id, (Date.parse(back.created_at) - Date.parse(asc[i].created_at)) / 1000);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Cada mudança de status da instância, das mais recentes para as mais antigas.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />} Atualizar
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Quando</th>
              <th className="px-4 py-2.5 font-semibold">Mudança</th>
              <th className="px-4 py-2.5 font-semibold">Motivo</th>
              <th className="px-4 py-2.5 font-semibold">Fora do ar</th>
              <th className="px-4 py-2.5 font-semibold">Alerta</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((l: ConnectionLogRow) => {
              const to = STATUS[l.status] ?? { label: l.status, dot: "bg-muted-foreground" };
              const down = downtime.get(l.id);
              return (
                <tr key={l.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5">
                    <span className="flex flex-col">
                      <span className="tabular">{fmt(l.created_at)}</span>
                      <span className="text-[11px] text-muted-foreground">{formatRelative(l.created_at)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">{STATUS[l.previous_status ?? ""]?.label ?? l.previous_status ?? "—"}</span>
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                      <span className="flex items-center gap-1.5 font-medium">
                        <span className={cn("size-2 rounded-full", to.dot)} aria-hidden /> {to.label}
                      </span>
                    </span>
                  </td>
                  <td className="max-w-72 px-4 py-2.5 text-muted-foreground">
                    <span className="line-clamp-2 break-words">{l.reason ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 tabular text-muted-foreground">{down != null ? humanDuration(down) : "—"}</td>
                  <td className="px-4 py-2.5">
                    {l.alert_status ? (
                      <Tip label={l.alert_error ?? ALERT_LABEL[l.alert_status]}>
                        <span>
                          <Badge variant={l.alert_status === "sent" ? "primary" : l.alert_status === "failed" ? "destructive" : "outline"}>
                            {ALERT_LABEL[l.alert_status]}
                          </Badge>
                        </span>
                      </Tip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {isLoading && <Skeleton className="m-4 h-24" />}
        {!isLoading && !data?.length && (
          <EmptyState icon={Unplug} title="Nenhuma mudança registrada" description="As quedas e reconexões aparecem aqui a partir de agora." />
        )}
      </div>
    </section>
  );
}

function humanDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

// =============================================================================
// Eventos do webhook
// =============================================================================
const ALL = "__all__";

function EventsTab() {
  const [type, setType] = useState("");
  const [state, setState] = useState<"todos" | "ok" | "erro" | "pendente">("todos");
  const [open, setOpen] = useState<number | null>(null);
  const [reprocessing, startReprocess] = useTransition();

  const query = useInfiniteQuery({
    queryKey: ["logs", "events", type, state],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => unwrap(listWebhookEvents({ type, state, before: pageParam })),
    getNextPageParam: (last) => (last.hasMore ? last.events[last.events.length - 1]?.id : undefined),
  });
  const events = query.data?.pages.flatMap((p) => p.events) ?? [];
  const types = query.data?.pages[0]?.types ?? [];

  const reprocessFailed = () =>
    startReprocess(async () => {
      const res = await reprocessFailedEvents();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data ? `${res.data} eventos enviados para reprocessar.` : "Nenhum evento com falha.");
      setTimeout(() => query.refetch(), 1500);
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type || ALL} onValueChange={(v) => setType(v === ALL ? "" : v)}>
          <SelectTrigger className="w-48" aria-label="Tipo de evento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os tipos</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={(v) => setState(v as typeof state)}>
          <SelectTrigger className="w-40" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as situações</SelectItem>
            <SelectItem value="ok">Processados</SelectItem>
            <SelectItem value="erro">Com erro</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching && !query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : <RefreshCw />} Atualizar
        </Button>
        <Button variant="outline" size="sm" className="ml-auto" onClick={reprocessFailed} disabled={reprocessing}>
          {reprocessing ? <Loader2 className="animate-spin" /> : <RotateCw />} Reprocessar os com erro
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <EventRow key={e.id} event={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} onReprocessed={() => query.refetch()} />
          ))}
        </ul>
        {query.isLoading && <Skeleton className="m-4 h-32" />}
        {!query.isLoading && events.length === 0 && (
          <EmptyState icon={Webhook} title="Nenhum evento" description="Ajuste os filtros ou confira se o webhook está configurado em WhatsApp." />
        )}
      </div>
      {query.hasNextPage && (
        <Button variant="outline" size="sm" className="self-center" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {query.isFetchingNextPage && <Loader2 className="animate-spin" />} Carregar mais
        </Button>
      )}
    </section>
  );
}

function EventRow({ event: e, open, onToggle, onReprocessed }: { event: WebhookEventRow; open: boolean; onToggle: () => void; onReprocessed: () => void }) {
  const [pending, start] = useTransition();
  const payload = useQuery({
    queryKey: ["logs", "event", e.id],
    enabled: open,
    queryFn: () => unwrap(getWebhookEventPayload({ id: e.id })),
  });
  const state = e.processed_at ? "ok" : e.error ? "erro" : "pendente";

  const reprocess = () =>
    start(async () => {
      const res = await reprocessEvent({ id: e.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Evento ${e.id} enviado para reprocessar.`);
      setTimeout(onReprocessed, 1200);
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload.data, null, 2));
      toast.success("Payload copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <li>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent/40" aria-expanded={open}>
        {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        <span className="w-14 shrink-0 font-mono text-[12px] tabular text-muted-foreground">#{e.id}</span>
        <span className="w-32 shrink-0 font-mono text-[12px]">{e.event_type}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.summary ?? "—"}</span>
        <span className="shrink-0 text-[12px] tabular text-muted-foreground">{fmt(e.received_at)}</span>
        <Badge variant={state === "ok" ? "neutral" : state === "erro" ? "destructive" : "warning"}>
          {state === "ok" ? "ok" : state === "erro" ? `erro · ${e.attempts}x` : "pendente"}
        </Badge>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border bg-muted/30 px-4 py-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Recebido</dt>
              <dd className="tabular">{fmt(e.received_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Processado</dt>
              <dd className="tabular">{e.processed_at ? fmt(e.processed_at) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tentativas</dt>
              <dd className="tabular">{e.attempts}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Latência</dt>
              <dd className="tabular">{e.processed_at ? `${Math.max(0, Date.parse(e.processed_at) - Date.parse(e.received_at))} ms` : "—"}</dd>
            </div>
          </dl>
          {e.error && <p className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 font-mono text-xs text-destructive">{e.error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reprocess} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <RotateCw />} Reprocessar
            </Button>
            <Button variant="outline" size="sm" onClick={copy} disabled={!payload.data}>
              Copiar payload
            </Button>
          </div>
          {payload.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <pre className="scroll-thin max-h-96 overflow-auto rounded-md border border-border bg-card p-3 font-mono text-[11.5px] leading-relaxed">
              {JSON.stringify(payload.data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

// =============================================================================
// Alertas no Discord
// =============================================================================
function AlertsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["logs", "alerts"], queryFn: () => unwrap(getAlertSettings()) });
  if (isLoading || !data) return <Skeleton className="h-64 max-w-2xl" />;
  return <AlertsForm key={data.updatedAt ?? "new"} initial={data} onSaved={() => queryClient.invalidateQueries({ queryKey: ["logs", "alerts"] })} />;
}

function AlertsForm({ initial, onSaved }: { initial: AlertSettingsView; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [mention, setMention] = useState(initial.mention);
  const [notifyDisconnect, setNotifyDisconnect] = useState(initial.notifyDisconnect);
  const [notifyReconnect, setNotifyReconnect] = useState(initial.notifyReconnect);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  const save = (removeWebhook = false) =>
    startSave(async () => {
      const res = await saveAlertSettings({ webhookUrl: url || undefined, removeWebhook, mention, notifyDisconnect, notifyReconnect });
      if (!res.ok) return void toast.error(res.error);
      toast.success(removeWebhook ? "Webhook removido." : "Alertas salvos.");
      setUrl("");
      onSaved();
    });

  const test = () =>
    startTest(async () => {
      const res = await sendTestAlert();
      if (!res.ok) return void toast.error(res.error);
      toast.success("Teste enviado. Confira o canal no Discord.");
    });

  return (
    <form
      className="flex max-w-2xl flex-col gap-5 rounded-lg border border-border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary dark:text-[#9fc0ef]">
          <BellRing className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Avisar no Discord quando a conexão cair</h2>
          <p className="text-[13px] text-muted-foreground">
            Manda um embed no canal quando o WhatsApp desconectar e quando voltar. No Discord: Configurações do canal → Integrações → Webhooks →
            Novo webhook → Copiar URL.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="discord-url">URL do webhook</Label>
        <Input
          id="discord-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={initial.configured ? `Salva (termina em …${initial.hint}). Cole outra para trocar.` : "https://discord.com/api/webhooks/…"}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">A URL fica criptografada e não aparece de novo na tela.</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="discord-mention">Mencionar na queda (opcional)</Label>
        <Input id="discord-mention" value={mention} onChange={(e) => setMention(e.target.value)} placeholder="@here, @everyone ou <@&ID-do-cargo>" className="max-w-sm" />
        <p className="text-xs text-muted-foreground">Vai no texto da mensagem de queda, para notificar quem estiver no canal.</p>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            Avisar quando cair
            <span className="block text-xs text-muted-foreground">De conectado para desconectado ou hibernado.</span>
          </span>
          <Switch checked={notifyDisconnect} onCheckedChange={setNotifyDisconnect} />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            Avisar quando voltar
            <span className="block text-xs text-muted-foreground">Quando a instância conectar de novo.</span>
          </span>
          <Switch checked={notifyReconnect} onCheckedChange={setNotifyReconnect} />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={test} disabled={!initial.configured || testing || saving}>
            {testing ? <Loader2 className="animate-spin" /> : <Send />} Enviar teste
          </Button>
          {initial.configured && (
            <Button type="button" variant="destructive-ghost" size="sm" onClick={() => save(true)} disabled={saving}>
              <Trash2 /> Remover webhook
            </Button>
          )}
        </div>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Salvar
        </Button>
      </div>
    </form>
  );
}

