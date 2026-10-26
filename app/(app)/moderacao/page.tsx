import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app/page-header";
import { ModerationView, type ModerationEvent, type ModerationLead } from "@/components/moderation/moderation-view";

export const metadata: Metadata = { title: "Moderação" };

type SearchParams = Promise<Record<string, string | undefined>>;

const LEAD_COLUMNS = "id, name, phone, lid, kind, avatar_url, strikes, removed_from_community_at, left_community_at, company:companies(name)";

export default async function ModeracaoPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPage();
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 80) ?? "";
  const db = createAdminClient();

  const term = q.replace(/[%,()]/g, " ");
  const digits = q.replace(/\D/g, "");
  const search = q
    ? db
        .from("contacts")
        .select(LEAD_COLUMNS)
        .or([`name.ilike.%${term}%`, digits.length >= 4 && `phone.like.%${digits}%`].filter(Boolean).join(","))
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(20)
    : null;

  const [settings, flagged, events, found] = await Promise.all([
    getSettings(),
    db
      .from("contacts")
      .select(LEAD_COLUMNS)
      .or("strikes.gt.0,removed_from_community_at.not.is.null")
      .order("strikes", { ascending: false })
      .order("name")
      .limit(300),
    db
      .from("moderation_events")
      .select("id, contact_id, type, reason, strikes_after, message, created_at, actor:profiles(name), contact:contacts(name, phone)")
      .order("created_at", { ascending: false })
      .limit(40),
    search,
  ]);

  return (
    <>
      <PageHeader
        title="Moderação"
        description={`Quem violou as diretrizes da comunidade. Com ${settings.mod_strike_limit} flags, o lead fica inapto (vermelho em Leads).`}
      />
      <ModerationView
        limit={settings.mod_strike_limit}
        leads={(flagged.data ?? []) as unknown as ModerationLead[]}
        events={(events.data ?? []) as unknown as ModerationEvent[]}
        query={q}
        found={(found?.data ?? []) as unknown as ModerationLead[]}
        error={flagged.error?.message ?? null}
      />
    </>
  );
}
