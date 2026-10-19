"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";

const searchSchema = z.object({ query: z.string().trim().max(100), contactId: z.uuid().optional() });

/** Empresa para o vínculo: um tenant do CRM (base de Empresas), cadastrado aqui ou não. */
export interface CompanyOption {
  companyId: string | null;
  tenantId: string | null;
  name: string;
  cnpj: string | null;
  usersCount: number;
  /** O telefone do lead aparece nesse tenant no Gleap. */
  suggested: boolean;
}

/**
 * Busca empresas na mesma base da página Empresas (todos os tenants do Gleap +
 * as cadastradas aqui). Sem busca e com contactId, sugere primeiro os tenants
 * em que o telefone do lead aparece no Gleap.
 */
export async function searchCompanies(input: z.input<typeof searchSchema>): Promise<ActionResult<CompanyOption[]>> {
  return runAction(searchSchema, input, async ({ query, contactId }) => {
    await requireMember();
    const db = createAdminClient();
    type Row = { company_id: string | null; tenant_id: string | null; name: string; cnpj: string | null; users_count: number };
    const toOption = (r: Row, suggested: boolean): CompanyOption => ({
      companyId: r.company_id,
      tenantId: r.tenant_id,
      name: r.name,
      cnpj: r.cnpj,
      usersCount: r.users_count,
      suggested,
    });

    // Sugestões: tenants do Gleap com o mesmo telefone ou o mesmo e-mail (o do
    // lead e os dos cadastros que batem pelo telefone; muitos não têm telefone).
    let suggestedTenants: string[] = [];
    if (contactId) {
      const { data: c } = await db
        .from("contacts")
        .select("phone_key, email")
        .eq("id", contactId)
        .maybeSingle<{ phone_key: string | null; email: string | null }>();
      const tenants = new Set<string>();
      const emails = new Set<string>(c?.email ? [c.email.toLowerCase()] : []);
      if (c?.phone_key) {
        const { data: g } = await db.from("gleap_leads").select("company_tenant_id, email").eq("phone_key", c.phone_key).limit(50);
        for (const r of g ?? []) {
          if (r.company_tenant_id) tenants.add(r.company_tenant_id as string);
          if (r.email) emails.add((r.email as string).toLowerCase());
        }
      }
      if (emails.size) {
        const { data: g } = await db.from("gleap_leads").select("company_tenant_id").in("email", [...emails]).not("company_tenant_id", "is", null).limit(50);
        for (const r of g ?? []) tenants.add(r.company_tenant_id as string);
      }
      suggestedTenants = [...tenants];
    }

    let q = db.from("b2b_companies").select("company_id, tenant_id, name, cnpj, users_count").limit(30);
    if (query) {
      const term = query.replace(/[%,()]/g, " ");
      const digits = query.replace(/D/g, "");
      q = q.or([`name.ilike.%${term}%`, `tenant_id.ilike.%${term}%`, digits.length >= 3 && `cnpj.ilike.%${digits}%`].filter(Boolean).join(","));
    }
    const { data, error } = await q.order("users_count", { ascending: false }).order("name");
    if (error) throw error;
    const rows = (data ?? []) as Row[];

    let suggested: CompanyOption[] = [];
    if (suggestedTenants.length && !query) {
      const { data: s } = await db.from("b2b_companies").select("company_id, tenant_id, name, cnpj, users_count").in("tenant_id", suggestedTenants);
      suggested = ((s ?? []) as Row[]).map((r) => toOption(r, true));
    }
    const seen = new Set(suggested.map((o) => o.tenantId ?? o.companyId));
    return [
      ...suggested,
      ...rows.filter((r) => !seen.has(r.tenant_id ?? r.company_id)).map((r) => toOption(r, suggestedTenants.includes(r.tenant_id ?? ""))),
    ];
  });
}

const linkSchema = z.object({
    contactId: z.uuid(),
    kind: z.enum(["customer", "partner", "team"]),
    companyId: z.uuid().optional(),
    /** Tenant da base de Empresas ainda não cadastrado aqui: a empresa é criada no vínculo. */
    tenant: z.object({ id: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200) }).optional(),
    newCompany: z
      .object({
        name: z.string().trim().min(2, { error: "Informe o nome da empresa." }).max(120),
        externalId: z.string().trim().max(80).optional(),
        email: z.union([z.email({ error: "E-mail inválido." }), z.literal("")]).optional(),
      })
      .optional(),
});

/**
 * Vincula um lead: tipo (cliente, parceiro ou equipe) e empresa. Cliente exige
 * empresa; parceiro e equipe podem ter a própria conta no CRM, então a empresa
 * é opcional para eles (sem ela, fica sem vínculo). Equipe não abre atendimentos.
 */
export async function linkContact(input: z.input<typeof linkSchema>): Promise<ActionResult<void>> {
  return runAction(linkSchema, input, async (data) => {
    const admin = await requireAdmin();
    const db = createAdminClient();

    let companyId: string | null = null;
    {
      if (data.companyId) {
        companyId = data.companyId;
      } else if (data.tenant) {
        const { data: existing } = await db.from("companies").select("id").eq("external_id", data.tenant.id).maybeSingle();
        if (existing) companyId = existing.id as string;
        else {
          const { error: insertError } = await db
            .from("companies")
            .upsert({ name: data.tenant.name, external_id: data.tenant.id, created_by: admin.id }, { onConflict: "external_id", ignoreDuplicates: true });
          if (insertError) throw insertError;
          const { data: created, error } = await db.from("companies").select("id").eq("external_id", data.tenant.id).single();
          if (error) throw error;
          companyId = created.id as string;
        }
      } else if (data.newCompany) {
        const externalId = data.newCompany.externalId || null;
        if (externalId) {
          const { data: existing } = await db.from("companies").select("id").eq("external_id", externalId).maybeSingle();
          if (existing) throw new ActionError("Já existe uma empresa com esse ID do CRM. Selecione-a na busca.");
        }
        const { data: created, error } = await db
          .from("companies")
          .insert({ name: data.newCompany.name, external_id: externalId, email: data.newCompany.email || null, created_by: admin.id })
          .select("id")
          .single();
        if (error) throw error;
        companyId = created.id as string;
      } else if (data.kind === "customer") {
        throw new ActionError("Selecione ou cadastre a empresa.");
      }
    }

    const { error } = await db
      .from("contacts")
      .update({
        kind: data.kind,
        company_id: companyId,
        linked_at: new Date().toISOString(),
        linked_by: admin.id,
      })
      .eq("id", data.contactId);
    if (error) throw error;
    await db.rpc("refresh_contact_companies_count", { p_contact_id: data.contactId });
    revalidatePath("/leads");
  });
}

const contactIdSchema = z.object({ contactId: z.uuid() });

export async function unlinkContact(input: z.input<typeof contactIdSchema>): Promise<ActionResult<void>> {
  return runAction(contactIdSchema, input, async ({ contactId }) => {
    await requireAdmin();
    const { error } = await createAdminClient()
      .from("contacts")
      .update({ kind: "customer", company_id: null, linked_at: null, linked_by: null })
      .eq("id", contactId);
    if (error) throw error;
    await createAdminClient().rpc("refresh_contact_companies_count", { p_contact_id: contactId });
    revalidatePath("/leads");
  });
}

const notesSchema = z.object({ contactId: z.uuid(), name: z.string().trim().max(120).optional(), notes: z.string().trim().max(2000) });

export async function updateContactNotes(input: z.input<typeof notesSchema>): Promise<ActionResult<void>> {
  return runAction(notesSchema, input, async ({ contactId, name, notes }) => {
    await requireMember();
    const patch: Record<string, unknown> = { notes: notes || null };
    if (name !== undefined) patch.name = name || null;
    const { error } = await createAdminClient().from("contacts").update(patch).eq("id", contactId);
    if (error) throw error;
  });
}

// =============================================================================
// Leads em mais de uma empresa
// =============================================================================
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
export async function listCompanyChoices(input: z.input<typeof contactIdSchema>): Promise<ActionResult<CompanyChoice[]>> {
  return runAction(contactIdSchema, input, async ({ contactId }) => {
    await requireMember();
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
  });
}

const primarySchema = z.object({
  contactId: z.uuid(),
  companyId: z.uuid().optional(),
  tenant: z.object({ id: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200) }).optional(),
});

/** Define a empresa principal do lead (a vinculada). Não muda o tipo dele. */
export async function setPrimaryCompany(input: z.input<typeof primarySchema>): Promise<ActionResult<void>> {
  return runAction(primarySchema, input, async ({ contactId, companyId, tenant }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    let id = companyId ?? null;
    if (!id && tenant) {
      const { data: existing } = await db.from("companies").select("id").eq("external_id", tenant.id).maybeSingle();
      if (existing) id = existing.id as string;
      else {
        const { error } = await db
          .from("companies")
          .upsert({ name: tenant.name, external_id: tenant.id, created_by: admin.id }, { onConflict: "external_id", ignoreDuplicates: true });
        if (error) throw error;
        const { data: created, error: readError } = await db.from("companies").select("id").eq("external_id", tenant.id).single();
        if (readError) throw readError;
        id = created.id as string;
      }
    }
    if (!id) throw new ActionError("Escolha a empresa.");

    const { error } = await db
      .from("contacts")
      .update({ company_id: id, linked_at: new Date().toISOString(), linked_by: admin.id })
      .eq("id", contactId);
    if (error) throw error;
    await db.rpc("refresh_contact_companies_count", { p_contact_id: contactId });
    revalidatePath("/leads");
  });
}

// =============================================================================
// Excluir lead
// =============================================================================
export interface ContactDeletionImpact {
  tickets: number;
  messages: number;
  groups: number;
}

/** O que vai junto ao excluir o lead (para a confirmação). */
export async function getContactDeletionImpact(input: z.input<typeof contactIdSchema>): Promise<ActionResult<ContactDeletionImpact>> {
  return runAction(contactIdSchema, input, async ({ contactId }) => {
    await requireAdmin();
    const { data, error } = await createAdminClient().rpc("contact_deletion_impact", { p_contact_id: contactId });
    if (error) throw error;
    return data as ContactDeletionImpact;
  });
}

/** Exclui o lead e os atendimentos em que ele é o principal. Não dá para desfazer. */
export async function deleteContact(input: z.input<typeof contactIdSchema>): Promise<ActionResult<ContactDeletionImpact>> {
  return runAction(contactIdSchema, input, async ({ contactId }) => {
    await requireAdmin();
    const { data, error } = await createAdminClient().rpc("delete_contact", { p_contact_id: contactId });
    if (error) {
      if (error.code === "P0002") throw new ActionError("Lead não encontrado (talvez já tenha sido excluído).");
      throw error;
    }
    revalidatePath("/leads");
    revalidatePath("/atendimento");
    return data as ContactDeletionImpact;
  });
}
