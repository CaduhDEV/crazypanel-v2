import { findGleapSessionsByEmail, gleapConfigured, updateGleapSessionPhone } from "@/lib/gleap";
import { crmConfigured, findCrmLeadByEmail, findCrmLeadByPhone } from "@/lib/crm";
import { logCommunityEvent, triageJoinRequest } from "@/lib/community/core";
import { e164, type Admin, type Verification } from "@/lib/verify/core";

// Somente servidor. Depois de e-mail e telefone verificados: rastreio do lead
// (Gleap + CRM), vínculo no painel e solicitação de entrada na comunidade.

export interface CompletionResult {
  status: string;
  company: string | null;
}

/** Empresa pelo tenant do CRM (external_id); cria se faltar. */
async function companyForTenant(db: Admin, tenantId: string, name: string | null): Promise<string | null> {
  const { data: existing } = await db.from("companies").select("id").eq("external_id", tenantId).maybeSingle();
  if (existing) return existing.id as string;
  await db.from("companies").upsert({ name: name || tenantId, external_id: tenantId }, { onConflict: "external_id", ignoreDuplicates: true });
  const { data } = await db.from("companies").select("id").eq("external_id", tenantId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function completeVerification(db: Admin, v: Verification): Promise<CompletionResult> {
  // Já concluída (o formulário pode reenviar o último passo): devolve o mesmo resultado.
  if (v.status === "completed" && v.join_request_id) {
    const { data } = await db.from("join_requests").select("status, company_name").eq("id", v.join_request_id).maybeSingle();
    return { status: (data?.status as string) ?? "pending", company: (data?.company_name as string | null) ?? null };
  }
  const phone = v.phone!;
  const notes: Record<string, unknown> = {};

  // 1) Gleap: todas as sessões desse e-mail recebem o telefone; o tenant vem da mais recente.
  let tenantId: string | null = null;
  let tenantName: string | null = null;
  let sessionsUpdated = 0;
  if (gleapConfigured()) {
    try {
      const sessions = await findGleapSessionsByEmail(v.email);
      for (const s of sessions) {
        try {
          await updateGleapSessionPhone(s.id, e164(phone));
          sessionsUpdated += 1;
        } catch (e) {
          notes.gleap_update_error = e instanceof Error ? e.message : String(e);
        }
      }
      const withCompany = sessions.find((s) => s.companyId);
      tenantId = withCompany?.companyId ?? null;
      tenantName = withCompany?.companyName ?? null;
      // Cópia local (base de prospecção / Empresas) já com o telefone.
      await db.from("gleap_leads").update({ phone: e164(phone) }).ilike("email", v.email);
    } catch (e) {
      notes.gleap_error = e instanceof Error ? e.message : String(e);
    }
  }

  // 2) CRM DataCrazy: pelo e-mail e, se não achar, pelo telefone.
  let crm: Awaited<ReturnType<typeof findCrmLeadByEmail>> = null;
  if (crmConfigured()) {
    crm = await findCrmLeadByEmail(v.email).catch(() => null);
    crm ??= await findCrmLeadByPhone(phone).catch(() => null);
  }

  // 3) Empresa (não é o lead: o lead só é criado quando um admin aceita a solicitação).
  const companyId = tenantId ? await companyForTenant(db, tenantId, tenantName) : null;
  if (companyId && crm?.taxId?.length === 14) {
    await db.from("companies").update({ cnpj: crm.taxId }).eq("id", companyId).is("cnpj", null);
  }
  const contactId: string | null = null;

  // 4) Solicitação de entrada, já verificada (a triagem completa o vínculo e confere se já é membro).
  const { data: request } = await db
    .from("join_requests")
    .insert({
      source: "form",
      form_source: "crazypanel-form",
      phone,
      email: v.email,
      name: v.name,
      contact_id: (contactId as string | null) ?? null,
      email_verified: true,
      phone_verified: true,
      verification_id: v.id,
      // Vínculo achado agora no Gleap/CRM: a triagem mantém e só completa o que faltar.
      company_id: companyId,
      company_name: tenantName,
      gleap_tenant_id: tenantId,
      crm_lead_id: crm?.id ?? null,
      crm_tax_id: crm?.taxId ?? null,
    })
    .select("id")
    .single();

  let status = "pending";
  let company: string | null = null;
  if (request) {
    await logCommunityEvent(db, {
      type: "request_created",
      request_id: request.id as string,
      contact_id: (contactId as string | null) ?? null,
      phone,
      name: v.name,
      data: { source: "form", form_source: "crazypanel-form", verified: true, email: v.email, gleap_sessions_updated: sessionsUpdated, ...notes },
    });
    status = await triageJoinRequest(db, request.id as string);
    const { data } = await db.from("join_requests").select("company_name").eq("id", request.id).maybeSingle();
    company = (data?.company_name as string | null) ?? tenantName;
  }

  await db
    .from("lead_verifications")
    .update({
      status: "completed",
      gleap_tenant_id: tenantId,
      gleap_sessions_updated: sessionsUpdated,
      crm_lead_id: crm?.id ?? null,
      join_request_id: (request?.id as string | undefined) ?? null,
    })
    .eq("id", v.id);

  return { status, company };
}
