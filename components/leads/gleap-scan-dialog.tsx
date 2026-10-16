"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { gleapPendingCount, scanGleapBatch, type GleapScanResult } from "@/lib/admin/gleap";
import { pluralize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Totals = Omit<GleapScanResult, "remaining">;
const EMPTY: Totals = { processed: 0, linked: 0, ambiguous: 0, notFound: 0, failed: 0 };

/** Varre o Gleap pelos telefones dos leads sem empresa e vincula e-mail + tenant. */
export function GleapScanDialog() {
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
    if (!next && running) return; // fecha só depois de parar
    setOpen(next);
    if (!next) return;
    setTotals(null);
    setRemaining(null);
    const res = await gleapPendingCount();
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
        const res = await scanGleapBatch({ retry, since });
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
      if (acc.linked) {
        toast.success(`${pluralize(acc.linked, "lead vinculado", "leads vinculados")} pelo Gleap.`);
        router.refresh();
      }
      const res = await gleapPendingCount();
      if (res.ok) setPending(res.data.pending);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => onOpenChange(true)}>
        <ScanSearch /> Buscar no Gleap
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Identificar leads pelo Gleap</DialogTitle>
            <DialogDescription>
              Procura cada telefone sem empresa no Gleap. Se o número leva a uma única empresa, o lead é vinculado a ela
              (tenant do CRM) e recebe o e-mail. Com mais de uma empresa, fica para você decidir. O Gleap não informa
              CNPJ.
            </DialogDescription>
          </DialogHeader>

          {!configured ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              Defina <code>GLEAP_API_TOKEN</code> no <code>.env.local</code> e reinicie o servidor.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {pending === null ? "Contando…" : `${pluralize(pending, "lead nunca consultado", "leads nunca consultados")}.`}
              </p>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Reconsultar também quem não foi encontrado
                  <span className="block text-xs text-muted-foreground">Útil depois que o cliente se cadastra no CRM.</span>
                </span>
                <Switch checked={retry} onCheckedChange={setRetry} disabled={running} />
              </label>

              {totals && (
                <dl className="grid grid-cols-2 gap-2 text-sm tabular sm:grid-cols-4">
                  <Stat label="Vinculados" value={totals.linked} />
                  <Stat label="Ambíguos" value={totals.ambiguous} />
                  <Stat label="Sem cadastro" value={totals.notFound} />
                  <Stat label="Falhas" value={totals.failed} />
                </dl>
              )}
              {running && remaining !== null && (
                <p className="text-xs text-muted-foreground">Faltam {remaining}…</p>
              )}
            </div>
          )}

          <DialogFooter>
            {running ? (
              <Button variant="outline" onClick={() => (stopRef.current = true)}>
                <Loader2 className="animate-spin" /> Parar
              </Button>
            ) : (
              <Button onClick={run} disabled={!configured || (!retry && pending === 0)}>
                <ScanSearch /> {totals ? "Varrer de novo" : "Iniciar varredura"}
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
