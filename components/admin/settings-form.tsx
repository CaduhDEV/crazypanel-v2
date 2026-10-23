"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateSettings } from "@/lib/admin/settings";
import type { AppSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { PushSettings } from "@/components/admin/push-settings";
import { ReportSettings, whatsappInput, type IssuedReportRow, type ReportPerson } from "@/components/admin/report-settings";

export function SettingsForm({
  settings,
  people,
  reports,
  children,
}: {
  settings: AppSettings;
  people: ReportPerson[];
  reports: IssuedReportRow[];
  /** Seções que salvam sozinhas (ex.: categorias): ficam na mesma grade, fora do formulário. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const initial = useMemo(() => ({
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
    joinMsgNoCompany: settings.join_msg_no_company,
    joinMsgRejected: settings.join_msg_rejected,
    joinMsgAccepted: settings.join_msg_accepted,
    memberReplyWindowMinutes: settings.member_reply_window_minutes,
    reportEnabled: settings.report_enabled,
    reportWeekday: settings.report_weekday,
    reportHour: settings.report_hour,
    reportPeriodDays: settings.report_period_days,
    reportRecipients: Object.fromEntries(
      people.map((p) => [p.id, { on: settings.report_recipients.includes(p.id), whatsapp: whatsappInput(p.whatsapp) }]),
    ) as Record<string, { on: boolean; whatsapp: string }>,
  }), [settings, people]);
  const [form, setForm] = useState(initial);
  const reportDirty =
    JSON.stringify([initial.reportEnabled, initial.reportWeekday, initial.reportHour, initial.reportPeriodDays, initial.reportRecipients]) !==
    JSON.stringify([form.reportEnabled, form.reportWeekday, form.reportHour, form.reportPeriodDays, form.reportRecipients]);
  const [pending, start] = useTransition();

  const num = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Number(e.target.value) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await updateSettings({
        ...form,
        reportRecipients: Object.entries(form.reportRecipients).map(([id, r]) => ({ id, enabled: r.on, whatsapp: r.whatsapp })),
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Configurações salvas. Os atendentes veem as novas regras ao recarregar a página.");
      router.refresh();
    });
  };

  const warnAt = Math.round((form.slaMinutes * form.warningPercent) / 100 * 10) / 10;

  return (
    <main className="flex-1 px-4 pt-5 sm:px-6">
      {/* Uma grade só: as seções do formulário e as que salvam sozinhas ficam alinhadas.
          O formulário usa "contents" para os grupos dele entrarem direto na grade. */}
      <div className="grid max-w-5xl grid-cols-1 gap-6 lg:grid-cols-2">
      <form id="settings-form" onSubmit={submit} className="contents">
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
          <Field
            id="member-reply"
            label="Resposta de membro sem citação (minutos)"
            hint="Quem escreve logo depois da dúvida de outra pessoa, sem citar, aparece como possível resposta nessa dúvida. 0 desliga."
          >
            <Input id="member-reply" type="number" min={0} max={240} value={form.memberReplyWindowMinutes} onChange={num("memberReplyWindowMinutes")} className="w-32" />
          </Field>
        </Group>

        <PushSettings value={form} onChange={(patch) => setForm({ ...form, ...patch })} />

        <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Mensagens de entrada na comunidade</h2>
            <p className="text-[13px] text-muted-foreground">
              Enviadas no privado de quem pede para entrar. Variáveis: <span className="font-mono">{"{nome}"}</span>,{" "}
              <span className="font-mono">{"{grupo}"}</span> e <span className="font-mono">{"{email}"}</span>.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <JoinMessage id="msg-no-company" label="Empresa não encontrada" hint="Só para quem veio do formulário." value={form.joinMsgNoCompany} onChange={(v) => setForm({ ...form, joinMsgNoCompany: v })} />
            <JoinMessage id="msg-rejected" label="Pedido recusado" hint="Ao recusar no painel." value={form.joinMsgRejected} onChange={(v) => setForm({ ...form, joinMsgRejected: v })} />
            <JoinMessage id="msg-accepted" label="Pedido aceito" hint="Ao entrar no grupo; {grupo} vira o nome dele." value={form.joinMsgAccepted} onChange={(v) => setForm({ ...form, joinMsgAccepted: v })} />
          </div>
        </section>

        <ReportSettings value={form} onChange={(patch) => setForm({ ...form, ...patch })} people={people} reports={reports} dirty={reportDirty} />
      </form>

      {children}
      </div>

      {/* Sempre à vista no fim da tela: vale para as seções do formulário (as categorias salvam na hora). */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex max-w-5xl items-center justify-end gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">As categorias salvam na hora; o resto, neste botão.</span>
          <Button type="submit" form="settings-form" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Salvar configurações
          </Button>
        </div>
      </div>
    </main>
  );
}

function JoinMessage({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={5} maxLength={1000} value={value} onChange={(e) => onChange(e.target.value)} className="text-[13px]" />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
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
