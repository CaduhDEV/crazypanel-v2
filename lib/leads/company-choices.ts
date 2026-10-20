import { createAdminClient } from "@/lib/supabase/admin";

// Somente servidor (rota GET /api/contacts/[id]/companies).

export interface CompanyChoice {
  tenantId: string | null;
  companyId: string | null;
  name: string;
  cnpj: string | null;
  usersCount: number;
  lastActivityAt: string | null;
  isPrimary: boolean;
}

/** Empresas em que o lead aparece (tenants do Gleap pelo telefone + a vinculada). */
export async function loadCompanyChoices(contactId: string): Promise<CompanyChoice[]> {
  const { data, error } = await createAdminClient()
    .from("contact_company_options")
    .select("tenant_id, company_id, name, cnpj, users_count, last_activity_at, is_primary")
    .eq("contact_id", contactId);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      tenantId: (r.tenant_id as string | null) ?? null,
      companyId: (r.company_id as string | null) ?? null,
      name: r.name as string,
      cnpj: (r.cnpj as string | null) ?? null,
      usersCount: (r.users_count as number) ?? 0,
      lastActivityAt: (r.last_activity_at as string | null) ?? null,
      isPrimary: r.is_primary === true,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Date.parse(b.lastActivityAt ?? "") - Date.parse(a.lastActivityAt ?? "") || 0);
}
