"use client";

import * as React from "react";
import { cn, initials } from "@/lib/utils";

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const showImage = src && !failed;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-border bg-muted font-semibold text-muted-foreground",
        SIZES[size],
        className,
      )}
      title={name ?? undefined}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** Avatares empilhados (quem está com o atendimento aberto). */
export function AvatarStack({
  people,
  max = 3,
  size = "xs",
}: {
  people: { id: string; name: string; avatarUrl?: string | null }[];
  max?: number;
  size?: keyof typeof SIZES;
}) {
  if (people.length === 0) return null;
  const visible = people.slice(0, max);
  const rest = people.length - visible.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {visible.map((p) => (
        <Avatar key={p.id} name={p.name} src={p.avatarUrl} size={size} className="ring-2 ring-card" />
      ))}
      {rest > 0 && (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card", SIZES[size])}>
          +{rest}
        </span>
      )}
    </span>
  );
}
