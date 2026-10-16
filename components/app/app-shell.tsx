"use client";

import { AppProvider, type Member } from "@/components/app/app-context";
import { PresenceProvider } from "@/components/app/presence";
import { TicketNotifier } from "@/components/app/notifier";
import { PushPermissionPrompt } from "@/components/app/browser-notifications";
import { useTicketsRealtime } from "@/components/app/use-open-tickets";
import { MobileNav, Sidebar } from "@/components/app/sidebar";
import type { AppSettings, Profile } from "@/lib/types";

function RealtimeBridge() {
  useTicketsRealtime();
  return null;
}

export function AppShell({
  profile,
  settings,
  members,
  sidebarCollapsed,
  children,
}: {
  profile: Profile;
  settings: AppSettings;
  members: Member[];
  sidebarCollapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <AppProvider profile={profile} settings={settings} members={members}>
      <PresenceProvider>
        <RealtimeBridge />
        <TicketNotifier />
        <PushPermissionPrompt />
        <div className="flex min-h-dvh">
          <Sidebar initialCollapsed={sidebarCollapsed} />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav />
            {children}
          </div>
        </div>
      </PresenceProvider>
    </AppProvider>
  );
}
