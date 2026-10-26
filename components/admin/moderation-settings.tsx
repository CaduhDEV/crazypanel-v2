"use client";

import { useState, useTransition } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { updateModerationSettings } from "@/lib/moderation/actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { useApp } from "@/components/app/app-context";

// Moderação: limite de flags para ficar inapto e as mensagens no privado.
// Mensagem vazia = desligada (a uazapi nem tenta enviar). Salva na hora.
export function ModerationSettings() {
  const { settings } = useApp();
  const [limit, setLimit] = useState(settings.mod_strike_limit);
  const [warning, setWarning] = useState(settings.mod_msg_warning);
  const [removed, setRemoved] = useState(settings.mod_msg_removed);
  const [pending, start] = useTransition();
  const dirty = limit !== settings.mod_strike_limit || warning !== settings.mod_msg_warning || removed !== settings.mod_msg_removed;

  function save() {
    start(async () => {
      const res = await updateModerationSettings({ limit, warning, removed });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Moderação salva.");
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="size-4 text-destructive" /> Moderação
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Mensagens no privado de quem viola as diretrizes. Variáveis: <span className="font-mono">{"{nome}"}</span>,{" "}
            <span className="font-mono">{"{motivo}"}</span>, <span className="font-mono">{"{flags}"}</span>, <span className="font-mono">{"{limite}"}</span> e{" "}
            <span className="font-mono">{"{grupo}"}</span>. Deixe uma mensagem vazia para não enviar (vale também para as mensagens de entrada).
          </p>
        </div>
        <Button type="button" onClick={save} disabled={pending || !dirty}>
          {pending && <Loader2 className="animate-spin" />} Salvar moderação
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="mod-limit">Flags para ficar inapto</Label>
        <Input id="mod-limit" type="number" min={1} max={10} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 1)} className="w-32" />
        <p className="text-xs text-muted-foreground">Com esse número de flags, o lead aparece em vermelho em Leads e na Moderação.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Template id="mod-warning" label="Advertência" hint="Ao advertir (+1 flag)." value={warning} onChange={setWarning} />
        <Template id="mod-removed" label="Removido da comunidade" hint="Antes de tirar o lead dos grupos." value={removed} onChange={setRemoved} />
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
