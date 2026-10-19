import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { getUazapi } from "@/lib/uazapi/instance";
import { crmConfigured, findCrmLeadByPhone } from "@/lib/crm";
import { phoneKey } from "@/lib/gleap";

// Somente servidor. Entrada nas comunidades: triagem (vínculo), log e mensagens
// no privado. Usado pela rota do formulário, pela leitura dos pedidos do
// WhatsApp e pelas ações de aceitar/recusar.

export type Admin = ReturnType<typeof createAdminClient>;

/** Limite de participantes de um grupo do WhatsApp. */
export const GROUP_CAPACITY = 1024;

export type JoinStatus = "pending" | "accepted" | "invited" | "joined" | "rejected" | "expired" | "error";

export interface JoinRequestRow {
  id: string;
  source: "form" | "whatsapp";
  phone: string | null;
  lid: string | null;
  phone_key: string | null;
  email: string | null;
  name: string | null;
  group_jid: string | null;
  contact_id: string | null;
  link_status: "found" | "not_found" | "error" | null;
  company_id: string | null;
  company_name: string | null;
  gleap_tenant_id?: string | null;
  crm_lead_id?: string | null;
  crm_tax_id?: string | null;
  status: JoinStatus;
}

export type CommunityEventType =
  | "request_created"
  | "request_accepted"
  | "request_rejected"
  | "request_expired"
  | "invite_sent"
  | "add_failed"
  | "approve_failed"
  | "added_by_admin"
  | "invited_by_member"
  | "joined_via_link"
  | "left"
  | "removed"
  | "pv_sent"
  | "pv_failed";

export async function logCommunityEvent(
  db: Admin,
  ev: {
    type: CommunityEventType;
    group_jid?: string | null;
    contact_id?: string | null;
    phone?: string | null;
    name?: string | null;
    actor_profile_id?: string | null;
    actor_phone?: string | null;
    actor_name?: string | null;
    request_id?: string | null;
    data?: Record<string, unknown>;
  },
) {
  const { error } = await db.from("community_events").insert({ ...ev, data: ev.data ?? {} });
  if (error) console.error("[community] log falhou:", error.message);
}

/** Troca {nome}, {grupo}, {email}; variável sem valor vira texto neutro. */
export function fillJoinMessage(template: string, vars: { nome?: string | null; grupo?: string | null; email?: string | null }) {
  return template
    .replace(/\{nome\}/g, vars.nome?.trim() || "tudo bem")
    .replace(/\{grupo\}/g, vars.grupo?.trim() || "da comunidade")
    .replace(/\{email\}/g, vars.email?.trim() || "informado");
}

/** Mensagem no privado da pessoa; o resultado vai para o log. Nunca lança. */
export async function sendPrivate(db: Admin, req: Pick<JoinRequestRow, "id" | "phone" | "contact_id" | "name">, text: string, kind: string) {
  if (!req.phone) return;
  try {
    await (await getUazapi()).sendText({ number: req.phone, text });
    await logCommunityEvent(db, { type: "pv_sent", request_id: req.id, contact_id: req.contact_id, phone: req.phone, name: req.name, data: { kind } });
  } catch (e) {
    await logCommunityEvent(db, {
      type: "pv_failed",
      request_id: req.id,
      contact_id: req.contact_id,
      phone: req.phone,
      name: req.name,
      data: { kind, error: e instanceof Error ? e.message : String(e) },
    });
  }
}

export interface CommunityGroup {
  jid: string;
  name: string;
}

/** Grupos da comunidade: os escutados, sem os de parceiros. */
export async function communityGroups(db: Admin): Promise<CommunityGroup[]> {
  // "*": is_partner_group pode não existir antes da migration dos parceiros.
  const { data } = await db.from("wa_groups").select("*").eq("listening", true).order("name");
  return ((data ?? []) as { jid: string; name: string | null; is_partner_group?: boolean }[])
    .filter((g) => !g.is_partner_group)
    .map((g) => ({ jid: g.jid, name: g.name ?? g.jid }));
}

/**
 * Triagem: liga o pedido ao lead, procura vínculo (empresa do lead, Gleap pelo
 * telefone/e-mail, CRM pelo telefone) e confere se já está na comunidade.
 * Sem vínculo e vindo do formulário, avisa no privado.
 */
export async function triageJoinRequest(db: Admin, id: string): Promise<JoinStatus> {
  const { data: req } = await db.from("join_requests").select("*").eq("id", id).maybeSingle<JoinRequestRow>();
  if (!req) return "error";

  try {
    // 1) Lead já existente (o lead só é CRIADO quando um admin aceita a solicitação).
    let contactId = req.contact_id;
    if (!contactId && (req.phone || req.lid)) {
      const key = req.phone ? phoneKey(req.phone) : null;
      const filters = [key && `phone_key.eq.${key}`, req.lid && `lid.eq.${req.lid}`].filter(Boolean).join(",");
      const { data } = filters ? await db.from("contacts").select("id").or(filters).limit(1).maybeSingle() : { data: null };
      contactId = (data?.id as string | undefined) ?? null;
    }
    const { data: contact } = contactId
      ? await db.from("contacts").select("id, name, email, company:companies(id, name, external_id)").eq("id", contactId).maybeSingle()
      : { data: null };
    const linked = (contact?.company ?? null) as unknown as { id: string; name: string; external_id: string | null } | null;

    // 2) Gleap: telefone e e-mail (muitos cadastros têm só um dos dois).
    const key = req.phone_key ?? (req.phone ? phoneKey(req.phone) : null);
    const emails = [req.email, (contact?.email as string | null) ?? null].filter(Boolean).map((e) => e!.toLowerCase());
    // Valores entre aspas: e-mail pode ter "+" e outros caracteres especiais do filtro.
    const filters = [key && `phone_key.eq.${key}`, ...emails.map((e) => `email.eq."${e.replace(/"/g, "")}"`)].filter(Boolean).join(",");
    const { data: gleap } = filters
      ? await db
          .from("gleap_leads")
          .select("company_tenant_id, company_name, name, last_activity_at")
          .or(filters)
          .not("company_tenant_id", "is", null)
          .order("last_activity_at", { ascending: false, nullsFirst: false })
          .limit(10)
      : { data: [] };
    const tenant = (gleap ?? [])[0] as { company_tenant_id: string; company_name: string | null; name: string | null } | undefined;

    // 3) CRM DataCrazy pelo telefone.
    let crm: Awaited<ReturnType<typeof findCrmLeadByPhone>> = null;
    if (req.phone && crmConfigured()) crm = await findCrmLeadByPhone(req.phone).catch(() => null);

    let companyId = linked?.id ?? null;
    if (!companyId && tenant) {
      const { data: co } = await db.from("companies").select("id").eq("external_id", tenant.company_tenant_id).maybeSingle();
      companyId = (co?.id as string | undefined) ?? null;
    }
    // O que já veio na solicitação (ex.: formulário verificado, que consulta o Gleap/CRM ao vivo) vale onde a busca local não achar.
    const found = !!(linked || tenant || crm || req.company_id || req.gleap_tenant_id || req.crm_lead_id);

    // 4) Já está em algum grupo da comunidade?
    let status: JoinStatus = req.status;
    if (contactId) {
      const groups = await communityGroups(db);
      const { count } = await db
        .from("group_members")
        .select("contact_id", { count: "exact", head: true })
        .eq("contact_id", contactId)
        .is("left_at", null)
        .in("group_jid", groups.map((g) => g.jid).concat("-"));
      if (count) status = "joined";
    }

    await db
      .from("join_requests")
      .update({
        contact_id: contactId,
        name: req.name ?? tenant?.name ?? crm?.name ?? (contact?.name as string | null) ?? null,
        link_status: found ? "found" : "not_found",
        company_id: companyId ?? req.company_id,
        company_name: linked?.name ?? tenant?.company_name ?? req.company_name ?? null,
        gleap_tenant_id: linked?.external_id ?? tenant?.company_tenant_id ?? req.gleap_tenant_id ?? null,
        crm_lead_id: crm?.id ?? req.crm_lead_id ?? null,
        crm_tax_id: crm?.taxId ?? req.crm_tax_id ?? null,
        status,
        error: null,
      })
      .eq("id", id);

    if (!found && req.source === "form" && status === "pending") {
      const settings = await getSettings();
      await sendPrivate(db, { ...req, contact_id: contactId }, fillJoinMessage(settings.join_msg_no_company, { nome: req.name, email: req.email }), "no_company");
    }
    return status;
  } catch (e) {
    await db
      .from("join_requests")
      .update({ link_status: "error", error: e instanceof Error ? e.message : String(e) })
      .eq("id", id);
    return req.status;
  }
}
