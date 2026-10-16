"use client";

import { createContext, useContext, useMemo } from "react";
import type { AppSettings, Profile } from "@/lib/types";

export type Member = Pick<Profile, "id" | "name" | "avatar_url" | "role">;

interface AppContextValue {
  profile: Profile;
  settings: AppSettings;
  members: Member[];
  memberById: Map<string, Member>;
  isAdmin: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  profile,
  settings,
  members,
  children,
}: {
  profile: Profile;
  settings: AppSettings;
  members: Member[];
  children: React.ReactNode;
}) {
  const value = useMemo<AppContextValue>(
    () => ({
      profile,
      settings,
      members,
      memberById: new Map(members.map((m) => [m.id, m])),
      isAdmin: profile.role === "admin",
    }),
    [profile, settings, members],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp fora do AppProvider");
  return ctx;
}
