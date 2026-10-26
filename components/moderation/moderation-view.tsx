"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, ExternalLink, Flag, FlagOff, Loader2, MessageSquareWarning, Search, ShieldAlert, StickyNote, UserX } from "lucide-react";
import { toast } from "sonner";
import { addFlag, addModerationNote, listLeadFlags, removeFlag, removeFromCommunity, type LeadFlag } from "@/lib/moderation/actions";
import type { PrivateResult } from "@/lib/community/core";
import { cn, contactLabel, formatDayLabel, formatPhone, formatRelative, formatTime } from "@/lib/utils";
import type { ContactKind } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { EmptyState, Switch, Tip } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LeadProfileDialog } from "@/components/leads/lead-profile-dialog";
import { OpenTicketLink } from "@/components/conversation/open-ticket-link";

export interface ModerationLead {
  id: string;
  name: string | null;
  phone: string | null;
  lid: string | null;
  kind: ContactKind;
  avatar_url: string | null;
  strikes: number;
  removed_from_community_at: string | null;
  left_community_at: string | null;
  company: { name: string } | null;
}

export interface ModerationEvent {
  id: number;
  contact_id: string;
  type: "flag_added" | "flag_removed" | "removed" | "note";
  reason: string | null;
  rule: string | null;
  by_ai: boolean;
  reverted_at: string | null;
  strikes_after: number | null;
  message: PrivateResult | null;
  created_at: string;
  actor: { name: string } | null;
  contact: { name: string | null; phone: string | null } | null;
  /** Mensagem marcada pela flag. */
  msg: { body: string | null; kind: string } | null;
}

type ActionKind = "warn" | "flag" | "unflag" | "remove" | "note";

const ACTIONS: Record<ActionKind, { title: string; description: string; confirm: string; notify?: string; reasonRequired?: boolean }> = {
  warn: {
    title: "Advertir",
    description: "Soma 1 flag e manda a advertência no privado (a mensagem das Configurações → Moderação).",
    confirm: "Advertir",
    notify: "Mandar a advertência no privado",
  },
  flag: { title: "Adicionar 1 flag", description: "Soma 1 flag sem avisar a pessoa.", confirm: "Adicionar flag" },
  unflag: {
    title: "Retirar 1 flag",
    description: "Desfaz a flag mais recente (por exemplo, dada por engano). Para escolher qual, clique nas bandeiras do lead.",
    confirm: "Retirar flag",
  },
  remove: {
    title: "Tirar da comunidade",
    description: "Remove o lead de todos os grupos da comunidade em que ele está. O número do painel precisa ser admin de cada grupo.",
    confirm: "Tirar da comunidade",
    notify: "Avisar no privado que foi removido(a)",
  },
  note: { title: "Anotação", description: "Fica no histórico de moderação do lead, sem mexer nas flags.", confirm: "Salvar anotação", reasonRequired: true },
};

const MESSAGE_TEXT: Record<PrivateResult, string> = {
  sent: "mensagem enviada",
  disabled: "mensagem desligada nas Configurações",
  no_phone: "sem telefone para avisar",
  failed: "a mensagem falhou",
};

export function ModerationView({
  limit,
  leads,
  events,
  query,
  found,
  aiFlagged,
  error,
}: {
  limit: number;
  leads: ModerationLead[];
  events: ModerationEvent[];
  query: string;
  found: ModerationLead[];
  /** Leads com flag ativa dada pela IA. */
  aiFlagged: string[];
  error: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [action, setAction] = useState<{ kind: ActionKind; lead: ModerationLead } | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [flagsOf, setFlagsOf] = useState<{ id: string; name: string } | null>(null);
  const byAi = new Set(aiFlagged);
  const flaggedIds = new Set(leads.map((l) => l.id));
  const inaptos = leads.filter((l) => l.strikes >= limit).length;

  return (
    <main className="flex-1 px-4 py-5 sm:px-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{leads.length} na moderação</Badge>
            <Badge variant={inaptos ? "destructive" : "outline"}>{inaptos} inaptos</Badge>
            <form
              className="ml-auto flex w-full items-center gap-2 sm:w-80"
              onSubmit={(e) => {
                e.preventDefault();
                router.push(search.trim() ? `/moderacao?q=${encodeURIComponent(search.trim())}` : "/moderacao");
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar lead para advertir" className="pl-8" aria-label="Buscar lead" />
              </div>
              <Button type="submit" variant="outline">
                Buscar
              </Button>
            </form>
          </div>

          {query && (
            <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <span className="text-[13px] font-medium">Resultado da busca por “{query}”</span>
              {found.length ? (
                <ul className="flex flex-col divide-y divide-border">
                  {found.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 py-2">
                      <LeadCell lead={l} limit={limit} onOpen={() => setProfileId(l.id)} />
                      <span className="ml-auto flex shrink-0 gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setAction({ kind: "warn", lead: l })}>
                          <MessageSquareWarning /> Advertir
                        </Button>
                        {flaggedIds.has(l.id) && <Badge variant="outline">já na lista</Badge>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhum lead encontrado.</p>
              )}
            </section>
          )}

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>
          ) : leads.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="Ninguém na moderação" description="Busque um lead acima para advertir. Quem receber flag aparece aqui." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="data-table">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">Lead</th>
                    <th className="px-4 py-2.5 font-semibold">Flags</th>
                    <th className="px-4 py-2.5 font-semibold">Comunidade</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => {
                    const inapto = l.strikes >= limit;
                    return (
                      <tr key={l.id} className={cn("border-b border-border last:border-b-0", inapto ? "bg-destructive-soft/60" : "hover:bg-accent/30")}>
                        <td className="px-4 py-2.5">
                          <LeadCell lead={l} limit={limit} byAi={byAi.has(l.id)} onOpen={() => setProfileId(l.id)} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Tip label="Ver as flags e as mensagens marcadas">
                            <button type="button" onClick={() => setFlagsOf({ id: l.id, name: contactLabel(l) })} className="rounded-md px-1 py-0.5 hover:bg-accent" aria-label="Ver flags">
                              <FlagMeter strikes={l.strikes} limit={limit} />
                            </button>
                          </Tip>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {l.removed_from_community_at ? (
                            <span className="font-medium text-destructive">Removido {formatRelative(l.removed_from_community_at)}</span>
                          ) : l.left_community_at ? (
                            `Saiu ${formatRelative(l.left_community_at)}`
                          ) : (
                            "Na comunidade"
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex justify-end gap-1">
                            <Tip label="Advertir: +1 flag e aviso no privado">
                              <Button size="icon-sm" variant="outline" onClick={() => setAction({ kind: "warn", lead: l })} aria-label="Advertir">
                                <MessageSquareWarning />
                              </Button>
                            </Tip>
                            <Tip label="+1 flag (sem avisar)">
                              <Button size="icon-sm" variant="outline" onClick={() => setAction({ kind: "flag", lead: l })} aria-label="Adicionar flag">
                                <Flag />
                              </Button>
                            </Tip>
                            <Tip label="Retirar 1 flag">
                              <Button size="icon-sm" variant="outline" disabled={l.strikes <= 0} onClick={() => setAction({ kind: "unflag", lead: l })} aria-label="Retirar flag">
                                <FlagOff />
                              </Button>
                            </Tip>
                            <Tip label="Anotação no histórico">
                              <Button size="icon-sm" variant="outline" onClick={() => setAction({ kind: "note", lead: l })} aria-label="Anotação">
                                <StickyNote />
                              </Button>
                            </Tip>
                            <Tip label="Tirar da comunidade">
                              <Button size="icon-sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setAction({ kind: "remove", lead: l })} aria-label="Tirar da comunidade">
                                <UserX />
                              </Button>
                            </Tip>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Histórico de moderação</span>
          {events.length ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card text-xs">
              {events.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{e.contact?.name ?? formatPhone(e.contact?.phone) ?? "Lead"}</span>
                    <span className="shrink-0 text-muted-foreground">{formatRelative(e.created_at)}</span>
                  </span>
                  <span
                    className={cn(
                      e.type === "removed" ? "text-destructive" : e.type === "flag_removed" ? "text-success" : "text-foreground/85",
                      e.reverted_at && "line-through opacity-70",
                    )}
                  >
                    {e.type === "flag_added" ? `+1 flag (${e.strikes_after ?? "?"}/${limit})` : e.type === "flag_removed" ? `-1 flag (${e.strikes_after}/${limit})` : e.type === "removed" ? "Tirado da comunidade" : "Anotação"}
                    {e.by_ai ? " · Moderado por IA" : e.actor ? ` · ${e.actor.name}` : ""}
                    {e.message ? ` · ${MESSAGE_TEXT[e.message]}` : ""}
                  </span>
                  {e.rule && <span className="text-muted-foreground">Regra: {e.rule}</span>}
                  {e.reason && <span className="text-muted-foreground">{e.reason}</span>}
                  {e.msg?.body && (
                    <button
                      type="button"
                      onClick={() => setFlagsOf({ id: e.contact_id, name: e.contact?.name ?? (formatPhone(e.contact?.phone) || "Lead") })}
                      className="mt-0.5 line-clamp-2 rounded border-l-2 border-destructive/60 bg-muted/60 px-2 py-1 text-left italic text-foreground/80 hover:bg-muted"
                    >
                      “{e.msg.body}”
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nada registrado ainda.</p>
          )}
        </aside>
      </div>

      {action && <ActionDialog kind={action.kind} lead={action.lead} limit={limit} onClose={() => setAction(null)} onDone={() => router.refresh()} />}
      <LeadProfileDialog contactId={profileId} onClose={() => setProfileId(null)} />
      {flagsOf && <FlagsDialog lead={flagsOf} limit={limit} onClose={() => setFlagsOf(null)} onChanged={() => router.refresh()} />}
    </main>
  );
}

function LeadCell({ lead, limit, byAi, onOpen }: { lead: ModerationLead; limit: number; byAi?: boolean; onOpen: () => void }) {
  const inapto = lead.strikes >= limit;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={contactLabel(lead)} src={lead.avatar_url} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={onOpen} className={cn("max-w-56 truncate text-left font-medium hover:underline", inapto && "text-destructive")}>
            {contactLabel(lead)}
          </button>
          {inapto && <Badge variant="destructive">Inapto</Badge>}
          {byAi && <AiBadge />}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {[formatPhone(lead.phone), lead.company?.name].filter(Boolean).join(" · ") || "Sem telefone"}
        </span>
      </span>
    </span>
  );
}

/** Bolinhas de flag: preenchidas até o número atual, vermelhas no limite. */
export function FlagMeter({ strikes, limit }: { strikes: number; limit: number }) {
  const inapto = strikes >= limit;
  return (
    <span className="flex items-center gap-1.5" title={`${strikes} de ${limit} flags`}>
      {Array.from({ length: Math.max(limit, strikes) }).map((_, i) => (
        <Flag key={i} className={cn("size-3.5", i < strikes ? (inapto ? "fill-destructive text-destructive" : "fill-warning text-warning") : "text-muted-foreground/40")} />
      ))}
      <span className={cn("text-xs tabular", inapto ? "font-semibold text-destructive" : "text-muted-foreground")}>
        {strikes}/{limit}
      </span>
    </span>
  );
}

function AiBadge() {
  return (
    <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
      <Bot className="size-3" /> Moderado por IA
    </Badge>
  );
}

const when = (d: string) => `${formatDayLabel(d)} ${formatTime(d)}`;

/** Flags do lead com a mensagem marcada em cada uma; dá para retirar uma específica. */
function FlagsDialog({ lead, limit, onClose, onChanged }: { lead: { id: string; name: string }; limit: number; onClose: () => void; onChanged: () => void }) {
  const [flags, setFlags] = useState<LeadFlag[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    let alive = true;
    listLeadFlags({ contactId: lead.id }).then((res) => {
      if (!alive) return;
      if (!res.ok) return void toast.error(res.error);
      setFlags(res.data);
    });
    return () => {
      alive = false;
    };
  }, [lead.id]);

  const revert = (f: LeadFlag) => {
    setBusy(f.id);
    start(async () => {
      const res = await removeFlag({ contactId: lead.id, eventId: f.id, reason: f.by_ai ? "IA errou" : undefined });
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Flag retirada: ${res.data.strikes}/${limit}.`);
      setFlags((list) => list?.map((x) => (x.id === f.id ? { ...x, reverted_at: new Date().toISOString() } : x)) ?? null);
      onChanged();
    });
  };

  const ordered = flags ? [...flags.filter((f) => !f.reverted_at), ...flags.filter((f) => f.reverted_at)] : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Flags · {lead.name}</DialogTitle>
          <DialogDescription>Cada flag com a mensagem que foi marcada. Se a flag estiver errada, retire.</DialogDescription>
        </DialogHeader>
        {!flags ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !flags.length ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma flag registrada (as do sistema antigo não têm mensagem).</p>
        ) : (
          <div className="scroll-thin flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
            {ordered.map((f) => (
              <div key={f.id} className={cn("flex flex-col gap-1.5 rounded-md border border-border p-3 text-xs", f.reverted_at && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2">
                  {f.by_ai ? <AiBadge /> : <Badge variant="outline">{f.actor?.name ?? "Equipe"}</Badge>}
                  <span className="text-muted-foreground">{when(f.created_at)}</span>
                  {f.by_ai && f.confidence != null && <span className="text-muted-foreground">· {Math.round(Number(f.confidence) * 100)}% de certeza</span>}
                  {f.reverted_at ? (
                    <span className="ml-auto text-success">Retirada{f.reverter ? ` por ${f.reverter.name}` : ""}</span>
                  ) : (
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => revert(f)} disabled={busy !== null}>
                      {busy === f.id ? <Loader2 className="animate-spin" /> : <FlagOff />} Retirar flag
                    </Button>
                  )}
                </div>
                {f.rule && <span className="font-medium">Regra: {f.rule}</span>}
                {f.reason && <span className="text-muted-foreground">{f.reason}</span>}
                {f.msg ? (
                  <div className="flex flex-col gap-1 rounded border-l-2 border-destructive/60 bg-muted/60 px-2.5 py-1.5">
                    <span className="whitespace-pre-wrap break-words text-[13px] text-foreground/90">
                      {f.msg.deleted_at ? <em className="text-muted-foreground">Mensagem apagada</em> : f.msg.body || <em className="text-muted-foreground">[{f.msg.kind}]</em>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      {f.msg.group?.name ?? "Grupo"} · {when(f.msg.sent_at)}
                      {f.msg.ticket_id && (
                        <OpenTicketLink ticketId={f.msg.ticket_id} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                          <ExternalLink className="size-3" /> Abrir atendimento
                        </OpenTicketLink>
                      )}
                    </span>
                  </div>
                ) : (
                  <span className="italic text-muted-foreground">Flag dada no lead, sem mensagem marcada.</span>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ActionDialog({ kind, lead, limit, onClose, onDone }: { kind: ActionKind; lead: ModerationLead; limit: number; onClose: () => void; onDone: () => void }) {
  const cfg = ACTIONS[kind];
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [pending, start] = useTransition();
  const name = contactLabel(lead);
  const nextStrikes = kind === "warn" || kind === "flag" ? lead.strikes + 1 : kind === "unflag" ? Math.max(0, lead.strikes - 1) : lead.strikes;

  const confirm = () =>
    start(async () => {
      const why = reason.trim() || undefined;
      if (kind === "warn" || kind === "flag") {
        const res = await addFlag({ contactId: lead.id, reason: why, warn: kind === "warn" && notify });
        if (!res.ok) return void toast.error(res.error);
        const { strikes, message } = res.data;
        toast.success(`${name}: ${strikes}/${res.data.limit} flags${strikes >= res.data.limit ? " (inapto)" : ""}${message ? ` · ${MESSAGE_TEXT[message]}` : ""}.`);
      } else if (kind === "unflag") {
        const res = await removeFlag({ contactId: lead.id, reason: why });
        if (!res.ok) return void toast.error(res.error);
        toast.success(`${name}: ${res.data.strikes}/${limit} flags.`);
      } else if (kind === "note") {
        if (!why) return void toast.error("Escreva a anotação.");
        const res = await addModerationNote({ contactId: lead.id, reason: why });
        if (!res.ok) return void toast.error(res.error);
        toast.success("Anotação salva.");
      } else {
        const res = await removeFromCommunity({ contactId: lead.id, reason: why, notify });
        if (!res.ok) return void toast.error(res.error);
        const { removed, failed, message } = res.data;
        if (removed.length) toast.success(`${name} saiu de ${removed.join(", ")}${message ? ` · ${MESSAGE_TEXT[message]}` : ""}.`);
        else if (!failed.length) toast.success(`${name} não estava em nenhum grupo; marcado como removido.`);
        for (const f of failed) toast.error(`${f.group}: ${f.error}`);
      }
      onClose();
      onDone();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {cfg.title} · {name}
          </DialogTitle>
          <DialogDescription>{cfg.description}</DialogDescription>
        </DialogHeader>
        {kind !== "remove" && kind !== "note" && (
          <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
            <FlagMeter strikes={nextStrikes} limit={limit} />
            <span className="text-xs text-muted-foreground">
              {nextStrikes >= limit ? "Fica inapto (vermelho em Leads)." : `Faltam ${limit - nextStrikes} para ficar inapto.`}
            </span>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mod-reason">{kind === "note" ? "Anotação" : "Motivo"}</Label>
          <Textarea
            id="mod-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={kind === "note" ? "Ex.: conversado no privado, se comprometeu a não divulgar." : "Ex.: divulgação de produto concorrente no grupo."}
          />
          {cfg.notify && <p className="text-xs text-muted-foreground">O motivo entra na mensagem como {"{motivo}"}.</p>}
        </div>
        {cfg.notify && (
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[13px]">
            {cfg.notify}
            <Switch checked={notify} onCheckedChange={setNotify} />
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={kind === "remove" ? "destructive" : "default"} onClick={confirm} disabled={pending || (cfg.reasonRequired && !reason.trim())}>
            {pending && <Loader2 className="animate-spin" />}
            {cfg.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
