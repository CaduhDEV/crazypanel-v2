"use client";

import { THEME_SCRIPT } from "@/lib/theme-script";

/**
 * Aplica o tema salvo antes da primeira pintura. No HTML do servidor é um script
 * normal (roda na hora). Quando o layout é renderizado de novo no navegador
 * (depois de salvar algo que revalida o layout), o React criaria o <script> e
 * avisaria que ele não roda; ali o tema já está aplicado, então ele vira um
 * bloco de dados (type="text/plain"), que o React aceita sem aviso.
 */
export function ThemeScript() {
  const onClient = typeof window !== "undefined";
  return <script id="theme" suppressHydrationWarning type={onClient ? "text/plain" : undefined} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
