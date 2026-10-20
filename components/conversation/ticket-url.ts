"use client";

/**
 * Abre, troca ou fecha a conversa (?ticket=<id>) só no navegador.
 *
 * router.push/replace pede a página de novo ao servidor (o layout confere a
 * sessão e lê as configurações), e o modal só abria ou fechava depois dessa
 * volta. O history do navegador é integrado ao router do Next: useSearchParams
 * acompanha na hora, sem requisição.
 */
export function setTicketParam(id: string | null, mode: "push" | "replace" = "replace") {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("ticket", id);
  else url.searchParams.delete("ticket");
  if (url.href === window.location.href) return;
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}
