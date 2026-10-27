import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/site-url";
import { brainConfigured } from "@/lib/brain/core";
import { PageHeader } from "@/components/app/page-header";
import { BrainView, type BrainItem, type BrainRequestRow, type BrainStats } from "@/components/brain/brain-view";

export const metadata: Metadata = { title: "Cérebro" };

type SearchParams = Promise<Record<string, string | undefined>>;

const STATUSES = new Set(["draft", "approved", "archived", "changed"]);
const ITEM_COLUMNS =
  "id, question, answer, category, topic, status, occurrences, first_seen_at, last_seen_at, answer_changed_at, proposed_answer, proposed_at, confidence, edited";

export default async function CerebroPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 200) ?? "";
  const status = STATUSES.has(params.status ?? "") ? params.status! : "";
  const category = params.categoria?.trim() || "";
  const order = params.ordem === "recentes" ? "recentes" : "frequentes";
  const db = createAdminClient();

  const items$ = () => db.from("brain_items").select("id", { count: "exact", head: true });

  let list;
  if (q) {
    // Busca: a mesma do agente (texto, frequência e recência).
    const { data } = await db.rpc("brain_search", { p_query: q, p_category: category || null, p_limit: 20, p_include_drafts: true });
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    const { data: rows } = ids.length ? await db.from("brain_items").select(ITEM_COLUMNS).in("id", ids) : { data: [] };
    const byId = new Map(((rows ?? []) as BrainItem[]).map((r) => [r.id, r]));
    list = { data: ids.map((id) => byId.get(id)).filter((r): r is BrainItem => !!r), error: null };
  } else {
    let query = db.from("brain_items").select(ITEM_COLUMNS);
    if (status === "changed") query = query.not("proposed_answer", "is", null);
    else if (status) query = query.eq("status", status);
    else query = query.neq("status", "archived");
    if (category) query = query.eq("category", category);
    query =
      order === "recentes"
        ? query.order("last_seen_at", { ascending: false })
        : query.order("occurrences", { ascending: false }).order("last_seen_at", { ascending: false });
    list = await query.limit(150);
  }

  const [settings, total, approved, drafts, changed, pending, requests, baseUrl] = await Promise.all([
    getSettings(),
    items$().neq("status", "archived"),
    items$().eq("status", "approved"),
    items$().eq("status", "draft"),
    items$().not("proposed_answer", "is", null),
    db
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("status", "closed")
      .eq("close_reason", "resolved")
      .not("resolved_by", "is", null)
      .is("brain_processed_at", null),
    db.from("brain_requests").select("id, status, sent_at, ticket_ids, created, confirmed, updated, skipped, error").order("sent_at", { ascending: false }).limit(6),
    siteUrl(),
  ]);

  const stats: BrainStats = {
    total: total.count ?? 0,
    approved: approved.count ?? 0,
    drafts: drafts.count ?? 0,
    changed: changed.count ?? 0,
    pending: pending.count ?? 0,
  };
  const key = encodeURIComponent(process.env.AI_WEBHOOK_SECRET ?? "");
  let items = (list.data ?? []) as BrainItem[];
  if (q && status) items = items.filter((i) => (status === "changed" ? !!i.proposed_answer : i.status === status));

  return (
    <>
      <PageHeader
        title="Cérebro"
        description="O conhecimento da comunidade, tirado dos atendimentos resolvidos. Privado: só admins veem e só o agente da equipe consulta."
      />
      <BrainView
        items={items}
        stats={stats}
        filters={{ q, status, category, order }}
        enabled={settings.brain_enabled}
        configured={brainConfigured()}
        requests={(requests.data ?? []) as BrainRequestRow[]}
        urls={{
          busca: `${baseUrl}/api/cerebro/busca?key=${key}`,
          panorama: `${baseUrl}/api/cerebro/panorama?key=${key}`,
          callback: `${baseUrl}/api/ai/cerebro?key=${key}`,
        }}
        error={list.error?.message ?? null}
      />
    </>
  );
}
