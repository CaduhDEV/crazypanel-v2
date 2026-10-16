"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailPlus, MoreHorizontal, RotateCcw, Send, UserCheck, UserX, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { changeRole, inviteAttendant, resendAccess, setActive } from "@/lib/admin/attendants";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/validation";
import { cn, formatRelative } from "@/lib/utils";
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
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Pessoa</th>
              <th className="px-4 py-2.5 font-semibold">Papel</th>
              <th className="px-4 py-2.5 font-semibold">Situação</th>
              <th className="px-4 py-2.5 text-right font-semibold">Atendimentos abertos</th>
              <th className="px-4 py-2.5" />
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
          !isSelf && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Ações para ${row.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
      </td>
    </tr>
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
