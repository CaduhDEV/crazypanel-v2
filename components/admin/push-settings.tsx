"use client";

import { useRef } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import {
  fillTemplate,
  PUSH_VARIABLES,
  showBrowserNotification,
  usePushPermission,
  type PushVars,
} from "@/components/app/browser-notifications";

export interface PushForm {
  pushEnabled: boolean;
  pushSound: boolean;
  pushNewTitle: string;
  pushNewBody: string;
  pushBreachTitle: string;
  pushBreachBody: string;
}

// Exemplo usado na prévia e no teste.
const SAMPLE: PushVars = { lead: "Maria Souza", empresa: "Loja Exemplo", grupo: "#1 Comunidade CRM", mensagem: "Não consigo conectar o WhatsApp", numero: 128 };

const PERMISSION_TEXT = {
  granted: "Permitidas neste navegador.",
  denied: "Bloqueadas neste navegador. Libere no cadeado da barra de endereço.",
  default: "Este navegador ainda não permitiu.",
  unsupported: "Este navegador não suporta notificações (ou o site não está em https).",
} as const;

/** Seção "Notificações do navegador" das configurações (ocupa as duas colunas). */
export function PushSettings({ value, onChange }: { value: PushForm; onChange: (patch: Partial<PushForm>) => void }) {
  const [permission, request] = usePushPermission();

  const test = async () => {
    let p = permission;
    if (p === "default") p = await request();
    if (p !== "granted") return void toast.error(PERMISSION_TEXT[p === "default" ? "default" : p]);
    const ok = showBrowserNotification({
      title: fillTemplate(value.pushNewTitle, SAMPLE),
      body: fillTemplate(value.pushNewBody, SAMPLE),
      tag: `teste-${Date.now()}`, // tag nova: cada teste aparece (a mesma tag substitui em silêncio)
    });
    if (ok) toast.success("Notificação de teste enviada.");
    else toast.error("O navegador não mostrou a notificação.");
  };

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Notificações do navegador</h2>
          <p className="text-[13px] text-muted-foreground">
            Avisos para a equipe quando o painel está em outra aba ou minimizado. Cada pessoa precisa permitir no próprio navegador.
          </p>
          <p className="text-xs text-muted-foreground">{PERMISSION_TEXT[permission]}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={test}>
          <BellRing /> Testar neste navegador
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          id="push-enabled"
          label="Enviar notificações"
          hint="Atendimento novo na fila e SLA estourado."
          checked={value.pushEnabled}
          onChange={(v) => onChange({ pushEnabled: v })}
        />
        <Toggle
          id="push-sound"
          label="Tocar som"
          hint="Junto com o aviso. Cada pessoa ainda pode silenciar no menu dela."
          checked={value.pushSound}
          onChange={(v) => onChange({ pushSound: v })}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <MessageFields
          title="Atendimento novo"
          titleValue={value.pushNewTitle}
          bodyValue={value.pushNewBody}
          onTitle={(v) => onChange({ pushNewTitle: v })}
          onBody={(v) => onChange({ pushNewBody: v })}
          disabled={!value.pushEnabled}
          idPrefix="push-new"
        />
        <MessageFields
          title="SLA estourado"
          titleValue={value.pushBreachTitle}
          bodyValue={value.pushBreachBody}
          onTitle={(v) => onChange({ pushBreachTitle: v })}
          onBody={(v) => onChange({ pushBreachBody: v })}
          disabled={!value.pushEnabled}
          idPrefix="push-breach"
        />
      </div>
    </section>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function MessageFields({
  title,
  titleValue,
  bodyValue,
  onTitle,
  onBody,
  disabled,
  idPrefix,
}: {
  title: string;
  titleValue: string;
  bodyValue: string;
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  disabled: boolean;
  idPrefix: string;
}) {
  // Último campo focado recebe a variável clicada.
  const lastFocused = useRef<"title" | "body">("body");
  const insert = (variable: string) => {
    const token = `{${variable}}`;
    if (lastFocused.current === "title") onTitle(`${titleValue}${titleValue.endsWith(" ") || !titleValue ? "" : " "}${token}`);
    else onBody(`${bodyValue}${bodyValue.endsWith(" ") || !bodyValue ? "" : " "}${token}`);
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-[13px] font-medium">{title}</h3>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-title`}>Título</Label>
        <Input
          id={`${idPrefix}-title`}
          value={titleValue}
          maxLength={120}
          disabled={disabled}
          onFocus={() => (lastFocused.current = "title")}
          onChange={(e) => onTitle(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-body`}>Texto</Label>
        <Input
          id={`${idPrefix}-body`}
          value={bodyValue}
          maxLength={300}
          disabled={disabled}
          onFocus={() => (lastFocused.current = "body")}
          onChange={(e) => onBody(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Variáveis:</span>
        {PUSH_VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => insert(v)}
            className="rounded border border-border bg-muted/50 px-1.5 py-px font-mono text-[11px] hover:bg-accent disabled:opacity-50"
          >
            {`{${v}}`}
          </button>
        ))}
      </div>
      {/* Prévia com dados de exemplo */}
      <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-white">
          <BellRing className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold">{fillTemplate(titleValue, SAMPLE) || "—"}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{fillTemplate(bodyValue, SAMPLE) || "—"}</span>
        </div>
      </div>
    </div>
  );
}
