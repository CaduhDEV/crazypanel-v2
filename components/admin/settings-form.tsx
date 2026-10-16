"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateSettings } from "@/lib/admin/settings";
import type { AppSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { PushSettings } from "@/components/admin/push-settings";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const [form, setForm] = useState({
    slaMinutes: Math.round(settings.sla_seconds / 60),
    warningPercent: settings.sla_warning_percent,
    signMessages: settings.sign_messages,
    typingDelayMs: settings.typing_delay_ms,
    reopenWindowHours: settings.reopen_window_hours,
    joinWindowMinutes: settings.join_window_minutes ?? 30,
    burstWindowSeconds: settings.burst_window_seconds,
    pushEnabled: settings.push_enabled,
    pushSound: settings.push_sound,
    pushNewTitle: settings.push_new_title,
    pushNewBody: settings.push_new_body,
    pushBreachTitle: settings.push_breach_title,
    pushBreachBody: settings.push_breach_body,
  });
  const [pending, start] = useTransition();

  const num = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Number(e.target.value) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await updateSettings(form);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Configurações salvas. Os atendentes veem as novas regras ao recarregar a página.");
      router.refresh();
    });
  };

  const warnAt = Math.round((form.slaMinutes * form.warningPercent) / 100 * 10) / 10;

  return (
    <main className="flex-1 px-4 py-5 sm:px-6">
      <form onSubmit={submit} className="grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-2">
        <Group title="SLA de resposta" description="Tempo entre a mensagem do lead e a primeira resposta da equipe.">
          <Field id="sla" label="Prazo (minutos)" hint="Depois disso o atendimento aparece como estourado.">
            <Input id="sla" type="number" min={1} max={1440} value={form.slaMinutes} onChange={num("slaMinutes")} className="w-32" />
          </Field>
          <Field id="warn" label="Alerta em (% do prazo)" hint={`Fica amarelo a partir de ${warnAt} min.`}>
            <Input id="warn" type="number" min={10} max={95} value={form.warningPercent} onChange={num("warningPercent")} className="w-32" />
          </Field>
        </Group>

        <Group title="Mensagens enviadas" description="Como as respostas aparecem no grupo.">
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1">
              <Label htmlFor="sign">Assinar com o nome do atendente</Label>
              <p className="text-xs text-muted-foreground">
                A mensagem sai como <span className="font-mono">*Nome:*</span> seguido do texto.
              </p>
            </div>
            <Switch id="sign" checked={form.signMessages} onCheckedChange={(v) => setForm({ ...form, signMessages: v })} />
          </div>
          <Field id="typing" label="“Digitando…” antes de enviar (ms)" hint="0 envia na hora. Até 10.000.">
            <Input id="typing" type="number" min={0} max={10000} step={100} value={form.typingDelayMs} onChange={num("typingDelayMs")} className="w-32" />
          </Field>
        </Group>

        <Group title="Reabertura" description="Quando o lead responde (citando) um atendimento já finalizado.">
          <Field id="reopen" label="Reabrir até (horas após finalizar)" hint="0 nunca reabre: a resposta abre um atendimento novo.">
            <Input id="reopen" type="number" min={0} max={720} value={form.reopenWindowHours} onChange={num("reopenWindowHours")} className="w-32" />
          </Field>
        </Group>

        <Group
          title="Mensagens de outros leads durante um atendimento"
          description="Enquanto alguém atende no grupo, a mensagem de outro lead aparece como sugestão no atendimento em andamento; o atendente decide se junta. Quem cita uma mensagem do atendimento entra na hora."
        >
          <Field
            id="join"
            label="Sugerir como contexto por (minutos)"
            hint="Vale se o atendimento foi respondido e teve atividade nesse intervalo. 0 desliga as sugestões (citar ainda junta na hora)."
          >
            <Input id="join" type="number" min={0} max={1440} value={form.joinWindowMinutes} onChange={num("joinWindowMinutes")} className="w-32" />
          </Field>
          <Field
            id="burst"
            label="Rajada de mensagens (segundos)"
            hint="Mensagens da mesma pessoa com até esse intervalo são continuação. Depois disso, se a equipe já respondeu, o painel pergunta se a mensagem é do mesmo assunto. 0 sempre pergunta."
          >
            <Input id="burst" type="number" min={0} max={3600} step={30} value={form.burstWindowSeconds} onChange={num("burstWindowSeconds")} className="w-32" />
          </Field>
        </Group>

        <PushSettings value={form} onChange={(patch) => setForm({ ...form, ...patch })} />

        <div className="flex justify-end lg:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Salvar configurações
          </Button>
        </div>
      </form>
    </main>
  );
}

function Group({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
