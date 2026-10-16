"use client";

import { useEffect, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { refreshGleapTickets } from "@/lib/gleap-actions";
import { formatRelative } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/misc";
import {
  GLEAP_TICKETS_KEY,
  gleapStatusLabel,
  gleapBoardLabel,
  useGleapTicketsByContact,
} from "@/components/app/use-gleap-tickets";

/** Aviso de conflito de canais: o lead também tem chamado ativo no Gleap. */
export function GleapSection({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const { data } = useGleapTicketsByContact();
  const [refreshing, start] = useTransition();
  const tickets = data?.get(contactId) ?? [];

  const refresh = () =>
    start(async () => {
      const res = await refreshGleapTickets();
      if (!res.ok) return void toast.error(res.error);
      await queryClient.invalidateQueries({ queryKey: GLEAP_TICKETS_KEY });
    });

  // Ao abrir o lead, renova a cópia em segundo plano (o servidor limita a 1x/min
  // para toda a equipe). Sem toast: falha aqui não deve atrapalhar o atendimento.
  useEffect(() => {
    let cancelled = false;
    refreshGleapTickets().then((res) => {
      if (!cancelled && res.ok && !res.data.skipped) queryClient.invalidateQueries({ queryKey: GLEAP_TICKETS_KEY });
    });
    return () => {
      cancelled = true;
    };
  }, [contactId, queryClient]);

  if (tickets.length === 0) return null;
  const syncedAt = tickets[0].synced_at;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Gleap</h3>
        <Tip label={`Atualizado ${formatRelative(syncedAt)}. Clique para atualizar agora.`}>
          <Button variant="ghost" size="icon-sm" onClick={refresh} disabled={refreshing} aria-label="Atualizar chamados do Gleap">
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </Tip>
      </div>
      <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-xs text-warning">
        <AlertTriangle className="size-4 shrink-0" />
        Atenção, este cliente também tem chamado(s) ativo(s) no Gleap.
      </div>
      <ul className="flex flex-col gap-1.5">
        {tickets.map((t) => (
          <li key={t.gleap_ticket_id} className="flex flex-col gap-1 rounded-md border border-border p-2 text-xs">
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Badge variant="outline" title="Board no Gleap">{gleapBoardLabel(t)}</Badge>
                {t.bug_id &&
                  (t.url ? (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 font-medium tabular text-primary underline-offset-2 hover:underline dark:text-[#9fc0ef]"
                      title="Abrir o ticket no Gleap"
                    >
                      #{t.bug_id} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground tabular">#{t.bug_id}</span>
                  ))}
              </span>
              <span className="text-muted-foreground">{gleapStatusLabel(t.status)}</span>
            </span>
            {t.title && <span className="line-clamp-2">{t.title}</span>}
            <span className="text-muted-foreground">
              {t.assignee_name ? `Com ${t.assignee_name}` : "Sem responsável"}
              {t.gleap_updated_at && ` · feito em ${formatRelative(t.gleap_updated_at)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
