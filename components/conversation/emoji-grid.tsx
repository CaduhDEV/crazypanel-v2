"use client";

import { cn } from "@/lib/utils";
import { EMOJI_GROUPS } from "@/components/conversation/message-utils";

export function EmojiGrid({ onPick, className }: { onPick: (emoji: string) => void; className?: string }) {
  return (
    <div className={cn("scroll-thin flex max-h-60 w-72 flex-col gap-2 overflow-y-auto", className)}>
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <span className="px-1 text-[11px] font-medium text-muted-foreground">{group.label}</span>
          <div className="grid grid-cols-8 gap-0.5">
            {group.emojis.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onPick(e)}
                className="flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-accent"
                aria-label={e}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
