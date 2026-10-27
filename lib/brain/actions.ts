"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { brainConfigured, dispatchBrain, type BrainDispatch } from "@/lib/brain/core";

// Cérebro (admin): revisar os itens que a IA montou e ligar a leitura.

const id = z.uuid();

function done() {
  revalidatePath("/cerebro");
}

const statusSchema = z.object({ id, status: z.enum(["draft", "approved", "archived"]) });

export async function setBrainStatus(input: z.input<typeof statusSchema>): Promise<ActionResult<void>> {
  return runAction(statusSchema, input, async ({ id: itemId, status }) => {
    const admin = await requireAdmin();
    const { error } = await createAdminClient()
      .from("brain_items")
      .update({ status, reviewed_by: admin.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", itemId);
    if (error) throw error;
    done();
  });
}

const editSchema = z.object({
  id,
  question: z.string().trim().min(3, { error: "Escreva a pergunta." }).max(500),
  answer: z.string().trim().min(3, { error: "Escreva a resposta." }).max(4000),
  approve: z.boolean().default(true),
});

/** Edição do admin: a resposta antiga vai para o histórico; respostas novas da IA viram sugestão. */
export async function editBrainItem(input: z.input<typeof editSchema>): Promise<ActionResult<void>> {
  return runAction(editSchema, input, async ({ id: itemId, question, answer, approve }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const { data: item } = await db.from("brain_items").select("answer, status").eq("id", itemId).maybeSingle<{ answer: string; status: string }>();
    if (!item) throw new ActionError("Item não encontrado.");
    const now = new Date().toISOString();
    if (item.answer !== answer) await db.from("brain_item_versions").insert({ item_id: itemId, answer: item.answer, valid_until: now, changed_by: admin.id });
    const { error } = await db
      .from("brain_items")
      .update({
        question,
        answer,
        edited: true,
        ...(item.answer !== answer ? { answer_changed_at: now } : {}),
        status: approve ? "approved" : item.status,
        reviewed_by: admin.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq("id", itemId);
    if (error) throw error;
    done();
  });
}

const proposalSchema = z.object({ id, accept: z.boolean() });

/** Resposta nova sugerida pela IA num item revisado: aceitar (vira a resposta) ou manter a atual. */
export async function resolveBrainProposal(input: z.input<typeof proposalSchema>): Promise<ActionResult<void>> {
  return runAction(proposalSchema, input, async ({ id: itemId, accept }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const { data: item } = await db
      .from("brain_items")
      .select("answer, proposed_answer, proposed_at, proposed_ticket_id")
      .eq("id", itemId)
      .maybeSingle<{ answer: string; proposed_answer: string | null; proposed_at: string | null; proposed_ticket_id: string | null }>();
    if (!item?.proposed_answer) throw new ActionError("Não há resposta nova para este item.");
    const now = new Date().toISOString();
    if (accept) {
      await db.from("brain_item_versions").insert({ item_id: itemId, answer: item.answer, valid_until: item.proposed_at ?? now, ticket_id: item.proposed_ticket_id, changed_by: admin.id });
    }
    const { error } = await db
      .from("brain_items")
      .update({
        ...(accept ? { answer: item.proposed_answer, answer_changed_at: item.proposed_at ?? now } : {}),
        proposed_answer: null,
        proposed_at: null,
        proposed_ticket_id: null,
        reviewed_by: admin.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq("id", itemId);
    if (error) throw error;
    done();
  });
}

export interface BrainSourceRow {
  ticket_id: string;
  seen_at: string;
  action: "new" | "same" | "update";
  answer: string | null;
  ticket: { number: number } | null;
}

export interface BrainVersionRow {
  id: number;
  answer: string;
  valid_until: string;
  changer: { name: string } | null;
}

/** Linha do tempo do item: atendimentos que o confirmaram e respostas anteriores. */
export async function listBrainHistory(input: { id: string }): Promise<ActionResult<{ sources: BrainSourceRow[]; versions: BrainVersionRow[] }>> {
  return runAction(z.object({ id }), input, async ({ id: itemId }) => {
    await requireAdmin();
    const db = createAdminClient();
    const [sources, versions] = await Promise.all([
      db.from("brain_sources").select("ticket_id, seen_at, action, answer, ticket:tickets(number)").eq("item_id", itemId).order("seen_at", { ascending: false }).limit(100),
      db.from("brain_item_versions").select("id, answer, valid_until, changer:profiles(name)").eq("item_id", itemId).order("valid_until", { ascending: false }).limit(30),
    ]);
    if (sources.error) throw sources.error;
    return { sources: (sources.data ?? []) as unknown as BrainSourceRow[], versions: (versions.data ?? []) as unknown as BrainVersionRow[] };
  });
}

/** Liga ou desliga a leitura automática dos atendimentos resolvidos. */
export async function setBrainEnabled(input: { enabled: boolean }): Promise<ActionResult<void>> {
  return runAction(z.object({ enabled: z.boolean() }), input, async ({ enabled }) => {
    const admin = await requireAdmin();
    const { error } = await createAdminClient().from("app_settings").update({ brain_enabled: enabled, updated_by: admin.id }).eq("id", 1);
    if (error) {
      if (/brain_enabled/.test(error.message)) throw new ActionError("Rode as migrations novas (npx supabase db push) antes de ligar.");
      throw error;
    }
    revalidatePath("/", "layout");
  });
}

/** Manda o próximo lote agora (sem esperar a rotina). */
export async function runBrainNow(): Promise<ActionResult<BrainDispatch>> {
  return runAction(z.object({}), {}, async () => {
    await requireAdmin();
    if (!brainConfigured()) throw new ActionError("Falta configurar AI_BRAIN_WEBHOOK_URL nas variáveis do painel.");
    const res = await dispatchBrain();
    done();
    return res;
  });
}
