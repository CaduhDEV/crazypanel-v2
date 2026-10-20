"use client";

import { createContext, useContext, useMemo } from "react";
import type { AppSettings, Profile } from "@/lib/types";
import type { Taxonomy } from "@/lib/taxonomy";

export type Member = Pick<Profile, "id" | "name" | "avatar_url" | "role">;

interface AppContextValue {
  profile: Profile;
  settings: AppSettings;
  members: Member[];
  memberById: Map<string, Member>;
  isAdmin: boolean;
  /** Categorias e subcategorias (Configurações). */
  taxonomy: Taxonomy;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  profile,
  settings,
  members,
  taxonomy,
  children,
}: {
  profile: Profile;
  settings: AppSettings;
  members: Member[];
  taxonomy: Taxonomy;
  children: React.ReactNode;
}) {
  const value = useMemo<AppContextValue>(
    () => ({
      profile,
      settings,
      members,
      memberById: new Map(members.map((m) => [m.id, m])),
      isAdmin: profile.role === "admin",
      taxonomy,
    }),
    [profile, settings, members, taxonomy],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp fora do AppProvider");
  return ctx;
}
