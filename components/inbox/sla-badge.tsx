"use client";

import { cn, formatDuration } from "@/lib/utils";
import { slaInfo, SLA_LABELS, type SlaState } from "@/lib/sla";
import { useApp } from "@/components/app/app-context";
import { useNow } from "@/components/app/use-now";

const TONES: Record<SlaState, string> = {
  ok: "bg-sla-ok text-sla-ok-foreground",
  warn: "bg-sla-warn text-sla-warn-foreground",
  breach: "bg-sla-breach text-sla-breach-foreground",
  answered: "bg-primary-soft text-primary dark:text-[#a9c6f2]",
};

/** Etiqueta de SLA ao vivo: estado + tempo de espera do lead. */
export function SlaBadge({
  waitingSince,
  compact = false,
  className,
}: {
  waitingSince: string | null;
  compact?: boolean;
  className?: string;
}) {
  const { settings } = useApp();
  const now = useNow();
  const sla = slaInfo(waitingSince, now, settings);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-wide tabular",
        TONES[sla.state],
        className,
      )}
      title={sla.state === "answered" ? "Aguardando o lead" : `Esperando há ${formatDuration(sla.elapsed)}`}
    >
      {compact ? (sla.state === "answered" ? "OK" : shortElapsed(sla.elapsed)) : SLA_LABELS[sla.state]}
      {!compact && sla.state !== "answered" && <span>{formatDuration(sla.elapsed)}</span>}
    </span>
  );
}

/** "45s", "12m", "3h", "2d". */
function shortElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
