import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { csvDate, csvResponse, toCsv } from "@/lib/csv";

export const maxDuration = 300;

const PAGE = 1000;

type Row = {
  user_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  phone_key: string | null;
  company_tenant_id: string | null;
  company_name: string | null;
  last_activity_at: string | null;
  gleap_created_at: string | null;
};

// Base de prospecção: todos os usuários do Gleap importados, com a indicação
// de quem já está em algum grupo (pelo telefone).
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });

  const supabase = await createClient();

  // Telefones (chave) de quem está ativo em algum grupo.
  const inGroups = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, phone_key, group_members!inner(left_at)")
      .not("phone_key", "is", null)
      .is("group_members.left_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const c of data ?? []) inGroups.add(c.phone_key as string);
    if ((data?.length ?? 0) < PAGE) break;
  }

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("gleap_leads")
      .select("user_id, name, email, phone, phone_key, company_tenant_id, company_name, last_activity_at, gleap_created_at")
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .order("user_id")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as Row[]));
    if ((data?.length ?? 0) < PAGE) break;
  }

  const csv = toCsv(
    ["Nome", "E-mail", "Telefone", "Telefone válido", "Empresa", "Tenant (CRM)", "Na comunidade", "Último acesso ao CRM", "Cadastro no Gleap", "ID no Gleap"],
    rows.map((r) => [
      r.name,
      r.email,
      r.phone?.replace(/\D/g, ""),
      r.phone_key ? "Sim" : "Não",
      r.company_name,
      r.company_tenant_id,
      r.phone_key ? (inGroups.has(r.phone_key) ? "Sim" : "Não") : "",
      csvDate(r.last_activity_at),
      csvDate(r.gleap_created_at),
      r.user_id,
    ]),
  );
  return csvResponse(csv, "base-gleap");
}
