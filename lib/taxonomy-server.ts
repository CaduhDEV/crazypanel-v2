import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Taxonomy } from "@/lib/taxonomy";

// Somente servidor. Uma leitura por request (as duas tabelas são pequenas).

export const getTaxonomy = cache(async (): Promise<Taxonomy> => {
  const db = createAdminClient();
  const [categories, topics] = await Promise.all([
    db.from("ticket_categories").select("key, label, position, archived_at").order("position").order("label"),
    db.from("ticket_topics").select("key, category_key, label, position, archived_at").order("position").order("label"),
  ]);
  if (categories.error) throw new Error(`Não foi possível ler as categorias: ${categories.error.message}`);
  if (topics.error) throw new Error(`Não foi possível ler as subcategorias: ${topics.error.message}`);
  return {
    categories: categories.data.map((c) => ({ key: c.key, label: c.label, position: c.position, archived: !!c.archived_at })),
    topics: topics.data.map((t) => ({ key: t.key, category: t.category_key, label: t.label, position: t.position, archived: !!t.archived_at })),
  };
});
