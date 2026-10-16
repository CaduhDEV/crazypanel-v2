import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { invitesQuery } from "@/lib/leads/query";
import { csvDate, csvResponse, toCsv } from "@/lib/csv";

export const maxDuration = 120;

const PAGE = 1000;

type Row = {
  name: string | null;
  email: string | null;
  phone: string | null;
  company_tenant_id: string | null;
  company_name: string | null;
  last_activity_at: string | null;
};

// Exporta a lista "Para convidar" com a mesma busca da tela (?q=).
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });

  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 80) ?? "";
  const supabase = await createClient();

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await invitesQuery(supabase, q).range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < PAGE) break;
  }

  const csv = toCsv(
    ["Nome", "E-mail", "Telefone", "Empresa", "Tenant (CRM)", "Último acesso ao CRM"],
    rows.map((r) => [r.name, r.email, r.phone?.replace(/\D/g, ""), r.company_name, r.company_tenant_id, csvDate(r.last_activity_at)]),
  );
  return csvResponse(csv, "para-convidar");
}
