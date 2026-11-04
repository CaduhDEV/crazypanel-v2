"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailPlus, MoreHorizontal, Phone, Plus, RotateCcw, Send, Trash2, UserCheck, UserX, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { addAttendantPhone, changeRole, inviteAttendant, linkContactToAttendant, listAttendantPhones, removeAttendantPhone, resendAccess, setActive, type AttendantPhones } from "@/lib/admin/attendants";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/validation";
import { cn, contactLabel, formatPhone, formatRelative } from "@/lib/utils";
import { ROLE_LABELS, type AppRole, type Profile } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { Pager, usePaged } from "@/components/ui/pager";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type AttendantRow = Profile & { invitePending: boolean; lastSignInAt: string | null; openTickets: number };

export function AttendantsView({ rows, currentUserId }: { rows: AttendantRow[]; currentUserId: string }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const active = rows.filter((r) => r.active);
  const inactive = rows.filter((r) => !r.active);
  const paged = usePaged(rows);

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 text-sm text-muted-foreground">
          <Badge variant="neutral">{active.filter((r) => r.role === "admin").length} administradores</Badge>
          <Badge variant="neutral">{active.filter((r) => r.role === "attendant").length} atendentes</Badge>
          {inactive.length > 0 && <Badge variant="outline">{inactive.length} desativados</Badge>}
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <MailPlus /> Convidar atendente
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="data-table">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold w-[32%]">Pessoa</th>
              <th className="px-4 py-2.5 font-semibold w-[16%]">Papel</th>
              <th className="px-4 py-2.5 font-semibold w-[18%]">Situação</th>
              <th className="px-4 py-2.5 text-right font-semibold w-[16%]">Atendimentos abertos</th>
              <th className="px-4 py-2.5 w-[18%]" />
            </tr>
          </thead>
          <tbody>
            {paged.pageItems.map((r) => (
              <AttendantRowView key={r.id} row={r} isSelf={r.id === currentUserId} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState icon={UsersRound} title="Ninguém cadastrado ainda" />}
      </div>
      <Pager page={paged.page} pages={paged.pages} onChange={paged.setPage} />

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </main>
  );
}

function AttendantRowView({ row, isSelf }: { row: AttendantRow; isSelf: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [phonesOpen, setPhonesOpen] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(success);
      router.refresh();
    });

  return (
    <tr className={cn("border-b border-border last:border-b-0", !row.active && "opacity-60")}>
      <td className="px-4 py-3">
        <span className="flex items-center gap-3">
          <Avatar name={row.name} src={row.avatar_url} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium">
              {row.name} {isSelf && <span className="font-normal text-muted-foreground">(você)</span>}
            </span>
            <span className="truncate text-xs text-muted-foreground">{row.email}</span>
          </span>
        </span>
      </td>
      <td className="px-4 py-3">
        <Select
          value={row.role}
          disabled={isSelf || !row.active || pending}
          onValueChange={(role) => run(() => changeRole({ profileId: row.id, role: role as AppRole }), "Papel atualizado.")}
        >
          <SelectTrigger className="h-8 w-40" aria-label={`Papel de ${row.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="attendant">{ROLE_LABELS.attendant}</SelectItem>
            <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="px-4 py-3">
        {!row.active ? (
          <Badge variant="outline">Desativado</Badge>
        ) : row.invitePending ? (
          <Badge variant="warning">Convite pendente</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {row.lastSignInAt ? `Último acesso ${formatRelative(row.lastSignInAt)}` : "Ativo"}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular">{row.openTickets}</td>
      <td className="px-4 py-3 text-right">
        {pending ? (
          <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
        ) : (
          isSelf ? (
            <Button variant="ghost" size="sm" onClick={() => setPhonesOpen(true)}>
              <Phone /> Números
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${row.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setPhonesOpen(true)}>
                  <Phone /> Números do WhatsApp
                </DropdownMenuItem>
                {row.active && (
                  <DropdownMenuItem onSelect={() => run(() => resendAccess({ profileId: row.id }), "Link de acesso enviado por e-mail.")}>
                    {row.invitePending ? <Send /> : <RotateCcw />}
                    {row.invitePending ? "Reenviar convite" : "Enviar link para redefinir senha"}
                  </DropdownMenuItem>
                )}
                {row.active ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => run(() => setActive({ profileId: row.id, active: false }), "Acesso desativado. Os atendimentos abertos dele voltaram para a fila.")}
                  >
                    <UserX /> Desativar acesso
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => run(() => setActive({ profileId: row.id, active: true }), "Acesso reativado.")}>
                    <UserCheck /> Reativar acesso
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
        {phonesOpen && <PhonesDialog row={row} onClose={() => setPhonesOpen(false)} />}
      </td>
    </tr>
  );
}

/** Números do atendente: as mensagens que vêm deles contam nas métricas dele. */
function PhonesDialog({ row, onClose }: { row: AttendantRow; onClose: () => void }) {
  const [data, setData] = useState<AttendantPhones | null>(null);
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();

  const load = () =>
    listAttendantPhones({ profileId: row.id }).then((res) => {
      if (res.ok) setData(res.data);
      else toast.error(res.error);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uma vez ao abrir
  }, []);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      after?.();
      await load();
    });

  const label = (c: { name: string | null; phone: string | null; lid: string | null }) => contactLabel(c);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="text-left">
        <DialogHeader>
          <DialogTitle>Números de {row.name}</DialogTitle>
          <DialogDescription>Toda mensagem desses números no grupo conta para esta pessoa nas métricas, inclusive as antigas. Pode ter mais de um.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => addAttendantPhone({ profileId: row.id, phone }), () => setPhone(""));
          }}
        >
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" aria-label="Número do WhatsApp" />
          <Button type="submit" disabled={pending || !phone.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar
          </Button>
        </form>
        {!data ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <ul className="flex flex-col gap-1">
              {data.phones.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5">
                  <span className="font-mono text-[13px]">{formatPhone(p.phone)}</span>
                  <Button variant="ghost" size="icon-xs" disabled={pending} onClick={() => act(() => removeAttendantPhone({ id: p.id }))} aria-label="Remover número">
                    <Trash2 />
                  </Button>
                </li>
              ))}
              {data.phones.length === 0 && <li className="text-xs text-muted-foreground">Nenhum número cadastrado.</li>}
            </ul>
            {data.contacts.length > 0 && (
              <section className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Contatos ligados</span>
                {data.contacts.map((c) => (
                  <span key={c.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{label(c)} · {c.message_count} mensagens</span>
                    {!c.phone && (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(() => linkContactToAttendant({ contactId: c.id, profileId: null }))}>
                        Desligar
                      </Button>
                    )}
                  </span>
                ))}
              </section>
            )}
            {data.unlinked.length > 0 && (
              <section className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Contatos da equipe sem atendente (o WhatsApp pode esconder o número: ligue por aqui)</span>
                <div className="scroll-thin flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {data.unlinked.map((c) => (
                    <span key={c.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{label(c)} · {c.message_count} mensagens</span>
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => linkContactToAttendant({ contactId: c.id, profileId: row.id }))}>
                        Ligar
                      </Button>
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", role: "attendant" as AppRole });
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await inviteAttendant(form);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Convite enviado para ${form.email}.`);
      setForm({ name: "", email: "", role: "attendant" });
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Convidar atendente</DialogTitle>
            <DialogDescription>A pessoa recebe um e-mail com o link para definir a senha e entrar.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-name">Nome</Label>
            <Input id="invite-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder={`nome@${ALLOWED_EMAIL_DOMAIN}`}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-role">Papel</Label>
            <Select value={form.role} onValueChange={(role) => setForm({ ...form, role: role as AppRole })}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="attendant">Atendente: só o Atendimento</SelectItem>
                <SelectItem value="admin">Administrador: acesso completo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Enviar convite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
