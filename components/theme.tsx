"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/theme-script";

export type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const isTheme = (v: unknown): v is Theme => v === "light" || v === "dark" || v === "system";

function readStored(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const systemDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Aplica a classe sem animar as cores (as transições fariam a troca "escorrer"). */
function apply(resolved: "light" | "dark") {
  const root = document.documentElement;
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  // Força o reflow antes de devolver as transições.
  void window.getComputedStyle(document.body).opacity;
  requestAnimationFrame(() => style.remove());
}

/**
 * Tema claro/escuro/sistema. O script em lib/theme-script.ts já aplicou a
 * classe antes da hidratação; aqui ficam o estado, a troca e o modo "sistema".
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // No servidor não há preferência: começa no padrão e corrige ao montar.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  const [prefersDark, setPrefersDark] = useState(true);

  useEffect(() => {
    // Sincroniza com o que o script aplicou (localStorage e preferência do sistema).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(readStored());
    setPrefersDark(systemDark());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", onChange);
    // Outra aba trocou o tema.
    const onStorage = (e: StorageEvent) => e.key === THEME_STORAGE_KEY && setThemeState(isTheme(e.newValue) ? e.newValue : DEFAULT_THEME);
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const resolvedTheme: "light" | "dark" = theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  useEffect(() => {
    if (document.documentElement.classList.contains("dark") !== (resolvedTheme === "dark")) apply(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: string) => {
    if (!isTheme(next)) return;
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Navegação privada: vale só nesta sessão.
    }
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme precisa estar dentro de ThemeProvider");
  return ctx;
}
