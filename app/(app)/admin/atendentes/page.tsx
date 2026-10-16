import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app/page-header";
import { AttendantsView, type AttendantRow } from "@/components/admin/attendants-view";
import type { Profile } from "@/lib/types";

export const metadata: Metadata = { title: "Atendentes" };

export default async function AtendentesPage() {
  const me = await requireAdminPage();
  const db = createAdminClient();

  const [{ data: profiles }, { data: users }, { data: openTickets }] = await Promise.all([
    db.from("profiles").select("*").order("active", { ascending: false }).order("name"),
    db.auth.admin.listUsers({ perPage: 1000 }),
    db.from("tickets").select("assignee_id").eq("status", "open").not("assignee_id", "is", null),
  ]);

  const authById = new Map((users?.users ?? []).map((u) => [u.id, u]));
  const openByAssignee = new Map<string, number>();
  for (const t of openTickets ?? []) openByAssignee.set(t.assignee_id, (openByAssignee.get(t.assignee_id) ?? 0) + 1);

  const rows: AttendantRow[] = ((profiles ?? []) as Profile[]).map((p) => {
    const auth = authById.get(p.id);
    return {
      ...p,
      invitePending: !auth?.email_confirmed_at && !auth?.last_sign_in_at,
      lastSignInAt: auth?.last_sign_in_at ?? null,
      openTickets: openByAssignee.get(p.id) ?? 0,
    };
  });

  return (
    <>
      <PageHeader title="Atendentes" description="Quem acessa o painel. Administradores veem também Leads e Administração." />
      <AttendantsView rows={rows} currentUserId={me.id} />
    </>
  );
}
