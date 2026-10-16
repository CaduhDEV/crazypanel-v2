import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_SORTS, companiesQuery, type CompanySort } from "@/lib/leads/query";
import { csvDate, csvResponse, toCsv } from "@/lib/csv";

export const maxDuration = 300;

const PAGE = 1000;

type Row = {
  tenant_id: string | null;
  name: string;
  cnpj: string | null;
  niche: string | null;
  email: string | null;
  users_count: number;
  users_with_phone: number;
  users_in_community: number;
  leads_count: number;
  last_activity_at: string | null;
};

// Exporta as empresas com a mesma busca e ordem da tela (?q=&ordem=).
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim().slice(0, 80) ?? "";
  const sort = (COMPANY_SORTS.includes(sp.get("ordem") as CompanySort) ? sp.get("ordem") : "atividade") as CompanySort;
  const supabase = await createClient();

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await companiesQuery(supabase, q, sort).range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < PAGE) break;
  }

  const csv = toCsv(
    ["Empresa", "Tenant (CRM)", "CNPJ", "Nicho", "E-mail", "Usuários", "Usuários com telefone", "Na comunidade", "Leads vinculados", "Último acesso ao CRM"],
    rows.map((r) => [
      r.name,
      r.tenant_id,
      r.cnpj,
      r.niche,
      r.email,
      r.users_count,
      r.users_with_phone,
      r.users_in_community,
      r.leads_count,
      csvDate(r.last_activity_at),
    ]),
  );
  return csvResponse(csv, "empresas");
}
