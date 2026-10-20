"use client";

// Gráficos das métricas (shadcn/ui charts + Recharts) com as cores do painel.

import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { TICKET_CATEGORIES, TICKET_TOPICS } from "@/lib/types";
import type { CommunityReport, LiveReport } from "@/lib/reports/data";
import { fInt } from "@/lib/reports/format";
import { cn } from "@/lib/utils";

export const COLORS = {
  comunidade: "var(--success)",
  equipe: "var(--primary)",
  ambos: "color-mix(in oklab, var(--primary) 45%, var(--success))",
  sem_resposta: "color-mix(in oklab, var(--destructive) 75%, transparent)",
  muted: "var(--muted-foreground)",
};

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

/** Ativa o traçado suave pós-montagem com pequeno delay para render dos eixos */
function useChartDraw() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setActive(true), 120);
    return () => clearTimeout(id);
  }, []);
  return active;
}

/** Threads por dia (Modelo Clássico de Backup para reversão rápida). */
export function LegacyTrendChart({ serie, className }: { serie: LiveReport["serie"]; className?: string }) {
  const active = useChartDraw();
  const config = {
    comunidade: { label: "Comunidade", color: COLORS.comunidade },
    equipe: { label: "Equipe", color: COLORS.equipe },
    sem_resposta: { label: "Sem resposta", color: COLORS.sem_resposta },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full tv-chart-draw", active && "tv-chart-active", className)}>
      <AreaChart data={serie} margin={{ left: -18, right: 8, top: 8 }}>
        <defs>
          {Object.keys(config).map((k) => (
            <linearGradient key={k} id={`fill-legacy-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.55} />
              <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="dia" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={dayLabel} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" labelFormatter={(_, p) => dayLabel(String(p?.[0]?.payload?.dia ?? ""))} />} />
        <Area isAnimationActive={false} dataKey="sem_resposta" type="monotone" stackId="a" stroke="var(--color-sem_resposta)" fill="url(#fill-legacy-sem_resposta)" strokeWidth={2.5} />
        <Area isAnimationActive={false} dataKey="equipe" type="monotone" stackId="a" stroke="var(--color-equipe)" fill="url(#fill-legacy-equipe)" strokeWidth={2.5} />
        <Area isAnimationActive={false} dataKey="comunidade" type="monotone" stackId="a" stroke="var(--color-comunidade)" fill="url(#fill-legacy-comunidade)" strokeWidth={2.5} />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

/** Threads por dia: Novo padrão shadcn/ui com curvas suaves, gradientes translúcidos e grid pontilhado. */
export function TrendChart({
  serie,
  className,
  variant = "shadcn",
}: {
  serie: LiveReport["serie"];
  className?: string;
  variant?: "shadcn" | "classic";
}) {
  const active = useChartDraw();

  if (variant === "classic") {
    return <LegacyTrendChart serie={serie} className={className} />;
  }

  const config = {
    comunidade: { label: "Comunidade", color: COLORS.comunidade },
    equipe: { label: "Equipe", color: COLORS.equipe },
    sem_resposta: { label: "Sem resposta", color: COLORS.sem_resposta },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full tv-chart-draw", active && "tv-chart-active", className)}>
      <AreaChart data={serie} margin={{ left: -14, right: 10, top: 12, bottom: 4 }}>
        <defs>
          <linearGradient id="fill-shadcn-comunidade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-comunidade)" stopOpacity={0.42} />
            <stop offset="95%" stopColor="var(--color-comunidade)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fill-shadcn-equipe" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-equipe)" stopOpacity={0.42} />
            <stop offset="95%" stopColor="var(--color-equipe)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fill-shadcn-sem_resposta" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-sem_resposta)" stopOpacity={0.42} />
            <stop offset="95%" stopColor="var(--color-sem_resposta)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted/50" />
        <XAxis dataKey="dia" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={dayLabel} className="text-xs fill-muted-foreground" />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} className="text-xs fill-muted-foreground" />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }}
          content={<ChartTooltipContent indicator="dot" labelFormatter={(_, p) => dayLabel(String(p?.[0]?.payload?.dia ?? ""))} />}
        />
        <Area
          isAnimationActive={true}
          animationDuration={1200}
          animationEasing="ease-out"
          dataKey="sem_resposta"
          type="monotone"
          stackId="a"
          stroke="var(--color-sem_resposta)"
          fill="url(#fill-shadcn-sem_resposta)"
          strokeWidth={2}
        />
        <Area
          isAnimationActive={true}
          animationDuration={1200}
          animationEasing="ease-out"
          dataKey="equipe"
          type="monotone"
          stackId="a"
          stroke="var(--color-equipe)"
          fill="url(#fill-shadcn-equipe)"
          strokeWidth={2}
        />
        <Area
          isAnimationActive={true}
          animationDuration={1200}
          animationEasing="ease-out"
          dataKey="comunidade"
          type="monotone"
          stackId="a"
          stroke="var(--color-comunidade)"
          fill="url(#fill-shadcn-comunidade)"
          strokeWidth={2}
        />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

/** Rosca (Modelo Clássico de Backup para reversão rápida). */
export function LegacyResolutionDonut({ resolucao, className, big }: { resolucao: LiveReport["resolucao"]; className?: string; big?: boolean }) {
  const data = [
    { key: "comunidade", value: resolucao.comunidade, fill: "var(--color-comunidade)" },
    { key: "equipe", value: resolucao.equipe, fill: "var(--color-equipe)" },
    { key: "ambos", value: resolucao.ambos, fill: "var(--color-ambos)" },
    { key: "sem_resposta", value: resolucao.sem_resposta, fill: "var(--color-sem_resposta)" },
  ];
  const total = data.reduce((a, d) => a + d.value, 0);
  const answered = total - resolucao.sem_resposta;
  const pctCommunity = answered ? Math.round((100 * resolucao.comunidade) / answered) : 0;
  const config = {
    value: { label: "Threads" },
    comunidade: { label: "Comunidade", color: COLORS.comunidade },
    equipe: { label: "Equipe", color: COLORS.equipe },
    ambos: { label: "Os dois", color: COLORS.ambos },
    sem_resposta: { label: "Sem resposta", color: COLORS.sem_resposta },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full", className)}>
      <PieChart>
        <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="key" hideLabel />} />
        <Pie isAnimationActive={true} animationDuration={800} animationEasing="ease-out" data={total ? data : [{ key: "vazio", value: 1, fill: "var(--muted)" }]} dataKey="value" nameKey="key" innerRadius="58%" outerRadius="86%" strokeWidth={3} paddingAngle={total ? 2 : 0}>
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox)) return null;
              const cx = viewBox.cx ?? 0;
              const cy = viewBox.cy ?? 0;
              const inner = Number(viewBox.innerRadius) || 40;
              const main = Math.max(12, inner * (big ? 0.52 : 0.46));
              const sub = Math.max(8, inner * 0.17);
              const gap = main * 0.12;
              const top = cy - (main + gap + sub) / 2;
              return (
                <text x={cx} textAnchor="middle" className="font-sans">
                  <tspan x={cx} y={top + main / 2} dominantBaseline="central" className="fill-foreground font-semibold" style={{ fontSize: main }}>
                    {pctCommunity}%
                  </tspan>
                  <tspan x={cx} y={top + main + gap + sub / 2} dominantBaseline="central" className="fill-muted-foreground" style={{ fontSize: sub }}>
                    pela comunidade
                  </tspan>
                </text>
              );
            }}
          />
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="key" className="flex-wrap" />} />
      </PieChart>
    </ChartContainer>
  );
}

/** Rosca: Novo padrão shadcn/ui com cantos suaves (cornerRadius), espaçamento e label centralizado refinado. */
export function ResolutionDonut({
  resolucao,
  className,
  big,
  variant = "shadcn",
}: {
  resolucao: LiveReport["resolucao"];
  className?: string;
  big?: boolean;
  variant?: "shadcn" | "classic";
}) {
  if (variant === "classic") {
    return <LegacyResolutionDonut resolucao={resolucao} className={className} big={big} />;
  }

  const data = [
    { key: "comunidade", value: resolucao.comunidade, fill: "var(--color-comunidade)" },
    { key: "equipe", value: resolucao.equipe, fill: "var(--color-equipe)" },
    { key: "ambos", value: resolucao.ambos, fill: "var(--color-ambos)" },
    { key: "sem_resposta", value: resolucao.sem_resposta, fill: "var(--color-sem_resposta)" },
  ];
  const total = data.reduce((a, d) => a + d.value, 0);
  const answered = total - resolucao.sem_resposta;
  const pctCommunity = answered ? Math.round((100 * resolucao.comunidade) / answered) : 0;
  const config = {
    value: { label: "Threads" },
    comunidade: { label: "Comunidade", color: COLORS.comunidade },
    equipe: { label: "Equipe", color: COLORS.equipe },
    ambos: { label: "Os dois", color: COLORS.ambos },
    sem_resposta: { label: "Sem resposta", color: COLORS.sem_resposta },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full", className)}>
      <PieChart>
        <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="key" hideLabel />} />
        <Pie
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
          data={total ? data : [{ key: "vazio", value: 1, fill: "var(--muted)" }]}
          dataKey="value"
          nameKey="key"
          innerRadius="60%"
          outerRadius="85%"
          strokeWidth={3}
          stroke="var(--card)"
          paddingAngle={total ? 3 : 0}
          cornerRadius={4}
        >
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox)) return null;
              const cx = viewBox.cx ?? 0;
              const cy = viewBox.cy ?? 0;
              const inner = Number(viewBox.innerRadius) || 40;
              const main = Math.max(14, inner * (big ? 0.54 : 0.48));
              const sub = Math.max(9, inner * 0.18);
              const gap = main * 0.12;
              const top = cy - (main + gap + sub) / 2;
              return (
                <text x={cx} textAnchor="middle" className="font-sans">
                  <tspan x={cx} y={top + main / 2} dominantBaseline="central" className="fill-foreground font-black tracking-tight" style={{ fontSize: main }}>
                    {pctCommunity}%
                  </tspan>
                  <tspan x={cx} y={top + main + gap + sub / 2} dominantBaseline="central" className="fill-muted-foreground font-medium" style={{ fontSize: sub }}>
                    pela comunidade
                  </tspan>
                </text>
              );
            }}
          />
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="key" className="flex-wrap pt-2" />} />
      </PieChart>
    </ChartContainer>
  );
}

/** Barras horizontais genéricas (ranking). */
export function RankBars({
  data,
  bars,
  className,
}: {
  data: { label: string; [k: string]: string | number }[];
  bars: { key: string; label: string; color: string }[];
  className?: string;
}) {
  const config = Object.fromEntries(bars.map((b) => [b.key, { label: b.label, color: b.color }])) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full", className)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={130} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} fill={`var(--color-${b.key})`} radius={4} />
        ))}
        {bars.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
      </BarChart>
    </ChartContainer>
  );
}

/** Barras verticais por comunidade. */
export function GroupBars({ grupos, className }: { grupos: CommunityReport["grupos"]; className?: string }) {
  const data = grupos.map((g) => ({
    label: (g.nome ?? g.jid).replace(/Comunidade CRM Datacrazy/i, "Comunidade").trim(),
    comunidade: g.resumo.comunidade,
    equipe: g.resumo.equipe + g.resumo.ambos,
    sem_resposta: g.resumo.sem_resposta,
  }));
  const config = {
    comunidade: { label: "Comunidade", color: COLORS.comunidade },
    equipe: { label: "Equipe", color: COLORS.equipe },
    sem_resposta: { label: "Sem resposta", color: COLORS.sem_resposta },
  } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full", className)}>
      <BarChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
        <Bar dataKey="comunidade" stackId="a" fill="var(--color-comunidade)" />
        <Bar dataKey="equipe" stackId="a" fill="var(--color-equipe)" />
        <Bar dataKey="sem_resposta" stackId="a" fill="var(--color-sem_resposta)" radius={[4, 4, 0, 0]} />
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  );
}

/** Hoje, hora a hora (Modelo Clássico de Backup para reversão rápida). */
export function LegacyTodayChart({ hoje, className }: { hoje: LiveReport["hoje"]; className?: string }) {
  const active = useChartDraw();
  const config = {
    mensagens: { label: "Mensagens", color: COLORS.equipe },
    threads: { label: "Threads", color: COLORS.comunidade },
  } satisfies ChartConfig;
  const lastActive = hoje.reduce((m, h) => (h.threads || h.mensagens ? Math.max(m, h.hora) : m), 0);
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full tv-chart-draw", active && "tv-chart-active", className)}>
      <AreaChart data={hoje.filter((h) => h.hora <= Math.max(lastActive + 1, 8))} margin={{ left: -18, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fill-today-legacy" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-mensagens)" stopOpacity={0.5} />
            <stop offset="95%" stopColor="var(--color-mensagens)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="hora" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(h: number) => `${h}h`} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" labelFormatter={(_, p) => `${p?.[0]?.payload?.hora ?? ""}h`} />} />
        <Area isAnimationActive={false} dataKey="mensagens" type="monotone" stroke="var(--color-mensagens)" fill="url(#fill-today-legacy)" strokeWidth={2.5} />
        <Area isAnimationActive={false} dataKey="threads" type="monotone" stroke="var(--color-threads)" fill="transparent" strokeWidth={2.5} strokeDasharray="5 4" />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

/** Hoje, hora a hora: Novo padrão shadcn/ui com curvas suaves, gradiente translúcido e grid pontilhado. */
export function TodayChart({
  hoje,
  className,
  variant = "shadcn",
}: {
  hoje: LiveReport["hoje"];
  className?: string;
  variant?: "shadcn" | "classic";
}) {
  const active = useChartDraw();

  if (variant === "classic") {
    return <LegacyTodayChart hoje={hoje} className={className} />;
  }

  const config = {
    mensagens: { label: "Mensagens", color: COLORS.equipe },
    threads: { label: "Threads", color: COLORS.comunidade },
  } satisfies ChartConfig;
  const lastActive = hoje.reduce((m, h) => (h.threads || h.mensagens ? Math.max(m, h.hora) : m), 0);

  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full tv-chart-draw", active && "tv-chart-active", className)}>
      <AreaChart data={hoje.filter((h) => h.hora <= Math.max(lastActive + 1, 8))} margin={{ left: -14, right: 10, top: 12, bottom: 4 }}>
        <defs>
          <linearGradient id="fill-shadcn-today" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-mensagens)" stopOpacity={0.42} />
            <stop offset="95%" stopColor="var(--color-mensagens)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted/50" />
        <XAxis dataKey="hora" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(h: number) => `${h}h`} interval="preserveStartEnd" className="text-xs fill-muted-foreground" />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} className="text-xs fill-muted-foreground" />
        <ChartTooltip cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} content={<ChartTooltipContent indicator="dot" labelFormatter={(_, p) => `${p?.[0]?.payload?.hora ?? ""}h`} />} />
        <Area isAnimationActive={true} animationDuration={1200} animationEasing="ease-out" dataKey="mensagens" type="monotone" stroke="var(--color-mensagens)" fill="url(#fill-shadcn-today)" strokeWidth={2} />
        <Area isAnimationActive={true} animationDuration={1200} animationEasing="ease-out" dataKey="threads" type="monotone" stroke="var(--color-threads)" fill="transparent" strokeWidth={2} strokeDasharray="4 4" />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  duvida: "var(--primary)",
  tecnico: "var(--destructive)",
  comercial: "var(--warning)",
  comunidade: "var(--success)",
};

/** Subcategorias, coloridas pela categoria. */
export function CategoryBars({ categorias, className }: { categorias: LiveReport["categorias"]; className?: string }) {
  const data = categorias
    .map((c) => ({
      label: TICKET_TOPICS.find((t) => t.value === c.subcategoria)?.label ?? TICKET_CATEGORIES.find((x) => x.value === c.categoria)?.label ?? "Outro",
      categoria: c.categoria,
      threads: c.threads,
    }))
    .sort((a, b) => b.threads - a.threads)
    .slice(0, 10);
  const config = { threads: { label: "Threads", color: COLORS.equipe } } satisfies ChartConfig;
  if (!data.length) return <Empty>Nenhuma thread finalizada com categoria no período.</Empty>;
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-full w-full", className)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 24 }} barCategoryGap="20%">
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={100} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel={false} indicator="dot" />} />
        <Bar dataKey="threads" radius={4}>
          {data.map((d) => (
            <Cell key={d.label} fill={CATEGORY_COLORS[d.categoria] ?? COLORS.equipe} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function CategoryLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {TICKET_CATEGORIES.map((c) => (
        <span key={c.value} className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ backgroundColor: CATEGORY_COLORS[c.value] }} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

/** Mapa de calor dia × hora. */
export function Heatmap({ picos, className }: { picos: CommunityReport["picos"]; className?: string }) {
  const grid = new Map(picos.map((x) => [`${x.dia}-${x.hora}`, x.mensagens]));
  const max = Math.max(1, ...picos.map((x) => x.mensagens));
  const days = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  return (
    <div className={cn("grid h-full grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] grid-rows-[repeat(7,minmax(0,1fr))_auto] gap-[3px] text-[10.5px] text-muted-foreground", className)}>
      {days.map((d, di) => (
        <div key={d} className="contents">
          <span className="self-center">{d}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const v = grid.get(`${di + 1}-${h}`) ?? 0;
            return (
              <span
                key={h}
                title={`${d} ${h}h: ${fInt(v)} mensagens`}
                className={cn("min-h-3 rounded-[3px] transition-[opacity,background-color] duration-700", !v && "bg-muted")}
                style={v ? { backgroundColor: "var(--primary)", opacity: 0.18 + 0.82 * (v / max) } : undefined}
              />
            );
          })}
        </div>
      ))}
      <span />
      {Array.from({ length: 24 }, (_, h) => (
        <span key={h} className="text-center">
          {h % 3 === 0 ? `${h}h` : ""}
        </span>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-24 items-center justify-center rounded-md border border-dashed border-border text-[13px] text-muted-foreground">{children}</div>;
}
