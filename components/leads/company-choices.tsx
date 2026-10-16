"use client";

import { useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { listCompanyChoices, setPrimaryCompany, type CompanyChoice } from "@/lib/leads/actions";
import { cn, formatRelative, formatTaxId } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { useApp } from "@/components/app/app-context";

export const companyChoicesKey = (contactId: string) => ["company-choices", contactId] as const;

/**
 * Empresas em que o lead aparece. Com mais de uma, o admin escolhe a principal
 * (a que vale para o vínculo). `onlyWhenMultiple` esconde quando há só uma.
 */
export function CompanyChoices({
  contactId,
  onlyWhenMultiple = false,
  onChanged,
}: {
  contactId: string;
  onlyWhenMultiple?: boolean;
  onChanged?: () => void;
}) {
  const { isAdmin } = useApp();
  const queryClient = useQueryClient();
  const [pending, start] = useTransition();
  const { data, isLoading } = useQuery({
    queryKey: companyChoicesKey(contactId),
    queryFn: async () => {
      const res = await listCompanyChoices({ contactId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });

  if (isLoading) return onlyWhenMultiple ? null : <Skeleton className="h-16" />;
  const choices = data ?? [];
  if (choices.length === 0 || (onlyWhenMultiple && choices.length < 2)) return null;

  const makePrimary = (c: CompanyChoice) =>
    start(async () => {
      const res = await setPrimaryCompany(
        c.companyId ? { contactId, companyId: c.companyId } : { contactId, tenant: { id: c.tenantId!, name: c.name } },
      );
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${c.name} agora é a empresa principal.`);
      await queryClient.invalidateQueries({ queryKey: companyChoicesKey(contactId) });
      onChanged?.();
    });

  const noPrimary = !choices.some((c) => c.isPrimary);

  return (
    <div className="flex flex-col gap-2">
      {choices.length > 1 && (
        <p className="text-xs text-muted-foreground">
          O telefone aparece em {choices.length} empresas.{" "}
          {noPrimary ? "Escolha a principal para vincular o lead." : isAdmin ? "Dá para trocar a principal." : ""}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {choices.map((c) => (
          <li
            key={c.tenantId ?? c.companyId ?? c.name}
            className={cn(
              "flex items-center gap-2.5 rounded-md border p-2",
              c.isPrimary ? "border-primary/40 bg-primary-soft/50" : "border-border",
            )}
          >
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{c.name}</span>
                {c.isPrimary && (
                  <Badge variant="primary">
                    <Star className="size-3" /> Principal
                  </Badge>
                )}
              </span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {[c.tenantId, c.cnpj && formatTaxId(c.cnpj), c.lastActivityAt && `acessou ${formatRelative(c.lastActivityAt)}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {!c.isPrimary && isAdmin && (c.companyId || c.tenantId) && (
              <Button variant="outline" size="sm" onClick={() => makePrimary(c)} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <Star />} Tornar principal
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
