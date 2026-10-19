import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { JoinRequestsView, type JoinRequestItem, type JoinTab } from "@/components/community/join-requests-view";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Solicitações de entrada" };
export const maxDuration = 60;

const PAGE_SIZE = 12;
const TABS: Record<JoinTab, string[] | null> = {
  pendentes: ["pending", "error"],
  convidados: ["invited"],
  aceitos: ["accepted", "joined"],
  recusados: ["rejected", "expired"],
  todos: null,
};

type SearchParams = Promise<{ aba?: string; origem?: string; grupo?: string; q?: string; pagina?: string }>;

export default async function SolicitacoesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const tab = (params.aba && params.aba in TABS ? params.aba : "pendentes") as JoinTab;
  const origin = params.origem === "form" || params.origem === "whatsapp" ? params.origem : "";
  const group = params.grupo?.endsWith("@g.us") ? params.grupo : "";
  const q = params.q?.trim().slice(0, 80) ?? "";
  const page = Math.max(1, Number(params.pagina) || 1);
  const supabase = await createClient();

  let query = supabase.from("join_requests").select("*, group:wa_groups(name), company:companies(name, external_id, cnpj)", { count: "exact" });
  const statuses = TABS[tab];
  if (statuses) query = query.in("status", statuses);
  if (origin) query = query.eq("source", origin);
  if (group) query = query.eq("group_jid", group);
  if (q) {
    const term = q.replace(/[%,()"]/g, " ");
    const digits = q.replace(/\D/g, "");
    query = query.or(
      [`name.ilike.%${term}%`, `email.ilike.%${term}%`, `company_name.ilike.%${term}%`, digits.length >= 3 && `phone.ilike.%${digits}%`]
        .filter(Boolean)
        .join(","),
    );
  }

  const from = (page - 1) * PAGE_SIZE;
  const [result, counts, groups] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    supabase.from("join_requests").select("status"),
    supabase.from("wa_groups").select("jid, name").eq("listening", true).order("name"),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of counts.data ?? []) byStatus[r.status as string] = (byStatus[r.status as string] ?? 0) + 1;
  const tabCounts = Object.fromEntries(
    (Object.keys(TABS) as JoinTab[]).map((t) => [t, TABS[t] ? TABS[t]!.reduce((n, s) => n + (byStatus[s] ?? 0), 0) : (counts.data?.length ?? 0)]),
  ) as Record<JoinTab, number>;
  const total = result.count ?? 0;

  return (
    <>
      <PageHeader
        title="Solicitações de entrada"
        description="Quem pediu para entrar nas comunidades, pelo formulário ou pelo WhatsApp. Aceite ou recuse; tudo fica no log."
        meta={
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground tabular">
            {pluralize(tabCounts.pendentes, "pendente", "pendentes")}
          </span>
        }
      />
      <JoinRequestsView
        rows={(result.data ?? []) as unknown as JoinRequestItem[]}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        filters={{ tab, origin, group, q }}
        tabCounts={tabCounts}
        groups={(groups.data ?? []) as { jid: string; name: string | null }[]}
        error={result.error?.message ?? null}
      />
    </>
  );
}
