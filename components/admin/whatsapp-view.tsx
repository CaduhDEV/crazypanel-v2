"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  Link2,
  Loader2,
  PlugZap,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import {
  configureWebhook,
  connectInstance,
  disconnectInstance,
  getInstanceState,
  listRecentEvents,
  reprocessFailedEvents,
  saveInstanceConfig,
  type InstanceState,
} from "@/lib/admin/whatsapp";
import { cn, formatPhone, formatRelative } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";

const STATUS_META: Record<InstanceState["status"], { label: string; variant: "success" | "warning" | "destructive" | "neutral" }> = {
  connected: { label: "Conectado", variant: "success" },
  connecting: { label: "Conectando", variant: "warning" },
  disconnected: { label: "Desconectado", variant: "destructive" },
  hibernated: { label: "Hibernado", variant: "neutral" },
};

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const res = await p;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function WhatsAppView() {
  const queryClient = useQueryClient();
  const { data: state, isLoading, error } = useQuery({
    queryKey: ["admin", "instance"],
    queryFn: () => unwrap(getInstanceState(true)),
    // Durante o pareamento o QR muda: consulta a cada 5 s. Fora disso, a cada 30 s.
    refetchInterval: (q) => (q.state.data?.status === "connecting" ? 5_000 : 30_000),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "instance"] });

  if (isLoading) {
    return (
      <main className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </main>
    );
  }
  if (!state) {
    return <main className="px-6 py-10 text-sm text-destructive">{error instanceof Error ? error.message : "Não foi possível carregar."}</main>;
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <CredentialsCard state={state} onSaved={refresh} />
        {/* key: ao mudar o status, descarta QR/código antigos guardados localmente. */}
        <ConnectionCard key={state.status} state={state} onChanged={refresh} />
      </div>
      <EventsCard />
    </main>
  );
}

function Card({ title, icon: Icon, actions, children }: { title: string; icon: typeof Webhook; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" /> {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

function CredentialsCard({ state, onSaved }: { state: InstanceState; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState(state.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [pending, start] = useTransition();
  const [webhookPending, startWebhook] = useTransition();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveInstanceConfig({ baseUrl, token: token || undefined });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Instância salva e webhook configurado.");
      setToken("");
      onSaved();
    });
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(state.webhookUrl);
      toast.success("URL do webhook copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <Card title="Instância uazapi" icon={KeyRound}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="uaz-url">Server URL</Label>
          <Input id="uaz-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://suaempresa.uazapi.com" required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="uaz-token">Token da instância</Label>
          <Input
            id="uaz-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={state.tokenHint ? `Salvo (termina em ${state.tokenHint}). Preencha só para trocar.` : "Cole o token da instância"}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">Fica criptografado no banco e nunca é enviado ao navegador.</p>
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Salvar e testar
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <Webhook className="size-4 text-muted-foreground" /> Webhook
          </span>
          {state.webhookUrlMatches ? (
            <Badge variant="success">
              <CheckCircle2 /> Configurado {state.webhookConfiguredAt && formatRelative(state.webhookConfiguredAt)}
            </Badge>
          ) : (
            <Badge variant="warning">
              <AlertTriangle /> Não configurado
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <code className="flex-1 truncate rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-[11.5px] text-muted-foreground">
            {state.webhookUrl.replace(/secret=[^&]+/, "secret=••••••")}
          </code>
          <Button variant="outline" size="icon" onClick={copyWebhook} aria-label="Copiar URL do webhook">
            <Copy />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Eventos: mensagens, recibos de entrega, conexão e grupos. Em desenvolvimento, a uazapi só alcança o app por uma URL pública (túnel).
        </p>
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={!state.configured || webhookPending}
            onClick={() =>
              startWebhook(async () => {
                const res = await configureWebhook();
                if (!res.ok) return void toast.error(res.error);
                toast.success("Webhook configurado na uazapi.");
                onSaved();
              })
            }
          >
            {webhookPending ? <Loader2 className="animate-spin" /> : <Link2 />} Configurar webhook novamente
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ConnectionCard({ state, onChanged }: { state: InstanceState; onChanged: () => void }) {
  const [phone, setPhone] = useState("");
  // Códigos devolvidos pelo "Conectar"; o polling traz os atualizados enquanto conecta.
  const [started, setStarted] = useState<{ qrcode: string | null; paircode: string | null }>({ qrcode: null, paircode: null });
  const [pending, start] = useTransition();
  const meta = STATUS_META[state.status];
  const codes = { qrcode: state.qrcode ?? started.qrcode, paircode: state.paircode ?? started.paircode };

  const connect = (withPhone: boolean) =>
    start(async () => {
      const res = await connectInstance({ phone: withPhone ? phone : undefined });
      if (!res.ok) return void toast.error(res.error);
      setStarted(res.data);
      onChanged();
    });

  const disconnect = () =>
    start(async () => {
      const res = await disconnectInstance();
      if (!res.ok) return void toast.error(res.error);
      toast.success("Instância desconectada.");
      onChanged();
    });

  const qrSrc = codes.qrcode ? (codes.qrcode.startsWith("data:") ? codes.qrcode : `data:image/png;base64,${codes.qrcode}`) : null;

  return (
    <Card
      title="Conexão"
      icon={Smartphone}
      actions={
        <Badge variant={meta.variant} className="text-xs">
          {meta.label}
        </Badge>
      }
    >
      {!state.configured ? (
        <p className="text-sm text-muted-foreground">Salve a Server URL e o token da instância para conectar.</p>
      ) : state.status === "connected" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <Avatar name={state.profileName ?? "WhatsApp"} src={state.profilePicUrl} size="lg" />
            <div className="flex flex-col">
              <span className="font-semibold">{state.profileName ?? "Conta conectada"}</span>
              <span className="text-sm text-muted-foreground">{state.phone ? formatPhone(state.phone) : "Número não informado"}</span>
              {state.lastEventAt && <span className="text-xs text-muted-foreground">Último evento {formatRelative(state.lastEventAt)}</span>}
            </div>
          </div>
          <div>
            <Button variant="destructive-ghost" onClick={disconnect} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Unplug />} Desconectar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {state.lastDisconnectReason && state.status === "disconnected" && (
            <p className="rounded-md bg-destructive-soft px-3 py-2 text-xs text-destructive">Última desconexão: {state.lastDisconnectReason}</p>
          )}

          {qrSrc || codes.paircode ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start">
              {qrSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrSrc} alt="QR Code para conectar o WhatsApp" className="size-48 rounded-md bg-white p-2" />
              ) : (
                <span className="rounded-md border border-border bg-muted px-4 py-3 font-mono text-2xl font-semibold tracking-[0.25em]">
                  {codes.paircode}
                </span>
              )}
              <ol className="flex list-decimal flex-col gap-1 pl-4 text-sm text-muted-foreground">
                <li>Abra o WhatsApp no celular da conta.</li>
                <li>Toque em Aparelhos conectados → Conectar aparelho.</li>
                <li>{qrSrc ? "Aponte a câmera para o QR Code." : "Escolha conectar com número e digite o código."}</li>
                <li className="list-none pt-1 text-xs">Esta tela atualiza sozinha quando conectar.</li>
              </ol>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <Button onClick={() => connect(false)} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <QrCode />} {qrSrc ? "Gerar novo QR Code" : "Conectar com QR Code"}
            </Button>
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <Label htmlFor="pair-phone">Ou com código de pareamento</Label>
            <div className="flex gap-2">
              <Input id="pair-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5541999990000" inputMode="numeric" />
              <Button variant="outline" onClick={() => connect(true)} disabled={pending || phone.replace(/\D/g, "").length < 10}>
                <PlugZap /> Gerar código
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function EventsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "webhook-events"],
    queryFn: () => unwrap(listRecentEvents()),
    refetchInterval: 15_000,
  });
  const [pending, start] = useTransition();

  const reprocess = () =>
    start(async () => {
      const res = await reprocessFailedEvents();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data ? `${res.data} eventos enviados para reprocessar.` : "Nenhum evento com falha.");
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["admin", "webhook-events"] }), 3000);
    });

  return (
    <Card
      title="Eventos recebidos"
      icon={Webhook}
      actions={
        <div className="flex items-center gap-2">
          {!!data?.failed && <Badge variant="destructive">{data.failed} com falha</Badge>}
          <Button variant="outline" size="sm" onClick={reprocess} disabled={pending || !data?.failed}>
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Reprocessar falhas
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/logs?aba=eventos">Ver todos os logs</Link>
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : !data?.events.length ? (
        <p className="text-sm text-muted-foreground">Nenhum evento recebido ainda. Depois de conectar, envie uma mensagem num grupo para testar.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table data-table--compact">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                <th className="py-2 pr-4 font-semibold w-[30%]">Evento</th>
                <th className="py-2 pr-4 font-semibold w-[30%]">Recebido</th>
                <th className="py-2 font-semibold w-[40%]">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-b-0">
                  <td className="py-2 pr-4 font-mono text-xs">{e.event_type}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{formatRelative(e.received_at)}</td>
                  <td className={cn("py-2", e.error ? "text-destructive" : "text-muted-foreground")}>
                    {e.error ? `Falhou (${e.attempts}x): ${e.error}` : e.processed_at ? "Processado" : "Na fila"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
