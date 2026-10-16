"use client";

import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check, Handshake, Loader2, Plus, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { linkContact, searchCompanies, unlinkContact, type CompanyOption } from "@/lib/leads/actions";
import { cn, contactLabel, formatPhone, formatTaxId } from "@/lib/utils";
import type { Company, Contact, ContactKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useDebouncedValue } from "@/components/app/use-debounced-value";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type LinkTarget = Pick<Contact, "id" | "name" | "phone" | "lid" | "kind" | "company_id"> & {
  company?: Pick<Company, "id" | "name"> | null;
};

const KIND_OPTIONS: { value: ContactKind; label: string; hint: string; icon: typeof Building2 }[] = [
  { value: "customer", label: "Cliente", hint: "Pessoa de uma empresa cliente", icon: Building2 },
  { value: "partner", label: "Parceiro", hint: "Isento de SLA de cliente; empresa opcional", icon: Handshake },
  { value: "team", label: "Equipe", hint: "DataCrazy: não abre atendimentos; empresa opcional", icon: ShieldCheck },
];

/** Vínculo 1 a 1: o lead passa a pertencer a uma empresa (ou vira parceiro/equipe). */
export function LinkContactDialog({
  target,
  onClose,
  onSaved,
}: {
  target: LinkTarget | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl">
        {/* key: cada lead começa com o formulário no estado dele. */}
        {target && <LinkContactForm key={target.id} target={target} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkContactForm({ target, onClose, onSaved }: { target: LinkTarget; onClose: () => void; onSaved?: () => void }) {
  const [kind, setKind] = useState<ContactKind>(target.kind);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CompanyOption | null>(
    target.company
      ? { companyId: target.company.id, tenantId: null, name: target.company.name, cnpj: null, usersCount: 0, suggested: false }
      : null,
  );
  const [creating, setCreating] = useState(false);
  const [newCompany, setNewCompany] = useState({ name: "", externalId: "", email: "" });
  const [pending, start] = useTransition();

  const debouncedQuery = useDebouncedValue(query, 250);
  const { data: results = [], isFetching: searching } = useQuery({
    queryKey: ["companies", "search", debouncedQuery, target.id],
    enabled: !creating,
    queryFn: async () => {
      const res = await searchCompanies({ query: debouncedQuery, contactId: target.id });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });

  const save = () =>
    start(async () => {
      // A empresa vale para qualquer tipo; só o cliente é obrigado a ter.
      const res =
        creating
            ? await linkContact({
                contactId: target.id,
                kind,
                newCompany: { name: newCompany.name, externalId: newCompany.externalId || undefined, email: newCompany.email || undefined },
              })
            : selected?.companyId
              ? await linkContact({ contactId: target.id, kind, companyId: selected.companyId })
              : await linkContact({ contactId: target.id, kind, tenant: selected?.tenantId ? { id: selected.tenantId, name: selected.name } : undefined });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Vínculo salvo.");
      onSaved?.();
      onClose();
    });

  const unlink = () =>
    start(async () => {
      const res = await unlinkContact({ contactId: target.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Vínculo removido.");
      onSaved?.();
      onClose();
    });

  const canSave = creating ? newCompany.name.trim().length >= 2 : kind !== "customer" || !!selected;

  return (
    <>
        <DialogHeader>
          <DialogTitle>Vincular lead</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{contactLabel(target)}</span>
            {target.phone && ` · ${formatPhone(target.phone)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de lead">
          {KIND_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={kind === o.value}
              onClick={() => setKind(o.value)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors",
                kind === o.value ? "border-primary bg-primary-soft" : "border-border hover:bg-accent",
              )}
            >
              <o.icon className={cn("size-4", kind === o.value ? "text-primary dark:text-[#9fc0ef]" : "text-muted-foreground")} />
              <span className="text-[13px] font-medium">{o.label}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium">
            Empresa no CRM{kind !== "customer" && <span className="font-normal text-muted-foreground"> (opcional para {kind === "partner" ? "parceiro" : "equipe"})</span>}
          </span>
          {kind !== "customer" && selected && !creating && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setSelected(null)}>
              Sem empresa
            </Button>
          )}
        </div>

        {creating ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">Nova empresa</span>
                <Button variant="link" size="sm" className="text-xs" onClick={() => setCreating(false)}>
                  Buscar existente
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="company-name">Nome</Label>
                <Input id="company-name" value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-ext">ID no CRM</Label>
                  <Input id="company-ext" value={newCompany.externalId} onChange={(e) => setNewCompany({ ...newCompany, externalId: e.target.value })} placeholder="opcional" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-email">E-mail da conta</Label>
                  <Input id="company-email" type="email" value={newCompany.email} onChange={(e) => setNewCompany({ ...newCompany, email: e.target.value })} placeholder="opcional" />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por nome, tenant id ou CNPJ"
                  className="pl-8"
                  aria-label="Buscar empresa"
                  autoFocus
                />
              </div>
              <div className="scroll-thin flex max-h-80 flex-col overflow-y-auto rounded-lg border border-border">
                {searching && results.length === 0 ? (
                  <span className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Buscando…
                  </span>
                ) : results.length === 0 ? (
                  <span className="p-3 text-sm text-muted-foreground">Nenhuma empresa encontrada.</span>
                ) : (
                  results.map((c) => {
                    const key = c.tenantId ?? c.companyId ?? c.name;
                    const isSelected = !!selected && (selected.tenantId ?? selected.companyId) === (c.tenantId ?? c.companyId);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelected(c)}
                        className={cn(
                          "flex items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent",
                          isSelected && "bg-primary-soft",
                        )}
                      >
                        <Building2 className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{c.name}</span>
                            {c.suggested && (
                              <span className="shrink-0 rounded bg-primary-soft px-1.5 py-px text-[10.5px] font-medium text-primary dark:text-[#9fc0ef]">
                                Sugerida
                              </span>
                            )}
                          </span>
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {[c.tenantId ?? "sem tenant", c.cnpj && formatTaxId(c.cnpj), c.usersCount ? `${c.usersCount} usuário${c.usersCount > 1 ? "s" : ""}` : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {isSelected && <Check className="size-4 text-primary" />}
                      </button>
                    );
                  })
                )}
              </div>
              <Button variant="outline" size="sm" className="self-start" onClick={() => {
                setCreating(true);
                setNewCompany((n) => ({ ...n, name: query }));
              }}>
                <Plus /> Cadastrar nova empresa
              </Button>
            </div>
          )}

        <DialogFooter className="sm:justify-between">
          {target.company_id || target.kind !== "customer" ? (
            <Button variant="destructive-ghost" onClick={unlink} disabled={pending}>
              Remover vínculo
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending || !canSave}>
              {pending && <Loader2 className="animate-spin" />} Salvar vínculo
            </Button>
          </div>
        </DialogFooter>
    </>
  );
}
