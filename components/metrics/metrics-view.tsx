"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight, FileDown, MonitorPlay } from "lucide-react";
import { cn } from "@/lib/utils";
import { indicators, pct, type MetricsPayload } from "@/lib/reports/data";
import { periodLabel, periodQuery, type MetricsPeriod } from "@/lib/reports/period";
import { Input } from "@/components/ui/input";
import { useApp } from "@/components/app/app-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { delta, fInt, fMin, fPct } from "@/lib/reports/format";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedNumber, useLiveMetrics } from "@/components/metrics/live";
import { CategoryBars, CategoryLegend, COLORS, Empty, GroupBars, Heatmap, RankBars, ResolutionDonut, TodayChart, TrendChart } from "@/components/metrics/charts";

const PAGES = [
  { key: "geral", label: "Visão geral" },
  { key: "comunidade", label: "Comunidade" },
  { key: "equipe", label: "Equipe" },
  { key: "temas", label: "Temas e horários" },
] as const;

type PageKey = (typeof PAGES)[number]["key"];

export function MetricsView({ initial, periods }: { initial: MetricsPayload; periods: number[] }) {
  const { data, error } = useLiveMetrics(initial);
  const [page, setPage] = useState<PageKey>("geral");
  const index = PAGES.findIndex((p) => p.key === page);
  const go = (step: number) => setPage(PAGES[(index + step + PAGES.length) % PAGES.length].key);

  // Setas do teclado trocam a página (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Páginas de métricas">
          {PAGES.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={p.key === page}
              onClick={() => setPage(p.key)}
              className={cn("rounded px-3 py-1 text-[13px] transition-colors", p.key === page ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          <span className="w-10 text-center text-xs tabular text-muted-foreground">
            {index + 1}/{PAGES.length}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => go(1)} aria-label="Próxima página">
            <ChevronRight />
          </Button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={error ?? undefined}>
          </span>
          <PeriodPicker period={data.period} periods={periods} />
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/reports/pdf?${periodQuery(data.period)}`} target="_blank" rel="noopener">
              <FileDown /> PDF
            </a>
          </Button>
          <Button size="sm" asChild>
            <Link href={`/telao?${periodQuery(data.period)}`} target="_blank">
              <MonitorPlay /> Modo telão
            </Link>
          </Button>
        </div>
      </div>

      <DataQuality data={data} />

      <div key={page} className="metrics-page-enter flex min-h-0 flex-1 flex-col gap-3">
        {page === "geral" && <Overview data={data} />}
        {page === "comunidade" && <CommunityPage data={data} />}
        {page === "equipe" && <TeamPage data={data} />}
        {page === "temas" && <TopicsPage data={data} />}
      </div>
    </main>
  );
}

// --- período --------------------------------------------------------------------

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Atalhos (7, 30, 90 dias) e um intervalo escolhido: data inicial e final. */
function PeriodPicker({ period, periods }: { period: MetricsPeriod; periods: number[] }) {
  const router = useRouter();
  const custom = !("days" in period);
  const [today] = useState(() => ymd.format(new Date()));
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => (custom ? period.from : ymd.format(new Date(Date.now() - 6 * 86_400_000))));
  const [to, setTo] = useState(custom ? period.to : today);
  const invalid = !from || !to || from > to;

  const apply = () => {
    if (invalid) return;
    setOpen(false);
    router.push(`/metricas?${periodQuery({ from, to })}`);
  };

  return (
    <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Período">
      {periods.map((d) => {
        const active = !custom && "days" in period && period.days === d;
        return (
          <Link
            key={d}
            href={`/metricas?dias=${d}`}
            role="tab"
            aria-selected={active}
            className={cn("rounded px-2.5 py-1 text-[13px]", active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            {d} dias
          </Link>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="tab"
            aria-selected={custom}
            className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-[13px]", custom ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent")}
          >
            <CalendarRange className="size-3.5" />
            {custom ? periodLabel(period) : "Personalizado"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <span className="text-sm font-medium">Período personalizado</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Data inicial
                <Input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="h-9" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Data final
                <Input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} className="h-9" />
              </label>
            </div>
            {from && to && from > to && <span className="text-xs text-destructive">A data inicial precisa ser antes da final.</span>}
            <span className="text-[11.5px] text-muted-foreground">Dias inteiros, no horário de Brasília. A comparação é com o mesmo número de dias antes.</span>
            <Button type="submit" size="sm" disabled={invalid}>
              Aplicar
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// --- páginas --------------------------------------------------------------------

function Overview({ data }: { data: MetricsPayload }) {
  const s = data.report.resumo;
  const p = data.report.anterior;
  const i = indicators(s);
  const pi = indicators(p);
  return (
    <>
      <Kpis
        items={[
          { label: "Threads", value: s.threads, format: (v) => fInt(v ?? 0), foot: `${fInt(s.respondidas)} respondidas`, d: delta(s.threads, p.threads, "up", "") },
          { label: "Resolvido pela comunidade", value: i.comunidade, format: fPct, foot: `${fInt(s.comunidade)} de ${fInt(s.respondidas)}`, d: delta(i.comunidade, pi.comunidade, "up", "p.p.") },
          { label: "Sem nenhuma resposta", value: i.semResposta, format: fPct, foot: `${fInt(s.sem_resposta)} threads`, d: delta(i.semResposta, pi.semResposta, "down", "p.p.") },
          { label: "Com técnico", value: i.comTecnico, format: fPct, foot: `${fInt(s.com_tecnico)} threads`, d: delta(i.comTecnico, pi.comTecnico, "down", "p.p.") },
          { label: "1ª resposta da equipe", value: s.mediana_tecnico_min, format: fMin, foot: `p90 ${fMin(s.p90_tecnico_min)}`, d: delta(s.mediana_tecnico_min, p.mediana_tecnico_min, "down", "min") },
          { label: "Dentro do SLA", value: i.sla, format: fPct, foot: `SLA ${fInt(s.sla_min)} min`, d: delta(i.sla, pi.sla, "up", "p.p.") },
        ]}
      />
      <Grid>
        <Card title="Threads por dia" description="Quem resolveu e quantas ficaram sem resposta." className="lg:col-span-8">
          <TrendChart serie={data.live.serie} />
        </Card>
        <Card title="Quem resolveu" className="lg:col-span-4">
          <ResolutionDonut resolucao={data.live.resolucao} />
        </Card>
      </Grid>
    </>
  );
}

function CommunityPage({ data }: { data: MetricsPayload }) {
  const s = data.report.resumo;
  const p = data.report.anterior;
  const i = indicators(s);
  const pi = indicators(p);
  const k = data.report.concentracao;
  const mv = data.report.movimento;
  const active = data.report.grupos.reduce((a, g) => a + g.ativos, 0);
  const members = data.report.grupos.reduce((a, g) => a + g.membros, 0);
  return (
    <>
      <Kpis
        items={[
          { label: "Resolvido pela comunidade", value: i.comunidade, format: fPct, foot: `${fInt(s.comunidade)} threads`, d: delta(i.comunidade, pi.comunidade, "up", "p.p.") },
          { label: "1ª resposta de membro", value: s.mediana_membro_min, format: fMin, foot: "mediana", d: delta(s.mediana_membro_min, p.mediana_membro_min, "down", "min") },
          { label: "Pessoas que ajudaram", value: k.ajudantes, format: (v) => fInt(v ?? 0), foot: `${fInt(k.respostas)} respostas`, d: null },
          { label: "Top 5 deram", value: k.pct_top5, format: fPct, foot: `HHI ${fInt(k.hhi ?? 0)}`, d: null },
          { label: "Membros ativos", value: pct(active, members), format: fPct, foot: `${fInt(active)} de ${fInt(members)}`, d: null },
          { label: "Entradas / saídas", value: mv.entradas - mv.saidas, format: (v) => `${(v ?? 0) >= 0 ? "+" : ""}${fInt(v ?? 0)}`, foot: `${fInt(mv.entradas)} entraram · ${fInt(mv.saidas)} saíram`, d: null },
        ]}
      />
      <Grid>
        <Card title="Top 5 da comunidade" description="Quem mais respondeu dúvidas de outras pessoas." className="lg:col-span-5">
          <People
            rows={data.live.top_comunidade.map((a) => ({
              id: a.id,
              name: a.nome ?? "Sem nome",
              avatar: a.avatar_url,
              sub: [a.empresa, a.tipo === "partner" ? "parceiro" : null].filter(Boolean).join(" · ") || "membro",
              value: a.threads,
              valueLabel: a.threads === 1 ? "thread" : "threads",
              extra: `${fInt(a.respostas)} respostas · ${fInt(a.resolvidas)} resolvidas`,
            }))}
            empty="Ninguém respondeu dúvidas de outras pessoas no período."
          />
        </Card>
        <Card title="Por comunidade" description="Threads de cada grupo e quem resolveu." className="lg:col-span-7">
          <GroupBars grupos={data.report.grupos} />
        </Card>
      </Grid>
    </>
  );
}

function TeamPage({ data }: { data: MetricsPayload }) {
  const s = data.report.resumo;
  const p = data.report.anterior;
  const i = indicators(s);
  const pi = indicators(p);
  const f = data.live.fila;
  const team = data.live.top_equipe;
  return (
    <>
      <Kpis
        items={[
          { label: "Com técnico", value: i.comTecnico, format: fPct, foot: `${fInt(s.com_tecnico)} threads`, d: delta(i.comTecnico, pi.comTecnico, "down", "p.p.") },
          { label: "1ª resposta (mediana)", value: s.mediana_tecnico_min, format: fMin, foot: `p90 ${fMin(s.p90_tecnico_min)}`, d: delta(s.mediana_tecnico_min, p.mediana_tecnico_min, "down", "min") },
          { label: "Dentro do SLA", value: i.sla, format: fPct, foot: `SLA ${fInt(s.sla_min)} min`, d: delta(i.sla, pi.sla, "up", "p.p.") },
          { label: "Na fila agora", value: f.abertas, format: (v) => fInt(v ?? 0), foot: `${fInt(f.aguardando)} aguardando resposta`, d: null },
          { label: "SLA estourado agora", value: f.estouradas, format: (v) => fInt(v ?? 0), foot: f.espera_max_min ? `espera máx. ${fMin(f.espera_max_min)}` : "ninguém esperando", d: null, alert: f.estouradas > 0 },
          { label: "Reabertas", value: indicators(s).reabertas, format: fPct, foot: `${fInt(s.reabertas)} threads`, d: delta(i.reabertas, pi.reabertas, "down", "p.p.") },
        ]}
      />
      <Grid>
        <Card title="Top 5 da equipe" description="Atendimentos assumidos no período." className="lg:col-span-5">
          <People
            rows={team.map((t) => ({
              id: t.id,
              name: t.nome,
              avatar: t.avatar_url,
              sub: `1ª resposta ${fMin(t.mediana_min)} · ${fPct(pct(t.dentro_sla, t.respondidas))} no SLA`,
              value: t.assumidas,
              valueLabel: t.assumidas === 1 ? "atendimento" : "atendimentos",
              extra: `${fInt(t.resolvidas)} resolvidos`,
            }))}
            empty="Nenhum atendimento assumido no período."
          />
        </Card>
        <Card title="Carga por técnico" description="Assumidos e resolvidos no período." className="lg:col-span-7">
          {data.report.tecnicos.some((t) => t.assumidas || t.mensagens) ? (
            <RankBars
              data={data.report.tecnicos.map((t) => ({ label: t.nome, assumidas: t.assumidas, resolvidas: t.resolvidas, mensagens: t.mensagens }))}
              bars={[
                { key: "assumidas", label: "Assumidos", color: COLORS.equipe },
                { key: "resolvidas", label: "Resolvidos", color: COLORS.comunidade },
              ]}
            />
          ) : (
            <Empty>Sem atendimentos da equipe no período.</Empty>
          )}
        </Card>
      </Grid>
    </>
  );
}

function TopicsPage({ data }: { data: MetricsPayload }) {
  const { taxonomy } = useApp();
  return (
    <Grid rows="lg:grid-rows-2">
      <Card title="Categorias" description="Subcategorias das threads finalizadas." className="lg:col-span-5 lg:row-span-2" action={<CategoryLegend taxonomy={taxonomy} />}>
        <CategoryBars categorias={data.live.categorias} taxonomy={taxonomy} />
      </Card>
      <Card title="Hoje, hora a hora" description="Mensagens de membros e threads abertas." className="lg:col-span-7">
        <TodayChart hoje={data.live.hoje} />
      </Card>
      <Card title="Horários de pico" description="Mensagens de membros no período (Brasília)." className="lg:col-span-7">
        <Heatmap picos={data.report.picos} />
      </Card>
    </Grid>
  );
}

// --- blocos --------------------------------------------------------------------

type Kpi = {
  label: string;
  value: number | null;
  format: (v: number | null) => string;
  foot: string;
  d: ReturnType<typeof delta> | null;
  alert?: boolean;
};

function Kpis({ items }: { items: Kpi[] }) {
  return (
    <section className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {items.map((c) => (
        <div key={c.label} className={cn("flex flex-col gap-0.5 rounded-lg border bg-card px-3.5 py-3", c.alert ? "border-destructive/50 bg-destructive-soft/40" : "border-border")}>
          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</span>
          <span className={cn("text-2xl font-semibold tabular", c.alert && "text-destructive")}>
            <AnimatedNumber value={c.value} format={c.format} />
          </span>
          <span className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">{c.foot}</span>
            {c.d && (
              <span className={cn("shrink-0 font-medium", c.d.tone === "good" ? "text-success" : c.d.tone === "bad" ? "text-destructive" : "text-muted-foreground")}>
                {c.d.text}
              </span>
            )}
          </span>
        </div>
      ))}
    </section>
  );
}

function Grid({ children, rows }: { children: React.ReactNode; rows?: string }) {
  return <section className={cn("grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-12", rows)}>{children}</section>;
}

function Card({ title, description, className, action, children }: { title: string; description?: string; className?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-h-72 flex-col gap-2 rounded-lg border border-border bg-card p-4 lg:min-h-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function People({
  rows,
  empty,
}: {
  rows: { id: string; name: string; avatar: string | null; sub: string; value: number; valueLabel: string; extra: string }[];
  empty: string;
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="flex h-full flex-col justify-around gap-1.5">
      {rows.map((r, i) => (
        <li key={r.id} className="flex items-center gap-3">
          <span className={cn("w-5 text-center text-sm font-semibold tabular", i === 0 ? "text-primary" : "text-muted-foreground")}>{i + 1}</span>
          <Avatar name={r.name} src={r.avatar} size="sm" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-medium">{r.name}</span>
              <span className="shrink-0 text-[13px] font-semibold tabular">
                <AnimatedNumber value={r.value} format={(v) => fInt(v ?? 0)} /> <span className="text-xs font-normal text-muted-foreground">{r.valueLabel}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${(100 * r.value) / max}%` }} />
            </div>
            <span className="truncate text-[11.5px] text-muted-foreground">
              {r.sub} · {r.extra}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DataQuality({ data }: { data: MetricsPayload }) {
  const s = data.report.resumo;
  const i = indicators(s);
  const items: [string, number | null][] = [
    ["respostas sem citação", i.ruido],
    ["sem empresa", i.semEmpresa],
    ["fechadas pela limpeza da fila", pct(s.limpas, s.fechadas)],
  ];
  const bad = items.filter(([, v]) => (v ?? 0) >= 5);
  if (!bad.length) return null;
  return (
    <p className="flex shrink-0 items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-1.5 text-xs text-warning">
      <AlertTriangle className="size-3.5 shrink-0" />
      Qualidade dos dados: {bad.map(([l, v]) => `${l} ${fPct(v)}`).join(" · ")} (meta: abaixo de 5%).
    </p>
  );
}
