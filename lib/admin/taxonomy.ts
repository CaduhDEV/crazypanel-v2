"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { slugKey } from "@/lib/taxonomy";

// Categorias e subcategorias (Configurações). A chave é fixa (é o que fica
// gravado nos atendimentos); o nome pode mudar. O que já foi usado não é
// apagado: é arquivado (some das opções, o histórico continua com o nome).

const label = z
  .string()
  .trim()
  .min(2, { error: "O nome precisa de pelo menos 2 letras." })
  .max(40, { error: "Use até 40 letras." });
const key = z.string().regex(/^[a-z0-9_]{2,40}$/, { error: "Item inválido." });

type Db = ReturnType<typeof createAdminClient>;

/** Chave livre a partir do nome (agentes_ia, agentes_ia_2…), olhando as duas tabelas. */
async function freeKey(db: Db, name: string): Promise<string> {
  const base = slugKey(name).replace(/^(.)$/, "$1_");
  const [{ data: cats }, { data: tops }] = await Promise.all([
    db.from("ticket_categories").select("key").like("key", `${base}%`),
    db.from("ticket_topics").select("key").like("key", `${base}%`),
  ]);
  const taken = new Set([...(cats ?? []), ...(tops ?? [])].map((r) => r.key as string));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

const sameName = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }) === 0;

async function assertCategoryName(db: Db, name: string, except?: string) {
  const { data } = await db.from("ticket_categories").select("key, label").is("archived_at", null);
  if ((data ?? []).some((c) => c.key !== except && sameName(c.label, name))) throw new ActionError(`Já existe a categoria “${name}”.`);
}

async function assertTopicName(db: Db, category: string, name: string, except?: string) {
  const { data } = await db.from("ticket_topics").select("key, label").eq("category_key", category).is("archived_at", null);
  if ((data ?? []).some((t) => t.key !== except && sameName(t.label, name))) throw new ActionError(`Essa categoria já tem a subcategoria “${name}”.`);
}

async function nextPosition(db: Db, table: "ticket_categories" | "ticket_topics", category?: string): Promise<number> {
  let q = db.from(table).select("position").order("position", { ascending: false }).limit(1);
  if (category) q = q.eq("category_key", category);
  const { data } = await q;
  return ((data?.[0]?.position as number | undefined) ?? 0) + 1;
}

function done() {
  // As opções vêm do layout (contexto do app): todas as telas recebem a lista nova.
  revalidatePath("/", "layout");
}

// --- Categorias -------------------------------------------------------------

const createCategorySchema = z.object({ label, firstTopic: label });

/** Categoria nova já com a primeira subcategoria (ao finalizar, a subcategoria é obrigatória). */
export async function createCategory(input: z.input<typeof createCategorySchema>): Promise<ActionResult<void>> {
  return runAction(createCategorySchema, input, async ({ label: name, firstTopic }) => {
    await requireAdmin();
    const db = createAdminClient();
    await assertCategoryName(db, name);
    // Mesmo nome de uma arquivada: volta a mesma, com a subcategoria pedida.
    const { data: archived } = await db.from("ticket_categories").select("key, label").not("archived_at", "is", null);
    const again = (archived ?? []).find((c) => sameName(c.label, name));
    if (again) {
      const { error } = await db.from("ticket_categories").update({ archived_at: null, label: name }).eq("key", again.key);
      if (error) throw error;
      const res = await createTopic({ category: again.key, label: firstTopic });
      if (!res.ok) throw new ActionError(res.error);
      return done();
    }
    const catKey = await freeKey(db, name);
    const { error } = await db.from("ticket_categories").insert({ key: catKey, label: name, position: await nextPosition(db, "ticket_categories") });
    if (error) throw error;
    const topicKey = await freeKey(db, firstTopic);
    const { error: te } = await db.from("ticket_topics").insert({ key: topicKey, category_key: catKey, label: firstTopic, position: 1 });
    if (te) {
      await db.from("ticket_categories").delete().eq("key", catKey);
      throw te;
    }
    done();
  });
}

const renameSchema = z.object({ key, label });

export async function renameCategory(input: z.input<typeof renameSchema>): Promise<ActionResult<void>> {
  return runAction(renameSchema, input, async ({ key: k, label: name }) => {
    await requireAdmin();
    const db = createAdminClient();
    await assertCategoryName(db, name, k);
    const { error } = await db.from("ticket_categories").update({ label: name }).eq("key", k);
    if (error) throw error;
    done();
  });
}

const keySchema = z.object({ key });

/**
 * Apaga a categoria. Com subcategoria ativa, não deixa (o admin tira as
 * subcategorias antes). Já usada em atendimentos ou mensagens: arquiva.
 */
export async function deleteCategory(input: z.input<typeof keySchema>): Promise<ActionResult<"deleted" | "archived">> {
  return runAction(keySchema, input, async ({ key: k }) => {
    await requireAdmin();
    const db = createAdminClient();
    const { data: cat } = await db.from("ticket_categories").select("label").eq("key", k).maybeSingle();
    if (!cat) throw new ActionError("Categoria não encontrada.");

    const { count: activeTopics } = await db.from("ticket_topics").select("key", { count: "exact", head: true }).eq("category_key", k).is("archived_at", null);
    if (activeTopics) {
      throw new ActionError(
        `“${cat.label}” ainda tem ${activeTopics === 1 ? "1 subcategoria" : `${activeTopics} subcategorias`}. Remova todas as subcategorias antes de apagar a categoria.`,
      );
    }

    const [{ count: tickets }, { count: messages }, { count: archivedTopics }] = await Promise.all([
      db.from("tickets").select("id", { count: "exact", head: true }).eq("category", k),
      db.from("messages").select("id", { count: "exact", head: true }).eq("category", k),
      db.from("ticket_topics").select("key", { count: "exact", head: true }).eq("category_key", k),
    ]);
    if (tickets || messages || archivedTopics) {
      const { error } = await db.from("ticket_categories").update({ archived_at: new Date().toISOString() }).eq("key", k);
      if (error) throw error;
      done();
      return "archived";
    }
    const { error } = await db.from("ticket_categories").delete().eq("key", k);
    if (error) throw error;
    done();
    return "deleted";
  });
}

// --- Subcategorias ----------------------------------------------------------

const createTopicSchema = z.object({ category: key, label });

export async function createTopic(input: z.input<typeof createTopicSchema>): Promise<ActionResult<void>> {
  return runAction(createTopicSchema, input, async ({ category, label: name }) => {
    await requireAdmin();
    const db = createAdminClient();
    const { data: cat } = await db.from("ticket_categories").select("key, archived_at").eq("key", category).maybeSingle();
    if (!cat || cat.archived_at) throw new ActionError("Categoria não encontrada.");
    await assertTopicName(db, category, name);
    // Mesmo nome de uma arquivada: volta a mesma (o histórico continua junto).
    const { data: archived } = await db.from("ticket_topics").select("key, label").eq("category_key", category).not("archived_at", "is", null);
    const again = (archived ?? []).find((t) => sameName(t.label, name));
    if (again) {
      const { error } = await db.from("ticket_topics").update({ archived_at: null, label: name }).eq("key", again.key);
      if (error) throw error;
      return done();
    }
    const { error } = await db.from("ticket_topics").insert({
      key: await freeKey(db, name),
      category_key: category,
      label: name,
      position: await nextPosition(db, "ticket_topics", category),
    });
    if (error) throw error;
    done();
  });
}

export async function renameTopic(input: z.input<typeof renameSchema>): Promise<ActionResult<void>> {
  return runAction(renameSchema, input, async ({ key: k, label: name }) => {
    await requireAdmin();
    const db = createAdminClient();
    const { data: topic } = await db.from("ticket_topics").select("category_key").eq("key", k).maybeSingle();
    if (!topic) throw new ActionError("Subcategoria não encontrada.");
    await assertTopicName(db, topic.category_key as string, name, k);
    const { error } = await db.from("ticket_topics").update({ label: name }).eq("key", k);
    if (error) throw error;
    done();
  });
}

/** Apaga a subcategoria; se já foi usada em atendimentos ou mensagens, arquiva. */
export async function deleteTopic(input: z.input<typeof keySchema>): Promise<ActionResult<"deleted" | "archived">> {
  return runAction(keySchema, input, async ({ key: k }) => {
    await requireAdmin();
    const db = createAdminClient();
    const [{ count: tickets }, { count: messages }] = await Promise.all([
      db.from("tickets").select("id", { count: "exact", head: true }).eq("topic", k),
      db.from("messages").select("id", { count: "exact", head: true }).eq("topic", k),
    ]);
    if (tickets || messages) {
      const { error } = await db.from("ticket_topics").update({ archived_at: new Date().toISOString() }).eq("key", k);
      if (error) throw error;
      done();
      return "archived";
    }
    const { error } = await db.from("ticket_topics").delete().eq("key", k);
    if (error) throw error;
    done();
    return "deleted";
  });
}
