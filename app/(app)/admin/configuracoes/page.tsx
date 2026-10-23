import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "@/components/admin/settings-form";
import { TaxonomySettings } from "@/components/admin/taxonomy-settings";
import type { IssuedReportRow, ReportPerson } from "@/components/admin/report-settings";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  await requireAdminPage();
  const db = createAdminClient();
  const [settings, { data: people }, { data: reports }] = await Promise.all([
    getSettings(),
    // "*": whatsapp pode não existir antes da migration.
    db.from("profiles").select("*").eq("active", true).order("name"),
    db.from("reports").select("id, created_at, trigger, deliveries").order("created_at", { ascending: false }).limit(5),
  ]);
  return (
    <>
      <PageHeader title="Configurações" description="Regras do atendimento, iguais para toda a equipe." />
      <SettingsForm
        settings={settings}
        people={((people ?? []) as ReportPerson[]).map((p) => ({ id: p.id, name: p.name, email: p.email, avatar_url: p.avatar_url, whatsapp: p.whatsapp ?? null }))}
        reports={(reports ?? []) as IssuedReportRow[]}
      >
        <TaxonomySettings />
      </SettingsForm>
    </>
  );
}
