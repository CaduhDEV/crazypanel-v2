"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useApp } from "@/components/app/app-context";

// Quem está com cada atendimento aberto, via Presence do Realtime (sem tabela:
// some sozinho quando a aba fecha).

export interface Viewer {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface PresenceState {
  profileId: string;
  name: string;
  avatarUrl: string | null;
  ticketId: string | null;
}

interface PresenceContextValue {
  viewersByTicket: Record<string, Viewer[]>;
  setViewingTicket: (ticketId: string | null) => void;
}

const PresenceContext = createContext<PresenceContextValue>({
  viewersByTicket: {},
  setViewingTicket: () => {},
});

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useApp();
  const [viewersByTicket, setViewers] = useState<Record<string, Viewer[]>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const ticketRef = useRef<string | null>(null);

  const track = useCallback(() => {
    const state: PresenceState = {
      profileId: profile.id,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      ticketId: ticketRef.current,
    };
    channelRef.current?.track(state);
  }, [profile.id, profile.name, profile.avatar_url]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel("presence:tickets", { config: { presence: { key: profile.id } } });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const next: Record<string, Viewer[]> = {};
        for (const entries of Object.values(channel.presenceState<PresenceState>())) {
          // Várias abas da mesma pessoa: conta cada atendimento uma vez.
          const seen = new Set<string>();
          for (const e of entries) {
            if (!e.ticketId || seen.has(e.ticketId)) continue;
            seen.add(e.ticketId);
            (next[e.ticketId] ??= []).push({ id: e.profileId, name: e.name, avatarUrl: e.avatarUrl });
          }
        }
        setViewers(next);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") track();
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [profile.id, track]);

  const setViewingTicket = useCallback(
    (ticketId: string | null) => {
      if (ticketRef.current === ticketId) return;
      ticketRef.current = ticketId;
      track();
    },
    [track],
  );

  const value = useMemo(() => ({ viewersByTicket, setViewingTicket }), [viewersByTicket, setViewingTicket]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}
