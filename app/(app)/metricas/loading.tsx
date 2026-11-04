import { Skeleton } from "@/components/ui/misc";

// Primeira abertura de Métricas: mesmo desenho da página, sem salto ao carregar.
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col lg:h-dvh lg:max-h-dvh lg:overflow-hidden" aria-busy="true" aria-label="Carregando">
      <div className="flex min-h-14 flex-col justify-center gap-1.5 border-b border-border px-4 py-3 sm:px-6">
        <Skeleton className="h-4 w-52 opacity-60" />
        <Skeleton className="h-3 w-96 max-w-full opacity-40" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 sm:px-6">
        <Skeleton className="h-9 w-full max-w-md opacity-40" />
        <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[84px] rounded-lg opacity-40" />
          ))}
        </div>
        <div className="grid min-h-72 flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
          <Skeleton className="rounded-lg opacity-30 lg:col-span-8" />
          <Skeleton className="rounded-lg opacity-30 lg:col-span-4" />
        </div>
      </div>
    </div>
  );
}
