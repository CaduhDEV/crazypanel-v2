"use client";

import { useState, useTransition } from "react";
import { Bot, Check, Copy, Loader2, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { runAiModerationNow, updateModerationSettings } from "@/lib/moderation/actions";
import { MODERATION_PROMPT } from "@/lib/ai/moderation-prompt";
import { cn, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { useApp } from "@/components/app/app-context";

export interface AiModerationRequestRow {
  id: string;
  status: "sent" | "done" | "rejected" | "failed";
  sent_at: string;
  message_ids: string[];
  flagged: number;
  error: string | null;
}

const STATUS_TEXT: Record<AiModerationRequestRow["status"], string> = {
  sent: "Aguardando a IA",
  done: "Lido pela IA",
  rejected: "Retorno recusado",
  failed: "Falhou",
};

// Moderação: regras da comunidade, limite de flags, mensagens no privado e a
// moderação por IA. Mensagem vazia = desligada (a uazapi nem tenta enviar).
export function ModerationSettings({ configured, callbackUrl, requests }: { configured: boolean; callbackUrl: string; requests: AiModerationRequestRow[] }) {
  const { settings } = useApp();
  const initial = {
    limit: settings.mod_strike_limit,
    warning: settings.mod_msg_warning,
    removed: settings.mod_msg_removed,
    rules: settings.community_rules,
    aiEnabled: settings.ai_moderation_enabled,
    confidence: Math.round(settings.ai_moderation_min_confidence * 100),
    aiWarn: settings.ai_moderation_warn,
  };
  const [form, setForm] = useState(initial);
  const [pending, start] = useTransition();
  const [sending, startSend] = useTransition();
  const [copied, setCopied] = useState<"prompt" | "url" | null>(null);
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);

  function save() {
    start(async () => {
      const res = await updateModerationSettings({
        limit: form.limit,
        warning: form.warning,
        removed: form.removed,
        rules: form.rules,
        aiEnabled: form.aiEnabled,
        aiMinConfidence: Math.min(100, Math.max(0, form.confidence)) / 100,
        aiWarn: form.aiWarn,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Moderação salva.");
    });
  }

  const sendNow = () =>
    startSend(async () => {
      const res = await runAiModerationNow();
      if (!res.ok) return void toast.error(res.error);
      const { messages, failed } = res.data;
      if (failed) toast.error(`${failed} ${failed === 1 ? "envio falhou" : "envios falharam"}.`);
      toast.success(messages ? `${messages} ${messages === 1 ? "mensagem enviada" : "mensagens enviadas"} para a IA.` : "Nenhuma mensagem nova para moderar.");
    });

  const copy = async (what: "prompt" | "url") => {
    try {
      await navigator.clipboard.writeText(what === "prompt" ? MODERATION_PROMPT : callbackUrl);
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
            <ShieldAlert className="size-4 text-destructive" /> Moderação
          </h2>
          <p className="max-w-2xl text-[13px] text-muted-foreground">
            Regras da comunidade e mensagens no privado de quem as viola. Variáveis: <span className="font-mono">{"{nome}"}</span>,{" "}
            <span className="font-mono">{"{motivo}"}</span>, <span className="font-mono">{"{flags}"}</span>, <span className="font-mono">{"{limite}"}</span> e{" "}
            <span className="font-mono">{"{grupo}"}</span>. Deixe uma mensagem vazia para não enviar (vale também para as mensagens de entrada).
          </p>
        </div>
        <Button type="button" onClick={save} disabled={pending || !dirty}>
          {pending && <Loader2 className="animate-spin" />} Salvar moderação
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="mod-rules">Regras da comunidade</Label>
          <Textarea id="mod-rules" rows={6} maxLength={3000} value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} className="text-[13px]" />
          <p className="text-xs text-muted-foreground">Uma regra por linha. A IA dá flag em toda mensagem que cair numa delas.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="mod-limit">Flags para ficar inapto</Label>
          <Input
            id="mod-limit"
            type="number"
            min={1}
            max={10}
            value={form.limit}
            onChange={(e) => setForm({ ...form, limit: Number(e.target.value) || 1 })}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">Com esse número de flags, o lead aparece em vermelho em Leads e na Moderação.</p>
        </div>
        <Template id="mod-warning" label="Advertência" hint="Ao advertir (+1 flag)." value={form.warning} onChange={(v) => setForm({ ...form, warning: v })} />
        <Template id="mod-removed" label="Removido da comunidade" hint="Antes de tirar o lead dos grupos." value={form.removed} onChange={(v) => setForm({ ...form, removed: v })} />
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold">
              <Bot className="size-4 text-primary" /> Moderação por IA
            </h3>
            <p className="max-w-2xl text-xs text-muted-foreground">
              A cada 2 minutos, as mensagens novas dos leads vão para o agente de moderação do CRM. Cada violação vira uma flag na mensagem,
              marcada como &ldquo;Moderado por IA&rdquo;; se a IA errar, retire a flag na Moderação.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={sendNow} disabled={sending || !configured}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />} Moderar agora
          </Button>
        </div>

        {!configured && (
          <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
            Falta configurar <span className="font-mono">AI_MODERATION_WEBHOOK_URL</span> (webhook do agente de moderação) e{" "}
            <span className="font-mono">AI_WEBHOOK_SECRET</span> nas variáveis do painel.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">Moderar automaticamente</span>
              <span className="text-xs text-muted-foreground">A IA lê as mensagens novas e dá flag.</span>
            </span>
            <Switch checked={form.aiEnabled} onCheckedChange={(v) => setForm({ ...form, aiEnabled: v })} />
          </label>
          <label className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">Advertir no privado</span>
              <span className="text-xs text-muted-foreground">Manda a advertência quando a IA dá a flag.</span>
            </span>
            <Switch checked={form.aiWarn} onCheckedChange={(v) => setForm({ ...form, aiWarn: v })} />
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mod-conf">Confiança mínima (%)</Label>
            <Input id="mod-conf" type="number" min={0} max={100} value={form.confidence} onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })} className="w-32" />
            <p className="text-xs text-muted-foreground">Abaixo disso a IA não dá flag.</p>
          </div>
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
                        {r.message_ids.length} {r.message_ids.length === 1 ? "mensagem" : "mensagens"} · {STATUS_TEXT[r.status]}
                        {r.status === "done" && (r.flagged ? ` · ${r.flagged} ${r.flagged === 1 ? "flag" : "flags"}` : " · nada violou as regras")}
                      </span>
                      {r.error && <span className="truncate text-muted-foreground">{r.error}</span>}
                    </span>
                    <span className={cn("shrink-0 text-muted-foreground", (r.status === "failed" || r.status === "rejected") && "text-destructive")}>{formatRelative(r.sent_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum envio ainda.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">Prompt do agente de moderação</span>
              <Button type="button" variant="outline" size="sm" onClick={() => copy("prompt")}>
                {copied === "prompt" ? <Check /> : <Copy />} Copiar prompt
              </Button>
            </div>
            <pre className="scroll-thin max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-[11.5px] leading-relaxed">{MODERATION_PROMPT}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function Template({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={5} maxLength={1000} value={value} onChange={(e) => onChange(e.target.value)} className="text-[13px]" />
      <p className="text-xs text-muted-foreground">{value.trim() ? hint : "Desligada: não será enviada."}</p>
    </div>
  );
}
