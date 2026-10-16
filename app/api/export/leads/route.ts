import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { leadsQuery, parseLeadFilters } from "@/lib/leads/query";
import { csvDate, csvResponse, toCsv } from "@/lib/csv";
import { CONTACT_KIND_LABELS, type ContactKind } from "@/lib/types";

export const maxDuration = 120;

const PAGE = 1000;

type Row = {
  id: string;
  name: string | null;
  phone: string | null;
  lid: string | null;
  email: string | null;
  kind: ContactKind;
  crm_tax_id: string | null;
  crm_attendant_name: string | null;
  left_community_at: string | null;
  message_count: number;
  last_message_at: string | null;
  first_seen_at: string;
  company: { name: string; external_id: string | null; cnpj: string | null } | null;
  memberships: { group_jid: string; left_at: string | null }[];
};

// Exporta os leads com os mesmos filtros da tela (?q=&grupo=&vinculo=).
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const filters = parseLeadFilters({ q: sp.get("q"), grupo: sp.get("grupo"), vinculo: sp.get("vinculo") });
  const supabase = await createClient();

  const { data: groups } = await supabase.from("wa_groups").select("jid, name");
  const groupName = new Map((groups ?? []).map((g) => [g.jid as string, (g.name as string | null) ?? g.jid]));

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await leadsQuery(
      supabase,
      filters,
      "id, name, phone, lid, email, kind, crm_tax_id, crm_attendant_name, left_community_at, message_count, last_message_at, first_seen_at, company:companies(name, external_id, cnpj)",
    ).range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as unknown as Row[]));
    if ((data?.length ?? 0) < PAGE) break;
  }

  const csv = toCsv(
    [
      "Nome",
      "Telefone",
      "E-mail",
      "Tipo",
      "Empresa",
      "Tenant (CRM)",
      "CNPJ/CPF",
      "Responsável no CRM",
      "Grupos atuais",
      "Ex-membro desde",
      "Mensagens",
      "Última mensagem",
      "Na comunidade desde",
    ],
    rows.map((r) => [
      r.name,
      r.phone ?? (r.lid ? `@lid ${r.lid}` : ""),
      r.email,
      CONTACT_KIND_LABELS[r.kind],
      r.company?.name,
      r.company?.external_id,
      r.company?.cnpj ?? r.crm_tax_id,
      r.crm_attendant_name,
      r.memberships
        .filter((m) => !m.left_at)
        .map((m) => groupName.get(m.group_jid) ?? m.group_jid)
        .join(", "),
      csvDate(r.left_community_at),
      r.message_count,
      csvDate(r.last_message_at),
      csvDate(r.first_seen_at),
    ]),
  );
  return csvResponse(csv, "leads");
}
