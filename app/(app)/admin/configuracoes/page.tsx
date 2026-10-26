import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "@/components/admin/settings-form";
import { TaxonomySettings } from "@/components/admin/taxonomy-settings";
import { AiSettings, type AiCallbackRow, type AiRequestRow } from "@/components/admin/ai-settings";
import { aiConfigured } from "@/lib/ai/classify";
import { siteUrl } from "@/lib/site-url";
import type { IssuedReportRow, ReportPerson } from "@/components/admin/report-settings";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  await requireAdminPage();
  const db = createAdminClient();
  const [settings, { data: people }, { data: reports }, { data: aiRequests }, base, { data: aiCallbacks }] = await Promise.all([
    getSettings(),
    // "*": whatsapp pode não existir antes da migration.
    db.from("profiles").select("*").eq("active", true).order("name"),
    db.from("reports").select("id, created_at, trigger, deliveries").order("created_at", { ascending: false }).limit(5),
    // Antes da migration a tabela não existe: lista vazia.
    db.from("ai_classification_requests").select("id, status, outcome, sent_at, error, ticket:tickets(number)").order("sent_at", { ascending: false }).limit(8),
    siteUrl(),
    db.from("webhook_events").select("id, received_at, payload").eq("event_type", "ai_callback").order("id", { ascending: false }).limit(5),
  ]);
  const callbackUrl = `${base}/api/ai/classificacoes?key=${encodeURIComponent(process.env.AI_WEBHOOK_SECRET ?? "")}`;
  return (
    <>
      <PageHeader title="Configurações" description="Regras do atendimento, iguais para toda a equipe." />
      <SettingsForm
        settings={settings}
        people={((people ?? []) as ReportPerson[]).map((p) => ({ id: p.id, name: p.name, email: p.email, avatar_url: p.avatar_url, whatsapp: p.whatsapp ?? null }))}
        reports={(reports ?? []) as IssuedReportRow[]}
      >
        <TaxonomySettings />
        <AiSettings configured={aiConfigured()} callbackUrl={callbackUrl} requests={(aiRequests ?? []) as unknown as AiRequestRow[]} callbacks={(aiCallbacks ?? []) as unknown as AiCallbackRow[]} />
      </SettingsForm>
    </>
  );
}
