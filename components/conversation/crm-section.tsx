"use client";

import { Fragment, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { callApi } from "@/lib/api-client";
import { formatRelative, formatTaxId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton, Tip } from "@/components/ui/misc";
import { useNow } from "@/components/app/use-now";
import { ticketKey, type ThreadTicket } from "@/components/conversation/use-thread";

const RECENT_MS = 24 * 60 * 60 * 1000;


/**
 * Lead no CRM DataCrazy (pelo telefone): documento, responsável e o último
 * contato pelo WhatsApp do CRM. Avisa quando ele conversou por lá há pouco e
 * está aguardando resposta (conflito de canais).
 */
export function CrmSection({ ticket }: { ticket: ThreadTicket }) {
  const queryClient = useQueryClient();
  const [refreshing, start] = useTransition();
  const contact = ticket.contact!;
  const now = useNow();

  // Ao abrir o lead: consulta o CRM se o cache (10 min) venceu. É uma rota, não
  // Server Action, para não segurar o envio de mensagens enquanto o CRM responde.
  const { isFetching } = useQuery({
    queryKey: ["contact", contact.id, "crm"],
    enabled: !!contact.phone,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const res = await callApi<boolean>(`/api/contacts/${contact.id}/crm`, { method: "POST" });
      if (res.ok && res.data) await queryClient.invalidateQueries({ queryKey: ticketKey(ticket.id) });
      return res.ok && res.data;
    },
  });

  const refresh = () =>
    start(async () => {
      const res = await callApi<boolean>(`/api/contacts/${contact.id}/crm?force=1`, { method: "POST" });
      if (!res.ok) return void toast.error(res.error);
      if (res.data) await queryClient.invalidateQueries({ queryKey: ticketKey(ticket.id) });
    });

  if (!contact.crm_checked_at) {
    // Primeira consulta deste lead: esqueleto enquanto o CRM responde.
    if (!isFetching) return null;
    return (
      <section className="flex flex-col gap-2" aria-busy="true">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">CRM DataCrazy</h3>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {[16, 28, 24].map((w, i) => (
            <Fragment key={i}>
              <Skeleton className="h-3.5 w-14" />
              <Skeleton className="h-3.5" style={{ width: `${w * 4}px` }} />
            </Fragment>
          ))}
        </div>
      </section>
    );
  }
  const taxId = contact.company?.cnpj ?? contact.crm_tax_id;
  const received = contact.crm_last_received_at ? Date.parse(contact.crm_last_received_at) : 0;
  const sent = contact.crm_last_sent_at ? Date.parse(contact.crm_last_sent_at) : 0;
  const talkingThere = received > 0 && now - received < RECENT_MS && (contact.crm_pending === true || received > sent);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">CRM DataCrazy</h3>
        <Tip label={`Consultado ${formatRelative(contact.crm_checked_at)}. Clique para consultar agora.`}>
          <Button variant="ghost" size="icon-sm" onClick={refresh} disabled={refreshing || isFetching} aria-label="Consultar o CRM">
            {refreshing || isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </Tip>
      </div>

      {!contact.crm_lead_id ? (
        <p className="text-xs text-muted-foreground">Telefone não encontrado no CRM.</p>
      ) : (
        <>
          {talkingThere && (
            <div className="flex gap-2 rounded-md border border-warning/30 bg-warning-soft p-2.5 text-xs text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              Mandou mensagem no WhatsApp do CRM {formatRelative(contact.crm_last_received_at!)}
              {contact.crm_pending ? " e aguarda resposta" : ""}. Combine com {contact.crm_attendant_name ?? "o responsável"} para não
              responder em dobro.
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {taxId && (
              <>
                <dt className="text-muted-foreground">{taxId.length === 11 ? "CPF" : "CNPJ"}</dt>
                <dd className="font-mono tabular">{formatTaxId(taxId)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Responsável</dt>
            <dd>{contact.crm_attendant_name ?? "Ninguém"}</dd>
            <dt className="text-muted-foreground">WhatsApp</dt>
            <dd>
              {received ? `recebeu ${formatRelative(contact.crm_last_received_at!)}` : "sem mensagens"}
              {sent ? ` · enviou ${formatRelative(contact.crm_last_sent_at!)}` : ""}
            </dd>
          </dl>
        </>
      )}
    </section>
  );
}
