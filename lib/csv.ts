// CSV para o Excel em português: separador ";" e BOM UTF-8 (acentos corretos).

type Cell = string | number | boolean | null | undefined;

function cell(v: Cell): string {
  if (v == null) return "";
  const s = String(v);
  // Fórmula no início vira texto (evita injeção de fórmulas ao abrir no Excel).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

export function csvResponse(csv: string, baseName: string): Response {
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Data/hora em São Paulo, "dd/mm/aaaa hh:mm". */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}
