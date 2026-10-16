import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { getInstanceRow } from "@/lib/uazapi/instance";
import { PageHeader } from "@/components/app/page-header";
import { LogsView, type LogsTab } from "@/components/admin/logs-view";

export const metadata: Metadata = { title: "Logs" };

const TABS: LogsTab[] = ["conexao", "eventos", "alertas"];

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  await requireAdminPage();
  const { aba } = await searchParams;
  const row = await getInstanceRow();

  return (
    <>
      <PageHeader title="Logs" description="Conexão do WhatsApp, eventos recebidos da uazapi e alertas no Discord." />
      <LogsView
        initialTab={TABS.includes(aba as LogsTab) ? (aba as LogsTab) : "conexao"}
        instance={{ status: row.status, phone: row.phone, lastEventAt: row.last_event_at, lastDisconnectReason: row.last_disconnect_reason }}
      />
    </>
  );
}
