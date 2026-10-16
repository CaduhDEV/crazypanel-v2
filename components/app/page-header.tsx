import { cn } from "@/lib/utils";

/** Cabeçalho das páginas: título, contexto curto e ações à direita. */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background/80 px-4 py-3 backdrop-blur sm:px-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
          {meta}
        </div>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PageBody({ className, ...props }: React.ComponentProps<"main">) {
  return <main className={cn("flex-1 px-4 py-5 sm:px-6", className)} {...props} />;
}
