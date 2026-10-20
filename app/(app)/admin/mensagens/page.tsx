import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fetchMessages, parseMessageFilters } from "@/lib/messages/query";
import { pluralize } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { MessagesView, type MessageRow } from "@/components/admin/messages-view";

export const metadata: Metadata = { title: "Mensagens" };

const PAGE_SIZE = 15;

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function MensagensPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const filters = parseMessageFilters(params);
  const page = Math.max(1, Number(params.pagina) || 1);
  const supabase = await createClient();

  const from = (page - 1) * PAGE_SIZE;
  const [result, groups] = await Promise.all([
    fetchMessages(supabase, filters, [from, from + PAGE_SIZE - 1], { count: true }),
    // Só os grupos escutados entram no filtro.
    supabase.from("wa_groups").select("jid, name").eq("listening", true).order("name"),
  ]);
  const total = result.count ?? 0;

  return (
    <>
      <PageHeader
        title="Mensagens"
        description="Todas as mensagens dos grupos, inclusive o histórico do sistema antigo. Clique em uma para ver a anterior e a seguinte."
        meta={<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground tabular">{pluralize(total, "mensagem", "mensagens")}</span>}
      />
      <MessagesView
        rows={(result.data ?? []) as unknown as MessageRow[]}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        filters={filters}
        groups={(groups.data ?? []) as { jid: string; name: string | null }[]}
        error={result.error?.message ?? null}
      />
    </>
  );
}
