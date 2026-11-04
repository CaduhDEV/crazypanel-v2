import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireMemberPage } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadPage } from "@/components/leads/lead-page";

export const metadata: Metadata = { title: "Perfil do lead" };

// Perfil completo do lead: dados, números e todas as mensagens, com filtros.
export default async function LeadProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireMemberPage();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await createAdminClient().from("contacts").select("id").eq("id", id).maybeSingle();
  if (!data) notFound();
  return <LeadPage contactId={id} />;
}
