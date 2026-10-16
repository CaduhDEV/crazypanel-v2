import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { gleapConfigured } from "@/lib/gleap";
import { invitesQuery } from "@/lib/leads/query";
import { PageHeader } from "@/components/app/page-header";
import { InvitesView, type InviteRow, type SyncState } from "@/components/invites/invites-view";
import { pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Prospectos" };

export const maxDuration = 300;

const PAGE_SIZE = 10;

type SearchParams = Promise<{ q?: string; pagina?: string }>;

export default async function ConvitesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 80) ?? "";
  const page = Math.max(1, Number(params.pagina) || 1);
  const supabase = await createClient();

  const query = invitesQuery(supabase, q, { count: true });

  const from = (page - 1) * PAGE_SIZE;
  const [result, state, leads] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    supabase.from("gleap_sync_state").select("*").eq("id", 1).maybeSingle(),
    supabase.from("gleap_leads").select("user_id", { count: "exact", head: true }),
  ]);

  const total = result.count ?? 0;
  return (
    <>
      <PageHeader
        title="Prospectos"
        description="Clientes do CRM (Gleap) com telefone e empresa que ainda não estão em nenhum grupo."
        meta={
          <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground tabular">
            {pluralize(total, "pessoa", "pessoas")}
          </span>
        }
      />
      <InvitesView
        rows={(result.data ?? []) as InviteRow[]}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        q={q}
        state={(state.data ?? null) as SyncState | null}
        gleapLeads={leads.count ?? 0}
        configured={gleapConfigured()}
        error={result.error?.message ?? null}
      />
    </>
  );
}
