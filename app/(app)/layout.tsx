import { cookies } from "next/headers";
import { requireMemberPage } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/app-shell";
import type { Member } from "@/components/app/app-context";
import { toSettings } from "@/lib/types";
import { getTaxonomy } from "@/lib/taxonomy-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireMemberPage();
  const cookieStore = await cookies();

  if (cookieStore.get("dev_demo_session")?.value === "1") {
    const demoMembers: Member[] = [
      { id: profile.id, name: profile.name, avatar_url: null, role: profile.role },
      { id: "00000000-0000-0000-0000-000000000002", name: "Carlos Supervisor", avatar_url: null, role: "admin" },
      { id: "00000000-0000-0000-0000-000000000003", name: "Beatriz Atendente", avatar_url: null, role: "attendant" },
    ];
    return (
      <AppShell
        profile={profile}
        settings={toSettings(null)}
        members={demoMembers}
        taxonomy={{ categories: [], topics: [] }}
        sidebarCollapsed={cookieStore.get("sidebar_collapsed")?.value === "1"}
      >
        {children}
      </AppShell>
    );
  }

  const supabase = await createClient();

  const [{ data: settings }, { data: members }, taxonomy] = await Promise.all([
    // "*": colunas novas entram sem quebrar quando a migration ainda não subiu.
    supabase.from("app_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("profiles").select("id, name, avatar_url, role").eq("active", true).order("name"),
    getTaxonomy(),
  ]);

  return (
    <AppShell
      profile={profile}
      settings={toSettings(settings)}
      members={(members ?? []) as Member[]}
      taxonomy={taxonomy}
      sidebarCollapsed={cookieStore.get("sidebar_collapsed")?.value === "1"}
    >
      {children}
    </AppShell>
  );
}
