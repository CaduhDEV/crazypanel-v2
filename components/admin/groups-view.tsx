"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Handshake, Loader2, Megaphone, MessagesSquare, RefreshCw, Search, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { setGroupListening, setPartnerGroup, syncGroupMembers, syncGroups } from "@/lib/admin/groups";
import { cn, formatRelative, pluralize } from "@/lib/utils";
import type { WaGroup } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Switch, Tip } from "@/components/ui/misc";
import { Pager, usePaged } from "@/components/ui/pager";

type Filter = "all" | "listening" | "off";

export function GroupsView({ groups, openByGroup }: { groups: WaGroup[]; openByGroup: Record<string, number> }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [syncing, startSync] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(groups, (state, update: { jid: string; listening: boolean }) =>
    state.map((g) => (g.jid === update.jid ? { ...g, listening: update.listening } : g)),
  );
  const [, startToggle] = useTransition();

  const listeningCount = optimistic.filter((g) => g.listening).length;
  const term = search.trim().toLowerCase();
  const visible = optimistic.filter(
    (g) =>
      (filter === "all" || (filter === "listening" ? g.listening : !g.listening)) &&
      (!term || g.name?.toLowerCase().includes(term) || g.jid.includes(term)),
  );

  const paged = usePaged(visible, `${filter}|${term}`);

  const sync = () =>
    startSync(async () => {
      const res = await syncGroups();
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${pluralize(res.data, "grupo sincronizado", "grupos sincronizados")}.`);
      router.refresh();
    });

  const toggle = (g: WaGroup, listening: boolean) =>
    startToggle(async () => {
      setOptimistic({ jid: g.jid, listening });
      const res = await setGroupListening({ jid: g.jid, listening });
      if (!res.ok) toast.error(res.error);
      else toast.success(listening ? `Escutando “${g.name ?? g.jid}”.` : `“${g.name ?? g.jid}” não abre mais atendimentos.`);
      router.refresh();
    });

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar grupo" className="pl-8" aria-label="Buscar grupo" />
        </div>
        <div className="flex gap-1 rounded-md border border-border bg-card p-0.5" role="tablist" aria-label="Filtrar grupos">
          {(
            [
              ["all", `Todos ${optimistic.length}`],
              ["listening", `Escutados ${listeningCount}`],
              ["off", `Desligados ${optimistic.length - listeningCount}`],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "h-7 rounded px-2.5 text-[13px] transition-colors",
                filter === value ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button className="ml-auto" variant="outline" onClick={sync} disabled={syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Buscar grupos no WhatsApp
        </Button>
      </div>

      {optimistic.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={MessagesSquare}
            title="Nenhum grupo ainda"
            description="Conecte a instância em WhatsApp e busque os grupos da conta. Grupos também aparecem sozinhos na primeira mensagem recebida."
            action={
              <Button onClick={sync} disabled={syncing}>
                {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Buscar grupos
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {paged.pageItems.map((g) => (
              <GroupRow key={g.jid} group={g} open={openByGroup[g.jid] ?? 0} onToggle={(v) => toggle(g, v)} />
            ))}
            {visible.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhum grupo neste filtro.</li>}
          </ul>
          <Pager page={paged.page} pages={paged.pages} onChange={paged.setPage} />
        </>
      )}
    </main>
  );
}

function GroupRow({ group, open, onToggle }: { group: WaGroup; open: number; onToggle: (listening: boolean) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [partnerPending, startPartner] = useTransition();
  const togglePartner = () => {
    const next = !group.is_partner_group;
    if (next && !window.confirm(`Marcar "${group.name ?? group.jid}" como grupo de parceiros? Os clientes que estão nele viram parceiros (a equipe continua equipe).`)) return;
    startPartner(async () => {
      const res = await setPartnerGroup({ jid: group.jid, isPartnerGroup: next });
      if (!res.ok) return void toast.error(res.error);
      toast.success(next ? "Grupo marcado como de parceiros." : "Grupo desmarcado. Quem já é parceiro continua parceiro.");
      router.refresh();
    });
  };

  const syncMembers = () =>
    start(async () => {
      const res = await syncGroupMembers({ jid: group.jid });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${pluralize(res.data, "membro importado", "membros importados")} para Leads.`);
      router.refresh();
    });

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Switch checked={group.listening} onCheckedChange={onToggle} aria-label={`Escutar ${group.name ?? group.jid}`} />
      <Avatar name={group.name ?? "G"} src={group.picture_url} size="md" className="rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{group.name ?? "Grupo sem nome"}</span>
          {group.is_announce && (
            <Tip label="Só administradores enviam mensagens">
              <Megaphone className="size-3.5 shrink-0 text-muted-foreground" />
            </Tip>
          )}
          {group.is_community && <Badge variant="outline">Comunidade</Badge>}
          {group.is_partner_group && <Badge variant="primary">Parceiros</Badge>}
        </span>
        <span className="text-xs text-muted-foreground">
          {[
            group.member_count != null && pluralize(group.member_count, "membro", "membros"),
            group.listening && pluralize(open, "atendimento aberto", "atendimentos abertos"),
            group.last_message_at && `última mensagem ${formatRelative(group.last_message_at)}`,
          ]
            .filter(Boolean)
            .join(" · ") || group.jid}
        </span>
      </div>
      <Tip
        label={
          group.is_partner_group
            ? "Membros deste grupo viram parceiros (equipe continua equipe). Clique para desmarcar."
            : "Marcar como grupo de parceiros: os clientes que estão nele viram parceiros."
        }
      >
        <Button variant={group.is_partner_group ? "secondary" : "outline"} size="sm" onClick={togglePartner} disabled={partnerPending} aria-pressed={!!group.is_partner_group}>
          {partnerPending ? <Loader2 className="animate-spin" /> : <Handshake />} Parceiros
        </Button>
      </Tip>
      <Tip label={group.members_synced_at ? `Importados ${formatRelative(group.members_synced_at)}` : "Traz todos os participantes para Leads, inclusive quem nunca falou"}>
        <Button variant="outline" size="sm" onClick={syncMembers} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <UsersRound />} Importar membros
        </Button>
      </Tip>
    </li>
  );
}
