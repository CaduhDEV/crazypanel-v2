"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DatabaseZap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { crmPendingCount, scanCrmBatch, type CrmScanResult } from "@/lib/crm-actions";
import { pluralize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Totals = Omit<CrmScanResult, "remaining">;
const EMPTY: Totals = { processed: 0, found: 0, notFound: 0, failed: 0 };

/** Busca cada lead (pelo telefone) no CRM DataCrazy: CNPJ, responsável e último contato. */
export function CrmScanDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [configured, setConfigured] = useState(true);
  const [retry, setRetry] = useState(false);
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const stopRef = useRef(false);

  const onOpenChange = async (next: boolean) => {
    if (!next && running) return;
    setOpen(next);
    if (!next) return;
    setTotals(null);
    setRemaining(null);
    const res = await crmPendingCount();
    if (res.ok) {
      setPending(res.data.pending);
      setConfigured(res.data.configured);
    }
  };

  const run = async () => {
    stopRef.current = false;
    setRunning(true);
    const acc = { ...EMPTY };
    setTotals(acc);
    const since = new Date().toISOString();
    try {
      for (;;) {
        const res = await scanCrmBatch({ retry, since });
        if (!res.ok) {
          toast.error(res.error);
          break;
        }
        for (const k of Object.keys(EMPTY) as (keyof Totals)[]) acc[k] += res.data[k];
        setTotals({ ...acc });
        setRemaining(res.data.remaining);
        if (res.data.remaining === 0 || res.data.processed + res.data.failed === 0 || stopRef.current) break;
      }
    } finally {
      setRunning(false);
      if (acc.found) {
        toast.success(`${pluralize(acc.found, "lead encontrado", "leads encontrados")} no CRM.`);
        router.refresh();
      }
      const res = await crmPendingCount();
      if (res.ok) setPending(res.data.pending);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => onOpenChange(true)}>
        <DatabaseZap /> Buscar no CRM
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Buscar leads no CRM DataCrazy</DialogTitle>
            <DialogDescription>
              Procura cada telefone no CRM (Pós Vendas). Quando acha, salva o CNPJ (ou CPF), o responsável e o último
              contato pelo WhatsApp do CRM. O CNPJ também vai para a empresa vinculada, se ela ainda não tiver.
            </DialogDescription>
          </DialogHeader>

          {!configured ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              Defina <code>DATACRAZY_API_URL</code> e <code>DATACRAZY_API_KEY</code> no <code>.env.local</code> e reinicie o servidor.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {pending === null ? "Contando…" : `${pluralize(pending, "lead nunca consultado", "leads nunca consultados")}.`}
              </p>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Consultar de novo quem já foi consultado
                  <span className="block text-xs text-muted-foreground">Atualiza responsável e último contato, e acha quem entrou no CRM depois.</span>
                </span>
                <Switch checked={retry} onCheckedChange={setRetry} disabled={running} />
              </label>

              {totals && (
                <dl className="grid grid-cols-3 gap-2 text-sm tabular">
                  <Stat label="Encontrados" value={totals.found} />
                  <Stat label="Fora do CRM" value={totals.notFound} />
                  <Stat label="Falhas" value={totals.failed} />
                </dl>
              )}
              {running && remaining !== null && <p className="text-xs text-muted-foreground">Faltam {remaining}…</p>}
            </div>
          )}

          <DialogFooter>
            {running ? (
              <Button variant="outline" onClick={() => (stopRef.current = true)}>
                <Loader2 className="animate-spin" /> Parar
              </Button>
            ) : (
              <Button onClick={run} disabled={!configured || (!retry && pending === 0)}>
                <DatabaseZap /> {totals ? "Buscar de novo" : "Iniciar busca"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-2.5 py-1.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold">{value}</dd>
    </div>
  );
}
