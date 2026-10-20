// Categorias e subcategorias dos atendimentos (tabelas ticket_categories e
// ticket_topics, editáveis em Configurações). Serve ao navegador e ao servidor:
// quem usa recebe a lista (useApp().taxonomy no cliente, getTaxonomy() no servidor).

export interface TaxonomyCategory {
  key: string;
  label: string;
  position: number;
  archived: boolean;
}

export interface TaxonomyTopic {
  key: string;
  category: string;
  label: string;
  position: number;
  archived: boolean;
}

export interface Taxonomy {
  categories: TaxonomyCategory[];
  topics: TaxonomyTopic[];
}

export const EMPTY_TAXONOMY: Taxonomy = { categories: [], topics: [] };

/** Categorias para escolher (sem as arquivadas), na ordem. */
export const activeCategories = (t: Taxonomy) => t.categories.filter((c) => !c.archived);

/** Subcategorias de uma categoria para escolher (sem as arquivadas). */
export const topicsOf = (t: Taxonomy, category: string | null | undefined) => t.topics.filter((x) => x.category === category && !x.archived);

export const categoryLabel = (t: Taxonomy, key: string | null | undefined) => t.categories.find((c) => c.key === key)?.label ?? null;

/** "Dúvida · Funil" (ou só a categoria). Vale também para as arquivadas (histórico). */
export function classificationLabel(t: Taxonomy, category: string | null | undefined, topic?: string | null): string | null {
  const c = categoryLabel(t, category);
  if (!c) return null;
  const s = t.topics.find((x) => x.key === topic)?.label;
  return s ? `${c} · ${s}` : c;
}

/** A subcategoria existe, está ativa e é da categoria. */
export const isActivePair = (t: Taxonomy, category: string, topic: string) =>
  t.categories.some((c) => c.key === category && !c.archived) && t.topics.some((x) => x.key === topic && x.category === category && !x.archived);

/** Chave a partir do nome: "Agentes de IA" → "agentes_de_ia". */
export function slugKey(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36) || "item"
  );
}

/** Cores dos gráficos: as quatro originais fixas, as novas pela posição. */
const FIXED_COLORS: Record<string, string> = {
  duvida: "var(--primary)",
  tecnico: "var(--destructive)",
  comercial: "var(--warning)",
  comunidade: "var(--success)",
};
const EXTRA_COLORS = ["#8b5cf6", "#0ea5e9", "#ec4899", "#14b8a6", "#f97316", "#64748b"];

export function categoryColor(t: Taxonomy, key: string | null | undefined): string {
  if (key && FIXED_COLORS[key]) return FIXED_COLORS[key];
  const extra = t.categories.filter((c) => !FIXED_COLORS[c.key]);
  const i = extra.findIndex((c) => c.key === key);
  return i >= 0 ? EXTRA_COLORS[i % EXTRA_COLORS.length] : "var(--muted-foreground)";
}
