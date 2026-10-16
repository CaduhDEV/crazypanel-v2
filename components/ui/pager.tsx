"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Itens por página das tabelas e listas: cabe na tela sem rolar. */
export const TABLE_PAGE_SIZE = 12;

/**
 * Paginação no cliente para listas já carregadas. `resetKey` volta à página 1
 * quando muda (ex.: filtro ou busca).
 */
export function usePaged<T>(items: T[], resetKey = "", size = TABLE_PAGE_SIZE) {
  const [state, setState] = useState({ page: 1, key: resetKey });
  // Ajuste durante o render (padrão do React para estado derivado de props).
  if (state.key !== resetKey) setState({ page: 1, key: resetKey });
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(state.key === resetKey ? state.page : 1, pages);
  return {
    pageItems: items.slice((page - 1) * size, page * size),
    page,
    pages,
    setPage: (p: number) => setState({ page: p, key: resetKey }),
  };
}

export function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="text-muted-foreground tabular">
        Página {page} de {pages}
      </span>
      <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Página anterior">
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Próxima página">
        <ChevronRight />
      </Button>
    </div>
  );
}
