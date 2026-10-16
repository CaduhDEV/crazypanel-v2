import { cookies } from "next/headers";
import { requireMemberPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/app-shell";
import type { Member } from "@/components/app/app-context";
import { toSettings } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireMemberPage();
  const supabase = await createClient();

  const [{ data: settings }, { data: members }, cookieStore] = await Promise.all([
    // "*": colunas novas entram sem quebrar quando a migration ainda não subiu.
    supabase.from("app_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("profiles").select("id, name, avatar_url, role").eq("active", true).order("name"),
    cookies(),
  ]);

  return (
    <AppShell
      profile={profile}
      settings={toSettings(settings)}
      members={(members ?? []) as Member[]}
      sidebarCollapsed={cookieStore.get("sidebar_collapsed")?.value === "1"}
    >
      {children}
    </AppShell>
  );
}
