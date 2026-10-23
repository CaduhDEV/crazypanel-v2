import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMPTY_TAXONOMY, type Taxonomy } from "@/lib/taxonomy";

// Somente servidor. Uma leitura por request (as duas tabelas são pequenas).

export const getTaxonomy = cache(async (): Promise<Taxonomy> => {
  if (!process.env.SUPABASE_SECRET_KEY) {
    return EMPTY_TAXONOMY;
  }
  try {
    const db = createAdminClient();
    const [categories, topics] = await Promise.all([
      db.from("ticket_categories").select("key, label, position, archived_at").order("position").order("label"),
      db.from("ticket_topics").select("key, category_key, label, position, archived_at").order("position").order("label"),
    ]);
    if (categories.error || topics.error) return EMPTY_TAXONOMY;
    return {
      categories: categories.data.map((c) => ({ key: c.key, label: c.label, position: c.position, archived: !!c.archived_at })),
      topics: topics.data.map((t) => ({ key: t.key, category: t.category_key, label: t.label, position: t.position, archived: !!t.archived_at })),
    };
  } catch {
    return EMPTY_TAXONOMY;
  }
});
