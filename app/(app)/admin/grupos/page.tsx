import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { GroupsView } from "@/components/admin/groups-view";
import type { WaGroup } from "@/lib/types";

export const metadata: Metadata = { title: "Grupos" };

export default async function GruposPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const [{ data: groups }, { data: open }] = await Promise.all([
    supabase.from("wa_groups").select("*").order("listening", { ascending: false }).order("name"),
    supabase.from("tickets").select("group_jid").eq("status", "open"),
  ]);

  const openByGroup: Record<string, number> = {};
  for (const t of open ?? []) openByGroup[t.group_jid] = (openByGroup[t.group_jid] ?? 0) + 1;

  return (
    <>
      <PageHeader
        title="Grupos"
        description="Configure os grupos da comunidade e importe os membros para a base de leads."
      />
      <GroupsView groups={(groups ?? []) as WaGroup[]} openByGroup={openByGroup} />
    </>
  );
}
