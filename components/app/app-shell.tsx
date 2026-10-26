"use client";

import { AppProvider, type Member } from "@/components/app/app-context";
import { PresenceProvider } from "@/components/app/presence";
import { TicketNotifier } from "@/components/app/notifier";
import { PushPermissionPrompt } from "@/components/app/browser-notifications";
import { useTicketsRealtime } from "@/components/app/use-open-tickets";
import { MobileNav, Sidebar } from "@/components/app/sidebar";
import { TicketModalHost } from "@/components/conversation/ticket-modal-host";
import { Suspense } from "react";
import type { AppSettings, Profile } from "@/lib/types";
import type { Taxonomy } from "@/lib/taxonomy";

function RealtimeBridge() {
  useTicketsRealtime();
  return null;
}

export function AppShell({
  profile,
  settings,
  members,
  taxonomy,
  sidebarCollapsed,
  children,
}: {
  profile: Profile;
  settings: AppSettings;
  members: Member[];
  taxonomy: Taxonomy;
  sidebarCollapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <AppProvider profile={profile} settings={settings} members={members} taxonomy={taxonomy}>
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
        {/* Conversa aberta por ?ticket= em qualquer página (o Inbox monta a dele). */}
        <Suspense>
          <TicketModalHost />
        </Suspense>
      </PresenceProvider>
    </AppProvider>
  );
}
