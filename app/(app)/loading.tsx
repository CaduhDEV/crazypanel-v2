import { Skeleton } from "@/components/ui/misc";

// Ao trocar de página: o menu lateral fica e a área da página aparece na hora,
// com este esqueleto, enquanto os dados chegam do servidor.
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true" aria-label="Carregando">
      <div className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="hidden h-8 w-28 sm:block" />
      </div>
      <div className="flex flex-col gap-3 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {[24, 20, 28, 16].map((w, i) => (
            <Skeleton key={i} className="h-8" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
