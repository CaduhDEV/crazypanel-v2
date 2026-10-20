"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { crmConfigured } from "@/lib/crm";
import { syncContactFromCrm, type CrmContact } from "@/lib/crm-sync";

// A consulta de um lead só (ao abrir a conversa ou o perfil) é a rota
// POST /api/contacts/[id]/crm: como Server Action, ela travaria as outras ações.

// =============================================================================
// Varredura em lote (tela de Leads)
// =============================================================================
const BATCH = 25;
const CONCURRENCY = 5;

const scanSchema = z.object({
  /** Também reconsulta quem já foi consultado (para atualizar responsável e último contato). */
  retry: z.boolean().default(false),
  /** Início da varredura (ISO): quem foi consultado depois disso já passou. */
  since: z.iso.datetime(),
});

export interface CrmScanResult {
  processed: number;
  found: number;
  notFound: number;
  failed: number;
  remaining: number;
}

/** Processa um lote de contatos com telefone. O cliente chama até `remaining` zerar. */
export async function scanCrmBatch(input: z.input<typeof scanSchema>): Promise<ActionResult<CrmScanResult>> {
  return runAction(scanSchema, input, async ({ retry, since }) => {
    await requireAdmin();
    if (!crmConfigured()) throw new ActionError("Defina DATACRAZY_API_URL e DATACRAZY_API_KEY no .env.local para usar o CRM.");
    const db = createAdminClient();

    const pending = (head = false) => {
      const q = db
        .from("contacts")
        .select("id, phone, email, company_id", { count: "exact", head })
        .not("phone", "is", null);
      return retry ? q.or(`crm_checked_at.is.null,crm_checked_at.lt.${since}`) : q.is("crm_checked_at", null);
    };

    const { data: batch, error } = await pending()
      .order("crm_checked_at", { ascending: true, nullsFirst: true })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(BATCH);
    if (error) throw error;

    const rows = (batch ?? []) as CrmContact[];
    const result: CrmScanResult = { processed: 0, found: 0, notFound: 0, failed: 0, remaining: 0 };
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      await Promise.all(
        rows.slice(i, i + CONCURRENCY).map(async (c) => {
          try {
            const status = await syncContactFromCrm(db, c);
            result.processed += 1;
            if (status === "found") result.found += 1;
            else result.notFound += 1;
          } catch (e) {
            console.error(`[crm] contato ${c.id}:`, e);
            result.failed += 1;
          }
        }),
      );
    }

    const { count } = await pending(true);
    // Falhas não são marcadas; se o lote todo falhou, para o laço do cliente.
    result.remaining = rows.length > 0 && result.failed === rows.length ? 0 : (count ?? 0);
    if (result.found) revalidatePath("/leads");
    return result;
  });
}

/** Quantos contatos com telefone nunca foram consultados no CRM. */
export async function crmPendingCount(): Promise<ActionResult<{ pending: number; configured: boolean }>> {
  return runAction(z.object({}), {}, async () => {
    await requireAdmin();
    const { count } = await createAdminClient()
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .not("phone", "is", null)
      .is("crm_checked_at", null);
    return { pending: count ?? 0, configured: crmConfigured() };
  });
}
