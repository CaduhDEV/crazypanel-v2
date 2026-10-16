import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "@/components/admin/settings-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  await requireAdminPage();
  const settings = await getSettings();
  return (
    <>
      <PageHeader title="Configurações" description="Regras do atendimento, iguais para toda a equipe." />
      <SettingsForm settings={settings} />
    </>
  );
}
