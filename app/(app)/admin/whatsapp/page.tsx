import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { WhatsAppView } from "@/components/admin/whatsapp-view";

export const metadata: Metadata = { title: "Conexão" };

export default async function WhatsAppPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader title="Conexão" description="Instância da uazapi que escuta os grupos e envia as respostas." />
      <WhatsAppView />
    </>
  );
}
