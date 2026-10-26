"use client";

import { useState, useTransition } from "react";
import { Bot, Check, Copy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { sendIdleTicketsToAi, updateAiSettings } from "@/lib/admin/ai";
import { AGENT_PROMPT } from "@/lib/ai/agent-prompt";
import { cn, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { useApp } from "@/components/app/app-context";

export interface AiRequestRow {
  id: string;
  status: "sent" | "done" | "rejected" | "failed";
  outcome: "closed" | "suggested" | null;
  sent_at: string;
  error: string | null;
  ticket: { number: number } | null;
}

const STATUS_TEXT: Record<AiRequestRow["status"], string> = {
  sent: "Aguardando o agente",
  done: "Classificado",
  rejected: "Resposta recusada",
  failed: "Falhou ao enviar",
};

/**
 * Agente de IA do CRM: classifica os atendimentos parados e, quando é seguro,
 * encerra. Salva sozinho (fora do botão "Salvar configurações").
 */
export function AiSettings({ configured, callbackUrl, requests }: { configured: boolean; callbackUrl: string; requests: AiRequestRow[] }) {
  const { settings } = useApp();
  const [form, setForm] = useState({
    enabled: settings.ai_enabled,
    autoClose: settings.ai_auto_close,
    confidence: Math.round(settings.ai_min_confidence * 100),
    idle: settings.ai_idle_minutes,
  });
  const [saving, startSave] = useTransition();
  const [sending, startSend] = useTransition();
  const [copied, setCopied] = useState<"prompt" | "url" | null>(null);

  const save = () =>
    startSave(async () => {
      const res = await updateAiSettings({ enabled: form.enabled, autoClose: form.autoClose, minConfidence: form.confidence / 100, idleMinutes: form.idle });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Agente de IA salvo.");
    });

  const sendNow = () =>
    startSend(async () => {
      const res = await sendIdleTicketsToAi();
      if (!res.ok) return void toast.error(res.error);
      const { sent, failed } = res.data;
      if (!sent && !failed) return void toast.message("Nenhum atendimento parado para enviar agora.");
      toast.success(`${sent} enviado(s) ao agente${failed ? `, ${failed} com falha` : ""}.`);
    });

  const copy = async (what: "prompt" | "url") => {
    try {
      await navigator.clipboard.writeText(what === "prompt" ? AGENT_PROMPT : callbackUrl);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="size-4 text-primary" /> Agente de IA
          </h2>
          <p className="max-w-2xl text-[13px] text-muted-foreground">
            O painel manda os atendimentos sem responsável e parados para o agente do CRM DataCrazy. O agente devolve a categoria, quem
            resolveu e se precisa da equipe. Quando não precisa e a confiança passa do mínimo, o atendimento é encerrado como
            &ldquo;Encerrado pela IA&rdquo;; senão, fica aberto com a sugestão pronta no Finalizar.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={sendNow} disabled={sending || !configured}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />} Enviar agora
        </Button>
      </div>

      {!configured && (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          Falta configurar <span className="font-mono">AI_AGENT_WEBHOOK_URL</span> (webhook do agente) e{" "}
          <span className="font-mono">AI_WEBHOOK_SECRET</span> (segredo do retorno) nas variáveis do painel.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium">Enviar automaticamente</span>
            <span className="text-xs text-muted-foreground">A cada 30 minutos, os atendimentos parados vão para o agente.</span>
          </span>
          <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
        </label>
        <label className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium">Encerrar automaticamente</span>
            <span className="text-xs text-muted-foreground">Desligado, a IA só deixa a sugestão no atendimento.</span>
          </span>
          <Switch checked={form.autoClose} onCheckedChange={(v) => setForm({ ...form, autoClose: v })} />
        </label>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-idle">Parado há (minutos)</Label>
          <Input id="ai-idle" type="number" min={5} max={1440} value={form.idle} onChange={(e) => setForm({ ...form, idle: Number(e.target.value) })} className="w-32" />
          <p className="text-xs text-muted-foreground">Só vai para a IA o atendimento sem mensagem nova há esse tempo.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-conf">Confiança mínima para encerrar (%)</Label>
          <Input id="ai-conf" type="number" min={0} max={100} value={form.confidence} onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })} className="w-32" />
          <p className="text-xs text-muted-foreground">Abaixo disso a IA só sugere. Também não encerra se o lead mandou mensagem depois do envio.</p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Salvar agente de IA
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Retorno do agente (callback)</span>
          <p className="text-xs text-muted-foreground">Vai em cada envio, no campo callback_url. Se o agente pedir um endereço fixo, use este.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-2 py-1.5 text-[11.5px]">{callbackUrl.replace(/key=.*/, "key=••••••")}</code>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => copy("url")} aria-label="Copiar endereço de retorno" disabled={!configured}>
              {copied === "url" ? <Check /> : <Copy />}
            </Button>
          </div>
          <span className="pt-2 text-[13px] font-medium">Últimos envios</span>
          {requests.length ? (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">
                      #{r.ticket?.number ?? "—"} · {r.status === "done" ? (r.outcome === "closed" ? "Encerrado pela IA" : "Sugestão no atendimento") : STATUS_TEXT[r.status]}
                    </span>
                    {r.error && <span className="truncate text-muted-foreground">{r.error}</span>}
                  </span>
                  <span className={cn("shrink-0 text-muted-foreground", r.status === "failed" || r.status === "rejected" ? "text-destructive" : "")}>
                    {formatRelative(r.sent_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum envio ainda.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium">Prompt do agente</span>
            <Button type="button" variant="outline" size="sm" onClick={() => copy("prompt")}>
              {copied === "prompt" ? <Check /> : <Copy />} Copiar prompt
            </Button>
          </div>
          <pre className="scroll-thin max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-[11.5px] leading-relaxed">{AGENT_PROMPT}</pre>
        </div>
      </div>
    </section>
  );
}
