import type { createClient } from "@/lib/supabase/server";
import { KINDS_NEEDING_COMPANY } from "@/lib/types";

// Filtros da tela de Leads, compartilhados com a exportação em CSV.

export type LinkFilter = "todos" | "sem-vinculo" | "vinculados" | "varias-empresas" | "parceiros" | "equipe" | "ex-membros";
export const LINK_FILTERS: LinkFilter[] = ["todos", "sem-vinculo", "vinculados", "varias-empresas", "parceiros", "equipe", "ex-membros"];

/** Moderação: com flag, sem flag ou inaptos (no limite de flags). */
export type FlagFilter = "" | "com" | "sem" | "inaptos";
const FLAG_FILTERS: FlagFilter[] = ["com", "sem", "inaptos"];

export interface LeadFilters {
  q: string;
  group: string;
  link: LinkFilter;
  flags: FlagFilter;
  /** Flags para ficar inapto (Configurações → Moderação). */
  flagLimit: number;
}

export function parseLeadFilters(
  params: { q?: string | null; grupo?: string | null; vinculo?: string | null; flags?: string | null },
  flagLimit = 3,
): LeadFilters {
  return {
    q: params.q?.trim().slice(0, 80) ?? "",
    group: params.grupo?.endsWith("@g.us") ? params.grupo : "",
    link: (LINK_FILTERS.includes(params.vinculo as LinkFilter) ? params.vinculo : "todos") as LinkFilter,
    flags: (FLAG_FILTERS.includes(params.flags as FlagFilter) ? params.flags : "") as FlagFilter,
    flagLimit,
  };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Consulta de contatos com os filtros aplicados. `columns` não inclui os
 * vínculos de grupo: eles entram aqui como `memberships` (inner join quando
 * há filtro de grupo).
 */
export function leadsQuery(supabase: Supabase, f: LeadFilters, columns: string, opts: { count?: boolean } = {}) {
  const membership = f.group ? "memberships:group_members!inner(group_jid, left_at)" : "memberships:group_members(group_jid, left_at)";
  let query = supabase.from("contacts").select(`${columns}, ${membership}`, opts.count ? { count: "exact" } : undefined);

  if (f.group) query = query.eq("memberships.group_jid", f.group).is("memberships.left_at", null);
  if (f.link === "sem-vinculo") query = query.in("kind", KINDS_NEEDING_COMPANY).is("company_id", null);
  if (f.link === "vinculados") query = query.not("company_id", "is", null);
  if (f.link === "parceiros") query = query.eq("kind", "partner");
  if (f.link === "equipe") query = query.eq("kind", "team");
  if (f.link === "ex-membros") query = query.not("left_community_at", "is", null);
  if (f.link === "varias-empresas") query = query.gt("companies_count", 1);
  if (f.flags === "com") query = query.gt("strikes", 0);
  if (f.flags === "sem") query = query.eq("strikes", 0);
  if (f.flags === "inaptos") query = query.gte("strikes", f.flagLimit);
  if (f.q) {
    const term = f.q.replace(/[%,()]/g, " ");
    const digits = f.q.replace(/\D/g, "");
    query = query.or(
      [`name.ilike.%${term}%`, digits.length >= 3 && `phone.ilike.%${digits}%`, digits.length >= 3 && `lid.ilike.%${digits}%`]
        .filter(Boolean)
        .join(","),
    );
  }
  return query.order("last_message_at", { ascending: false, nullsFirst: false }).order("first_seen_at", { ascending: false }).order("id");
}

// -----------------------------------------------------------------------------
// Para convidar (view gleap_invite_candidates)
// -----------------------------------------------------------------------------
export const INVITE_COLUMNS = "phone_key, user_id, name, email, phone, company_tenant_id, company_name, last_activity_at";

export function invitesQuery(supabase: Supabase, q: string, opts: { count?: boolean } = {}) {
  let query = supabase.from("gleap_invite_candidates").select(INVITE_COLUMNS, opts.count ? { count: "exact" } : undefined);
  if (q) {
    const term = q.replace(/[%,()]/g, " ");
    const digits = q.replace(/\D/g, "");
    query = query.or(
      [`name.ilike.%${term}%`, `email.ilike.%${term}%`, `company_name.ilike.%${term}%`, digits.length >= 3 && `phone.ilike.%${digits}%`]
        .filter(Boolean)
        .join(","),
    );
  }
  return query.order("last_activity_at", { ascending: false, nullsFirst: false }).order("phone_key");
}

// -----------------------------------------------------------------------------
// Empresas (view b2b_companies)
// -----------------------------------------------------------------------------
export const COMPANY_COLUMNS =
  "tenant_id, company_id, name, cnpj, image_url, niche, email, users_count, users_with_phone, users_in_community, leads_count, last_activity_at";

export type CompanySort = "atividade" | "usuarios" | "nome";
export const COMPANY_SORTS: CompanySort[] = ["atividade", "usuarios", "nome"];

export function companiesQuery(supabase: Supabase, q: string, sort: CompanySort, opts: { count?: boolean } = {}) {
  let query = supabase.from("b2b_companies").select(COMPANY_COLUMNS, opts.count ? { count: "exact" } : undefined);
  if (q) {
    const term = q.replace(/[%,()]/g, " ");
    const digits = q.replace(/\D/g, "");
    query = query.or(
      [`name.ilike.%${term}%`, `tenant_id.ilike.%${term}%`, digits.length >= 3 && `cnpj.ilike.%${digits}%`].filter(Boolean).join(","),
    );
  }
  if (sort === "nome") query = query.order("name");
  else if (sort === "usuarios") query = query.order("users_count", { ascending: false }).order("name");
  else query = query.order("last_activity_at", { ascending: false, nullsFirst: false }).order("name");
  return query.order("tenant_id", { nullsFirst: false });
}
