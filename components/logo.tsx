import { cn } from "@/lib/utils";

/** Símbolo da DataCrazy. Usa currentColor: a cor segue o texto. */
export function DataCrazySymbol({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 296 296" fill="none" className={className} aria-hidden>
      <path
        d="M95.5657 295.294L81.3239 266.381L83.6986 253.77L216.273 203.763L29.6997 163.986V129.706L37.5589 119.97L219.3 63.0427L0.647095 42.1422V9.22756L8.53698 0L289.531 33.3945L295.941 44.3661V73.7989L91.0102 142.341L266.719 178.411L273.376 188.488V215.648L95.5657 295.294Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Marca do CrazyPanel: símbolo da DataCrazy no quadrado da cor primária. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-8 items-center justify-center rounded-lg bg-primary text-white", className)}>
      <DataCrazySymbol className="size-[55%]" />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight">CrazyPanel</span>
        <span className="mt-0.5 text-[10.5px] font-medium text-muted-foreground">by DataCrazy</span>
      </span>
    </span>
  );
}
