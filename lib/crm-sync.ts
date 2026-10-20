import { createAdminClient } from "@/lib/supabase/admin";
import { crmConfigured, findCrmLeadByPhone } from "@/lib/crm";

// Somente servidor. Grava no contato o que o CRM sabe dele (pelo telefone).

type Admin = ReturnType<typeof createAdminClient>;

export type CrmContact = { id: string; phone: string; email: string | null; company_id: string | null };

/**
 * Consulta o CRM e atualiza o contato. Também preenche o CNPJ da empresa
 * vinculada quando ela ainda não tem. Lança se o CRM falhar (nada é gravado,
 * para o contato ser consultado de novo).
 */
export async function syncContactFromCrm(db: Admin, c: CrmContact): Promise<"found" | "not_found"> {
  const lead = await findCrmLeadByPhone(c.phone);
  const now = new Date().toISOString();
  const { error } = await db
    .from("contacts")
    .update(
      lead
        ? {
            crm_lead_id: lead.id,
            crm_tax_id: lead.taxId,
            crm_attendant_name: lead.attendantName,
            crm_last_received_at: lead.lastReceivedAt,
            crm_last_sent_at: lead.lastSentAt,
            crm_pending: lead.pending,
            crm_checked_at: now,
            email: c.email ?? lead.email,
          }
        : {
            crm_lead_id: null,
            crm_tax_id: null,
            crm_attendant_name: null,
            crm_last_received_at: null,
            crm_last_sent_at: null,
            crm_pending: null,
            crm_checked_at: now,
          },
    )
    .eq("id", c.id);
  if (error) throw error;

  if (lead?.taxId?.length === 14 && c.company_id) {
    await db.from("companies").update({ cnpj: lead.taxId }).eq("id", c.company_id).is("cnpj", null);
  }
  return lead ? "found" : "not_found";
}

const CACHE_MS = 10 * 60 * 1000;

/**
 * Atualiza os dados do lead no CRM (pelo telefone), com cache de 10 min.
 * Devolve false quando nada mudou (cache válido, sem telefone ou CRM não configurado).
 */
export async function refreshContactCrm(contactId: string, force: boolean): Promise<boolean> {
  if (!crmConfigured()) return false;
  const db = createAdminClient();
  const { data: c } = await db
    .from("contacts")
    .select("id, phone, email, company_id, crm_checked_at")
    .eq("id", contactId)
    .maybeSingle<CrmContact & { phone: string | null; crm_checked_at: string | null }>();
  if (!c?.phone) return false;
  if (!force && c.crm_checked_at && Date.now() - Date.parse(c.crm_checked_at) < CACHE_MS) return false;

  await syncContactFromCrm(db, c as CrmContact);
  return true;
}
