import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

/** "+55 11 98765-4321" a partir de dígitos (formato BR quando possível). */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    const head = rest.length === 9 ? `${rest.slice(0, 5)}-${rest.slice(5)}` : `${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `+55 ${ddd} ${head}`;
  }
  return `+${d}`;
}

/** Nome de exibição de um contato, com fallback para telefone ou @lid. */
export function contactLabel(
  contact: { name?: string | null; phone?: string | null; lid?: string | null } | null | undefined,
): string {
  if (!contact) return "Contato desconhecido";
  return contact.name?.trim() || formatPhone(contact.phone) || (contact.lid ? `@lid ${contact.lid.slice(0, 6)}…` : "Contato");
}

/** 125 → "02:05"; 3725 → "1:02:05". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "há 5 min", "há 2 horas", "ontem". */
export function formatRelative(date: string | number | Date, now = Date.now()): string {
  const diff = (new Date(date).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "agora";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatTime(date: string | number | Date): string {
  return new Date(date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(date: string | number | Date, now = new Date()): string {
  const d = new Date(date);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days === 0) return "Hoje";
  if (days === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: days > 300 ? "numeric" : undefined });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? singular : plural}`;
}

// Cor estável por pessoa (nome do autor nos balões), legível nos dois temas.
const NAME_COLORS = [
  "text-[#c2410c] dark:text-[#f0a46b]",
  "text-[#0f766e] dark:text-[#6fc9bd]",
  "text-[#7c3aed] dark:text-[#b9a1f5]",
  "text-[#b91c1c] dark:text-[#f19a9a]",
  "text-[#1d4ed8] dark:text-[#8fb4f5]",
  "text-[#a16207] dark:text-[#e8c46a]",
  "text-[#be185d] dark:text-[#f29cc4]",
  "text-[#15803d] dark:text-[#86d69f]",
];

export function nameColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

/** CNPJ 00.000.000/0000-00 ou CPF 000.000.000-00 (outros tamanhos ficam como estão). */
export function formatTaxId(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return d;
}
