"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileDown, Loader2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { sendReportNow } from "@/lib/reports/actions";
import { cn, formatPhone, formatRelative } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch, Tip } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ReportPerson {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  whatsapp: string | null;
}

export interface IssuedReportRow {
  id: number;
  created_at: string;
  trigger: "schedule" | "manual";
  deliveries: { name: string; ok: boolean; error?: string }[];
}

export interface ReportForm {
  reportEnabled: boolean;
  reportWeekday: number;
  reportHour: number;
  reportPeriodDays: number;
  reportRecipients: Record<string, { on: boolean; whatsapp: string }>;
}

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const PERIODS = [
  { value: 7, label: "Últimos 7 dias" },
  { value: 14, label: "Últimos 14 dias" },
  { value: 30, label: "Últimos 30 dias" },
];

export function ReportSettings({
  value,
  onChange,
  people,
  reports,
  dirty,
}: {
  value: ReportForm;
  onChange: (patch: Partial<ReportForm>) => void;
  people: ReportPerson[];
  reports: IssuedReportRow[];
  /** Há mudanças não salvas: o envio usa o que está salvo. */
  dirty: boolean;
}) {
  const router = useRouter();
  const [sending, start] = useTransition();
  const chosen = people.filter((p) => value.reportRecipients[p.id]?.on);

  const setPerson = (id: string, patch: Partial<{ on: boolean; whatsapp: string }>) =>
    onChange({ reportRecipients: { ...value.reportRecipients, [id]: { ...value.reportRecipients[id], ...patch } } });

  const send = () =>
    start(async () => {
      const res = await sendReportNow();
      if (!res.ok) return void toast.error(res.error);
      const ok = res.data.deliveries.filter((d) => d.ok).length;
      const failed = res.data.deliveries.filter((d) => !d.ok);
      if (ok) toast.success(`Relatório nº ${res.data.number} enviado para ${ok} ${ok === 1 ? "atendente" : "atendentes"}.`);
      if (failed.length) toast.error(`Não foi para ${failed.map((d) => `${d.name} (${d.error})`).join(", ")}.`);
      router.refresh();
    });

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Relatório das comunidades</h2>
          <p className="text-[13px] text-muted-foreground">
            Documento oficial em PDF, numerado, enviado pelo WhatsApp da comunidade para os atendentes escolhidos. Cada emissão fica registrada abaixo.
          </p>
        </div>
        <Switch id="report-enabled" checked={value.reportEnabled} onCheckedChange={(v) => onChange({ reportEnabled: v })} aria-label="Enviar o relatório automaticamente" />
      </div>

      <div className={cn("grid gap-4 sm:grid-cols-3", !value.reportEnabled && "opacity-60")}>
        <div className="flex flex-col gap-2">
          <Label>Dia do envio</Label>
          <Select value={String(value.reportWeekday)} onValueChange={(v) => onChange({ reportWeekday: Number(v) })} disabled={!value.reportEnabled}>
            <SelectTrigger aria-label="Dia do envio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((d, i) => (
                <SelectItem key={d} value={String(i)}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="report-hour">Horário (Brasília)</Label>
          <Select value={String(value.reportHour)} onValueChange={(v) => onChange({ reportHour: Number(v) })} disabled={!value.reportEnabled}>
            <SelectTrigger id="report-hour" aria-label="Horário do envio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>
                  {String(h).padStart(2, "0")}:00
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Período do relatório</Label>
          <Select value={String(value.reportPeriodDays)} onValueChange={(v) => onChange({ reportPeriodDays: Number(v) })}>
            <SelectTrigger aria-label="Período do relatório">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Quem recebe</Label>
        <p className="text-xs text-muted-foreground">Marque os atendentes e informe o WhatsApp de cada um (com DDD).</p>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {people.map((p) => {
            const r = value.reportRecipients[p.id] ?? { on: false, whatsapp: "" };
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={r.on}
                  onChange={(e) => setPerson(p.id, { on: e.target.checked })}
                  aria-label={`${p.name} recebe o relatório`}
                />
                <Avatar name={p.name} src={p.avatar_url} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{p.email}</span>
                </span>
                <Input
                  type="tel"
                  inputMode="numeric"
                  placeholder="(11) 98765-4321"
                  value={r.whatsapp}
                  onChange={(e) => setPerson(p.id, { whatsapp: e.target.value })}
                  aria-label={`WhatsApp de ${p.name}`}
                  aria-invalid={r.on && r.whatsapp.replace(/\D/g, "").length < 10}
                  className="h-8 w-44"
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {dirty ? "Salve as configurações antes de enviar: o envio usa o que está salvo." : `${chosen.length} ${chosen.length === 1 ? "atendente recebe" : "atendentes recebem"}.`}
        </span>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/reports/pdf?dias=${value.reportPeriodDays}`} target="_blank" rel="noopener">
            <FileDown /> Ver prévia do PDF
          </a>
        </Button>
        <Button type="button" size="sm" onClick={send} disabled={sending || dirty || !chosen.length}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />} Emitir e enviar agora
        </Button>
      </div>

      {reports.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Últimas emissões</Label>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {reports.map((r) => {
              const ok = r.deliveries.filter((d) => d.ok);
              const failed = r.deliveries.filter((d) => !d.ok);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="font-mono font-medium">nº {String(r.id).padStart(4, "0")}</span>
                  <span className="text-muted-foreground">
                    {formatRelative(r.created_at)} · {r.trigger === "schedule" ? "automático" : "manual"}
                  </span>
                  <span className="flex items-center gap-1 text-success">
                    <CheckCircle2 className="size-3.5" /> {ok.length}
                  </span>
                  {failed.length > 0 && (
                    <Tip label={failed.map((d) => `${d.name}: ${d.error}`).join(" · ")}>
                      <span className="flex items-center gap-1 text-destructive">
                        <XCircle className="size-3.5" /> {failed.length}
                      </span>
                    </Tip>
                  )}
                  <a href={`/api/reports/pdf?id=${r.id}`} target="_blank" rel="noopener" className="ml-auto text-primary underline-offset-4 hover:underline">
                    Baixar PDF
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** WhatsApp salvo (55DDD…) para mostrar no campo. */
export const whatsappInput = (digits: string | null) => (digits ? formatPhone(digits) : "");
