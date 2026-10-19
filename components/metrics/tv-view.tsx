"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import { cn } from "@/lib/utils";
import { indicators, pct, type MetricsPayload } from "@/lib/reports/data";
import { delta, fInt, fMin, fPct } from "@/lib/reports/format";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedNumber, useLiveMetrics, useSince } from "@/components/metrics/live";
import { ResolutionDonut, TodayChart, TrendChart } from "@/components/metrics/charts";

// Telão do escritório: tela cheia, tema escuro, tudo atualizando sozinho.

const LOGO_PATH =
  "M95.5657 295.294L81.3239 266.381L83.6986 253.77L216.273 203.763L29.6997 163.986V129.706L37.5589 119.97L219.3 63.0427L0.647095 42.1422V9.22756L8.53698 0L289.531 33.3945L295.941 44.3661V73.7989L91.0102 142.341L266.719 178.411L273.376 188.488V215.648L95.5657 295.294Z";

export function TvView({ initial }: { initial: MetricsPayload }) {
  const { data, updatedAt, error } = useLiveMetrics(initial, 30_000);
  const since = useSince(updatedAt);
  const [full, setFull] = useState(false);
  const idle = useIdle(3000);
  const now = useClock();

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

  const s = data.report.resumo;
  const p = data.report.anterior;
  const i = indicators(s);
  const pi = indicators(p);
  const f = data.live.fila;

  return (
    <div className={cn("dark tv-root relative flex h-dvh w-screen flex-col gap-[1.6vh] overflow-hidden px-[2.2vw] py-[2.4vh] text-foreground", idle && "cursor-none")}>
      {/* Cabeçalho */}
      <header className="flex shrink-0 items-center gap-[1.2vw]">
        <svg viewBox="0 0 32 32" className="size-[4.4vh] shrink-0" aria-hidden>
          <rect width="32" height="32" rx="8" fill="#2f62a8" />
          <g transform="translate(7.6 7.6) scale(.0568)">
            <path d={LOGO_PATH} fill="#fff" />
          </g>
        </svg>
        <div className="flex flex-col">
          <h1 className="text-[2.6vh] font-semibold tracking-tight">Comunidades DataCrazy</h1>
          <span className="flex items-center gap-2 text-[1.6vh] text-muted-foreground">
            <span className={cn("size-[1vh] rounded-full", error ? "bg-destructive" : "tv-live bg-success")} />
            {error ? "Sem conexão: tentando de novo" : `Ao vivo · atualizado há ${since}`} · últimos {data.days} dias
          </span>
        </div>
        <div className="ml-auto flex items-center gap-[1.4vw]">
          <div className="flex flex-col items-end">
            <span className="text-[4vh] font-semibold leading-none tabular">{now.time}</span>
            <span className="text-[1.6vh] text-muted-foreground capitalize">{now.date}</span>
          </div>
          <button
            type="button"
            onClick={toggleFull}
            className={cn("rounded-lg border border-border p-[1vh] text-muted-foreground transition-opacity hover:text-foreground", idle && full && "opacity-0")}
            aria-label={full ? "Sair da tela cheia" : "Tela cheia"}
          >
            {full ? <Minimize className="size-[2.4vh]" /> : <Maximize className="size-[2.4vh]" />}
          </button>
        </div>
      </header>

      {/* Números principais */}
      <section className="grid shrink-0 grid-cols-6 gap-[1vw]">
        <Big label="Na fila agora" value={f.abertas} format={(v) => fInt(v ?? 0)} foot={`${fInt(f.aguardando)} aguardando resposta`} tone={f.estouradas ? "bad" : "neutral"} />
        <Big
          label="SLA estourado"
          value={f.estouradas}
          format={(v) => fInt(v ?? 0)}
          foot={f.espera_max_min ? `espera máx. ${fMin(f.espera_max_min)}` : "ninguém esperando"}
          tone={f.estouradas ? "bad" : "good"}
        />
        <Big label="Resolvido pela comunidade" value={i.comunidade} format={fPct} foot={delta(i.comunidade, pi.comunidade, "up", "p.p.")} />
        <Big label="Sem resposta" value={i.semResposta} format={fPct} foot={delta(i.semResposta, pi.semResposta, "down", "p.p.")} />
        <Big label="1ª resposta da equipe" value={s.mediana_tecnico_min} format={fMin} foot={delta(s.mediana_tecnico_min, p.mediana_tecnico_min, "down", "min")} />
        <Big label="Dentro do SLA" value={i.sla} format={fPct} foot={delta(i.sla, pi.sla, "up", "p.p.")} />
      </section>

      {/* Rankings e gráficos */}
      <section className="grid min-h-0 flex-1 grid-cols-12 gap-[1vw]">
        <Panel title="Top 5 da comunidade" subtitle="quem mais ajudou outros membros" className="col-span-4">
          <Ranking
            rows={data.live.top_comunidade.map((a) => ({
              id: a.id,
              name: a.nome ?? "Sem nome",
              avatar: a.avatar_url,
              sub: a.empresa ?? (a.tipo === "partner" ? "Parceiro" : "Membro"),
              value: a.threads,
              unit: a.threads === 1 ? "dúvida" : "dúvidas",
              extra: `${fInt(a.resolvidas)} resolvidas`,
            }))}
            empty="Ninguém ajudou outros membros ainda."
          />
        </Panel>

        <div className="col-span-4 grid min-h-0 grid-rows-2 gap-[1vw]">
          <Panel title="Quem resolveu" subtitle={`${fInt(s.threads)} threads no período`}>
            <ResolutionDonut resolucao={data.live.resolucao} big className="tv-chart" />
          </Panel>
          <Panel title="Hoje, hora a hora" subtitle="mensagens de membros e threads abertas">
            <TodayChart hoje={data.live.hoje} className="tv-chart" />
          </Panel>
        </div>

        <Panel title="Top 5 da equipe" subtitle="atendimentos assumidos" className="col-span-4">
          <Ranking
            rows={data.live.top_equipe.map((t) => ({
              id: t.id,
              name: t.nome,
              avatar: t.avatar_url,
              sub: `1ª resposta ${fMin(t.mediana_min)} · ${fPct(pct(t.dentro_sla, t.respondidas))} no SLA`,
              value: t.assumidas,
              unit: t.assumidas === 1 ? "atendimento" : "atendimentos",
              extra: `${fInt(t.resolvidas)} resolvidos`,
            }))}
            empty="Nenhum atendimento assumido ainda."
          />
        </Panel>
      </section>

      <Panel title="Threads por dia" subtitle="comunidade, equipe e sem resposta" className="h-[19vh] shrink-0">
        <TrendChart serie={data.live.serie} className="tv-chart" />
      </Panel>
    </div>
  );
}

function Big({
  label,
  value,
  format,
  foot,
  tone = "neutral",
}: {
  label: string;
  value: number | null;
  format: (v: number | null) => string;
  foot: string | ReturnType<typeof delta>;
  tone?: "good" | "bad" | "neutral";
}) {
  const d = typeof foot === "string" ? null : foot;
  return (
    <div
      className={cn(
        "tv-card flex flex-col justify-between gap-[0.6vh] rounded-[1.2vh] border px-[1.1vw] py-[1.5vh]",
        tone === "bad" ? "border-destructive/60 bg-destructive/10" : tone === "good" ? "border-success/40" : "border-border",
      )}
    >
      <span className="truncate text-[1.5vh] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-[6vh] font-semibold leading-none tabular", tone === "bad" && "text-destructive")}>
        <AnimatedNumber value={value} format={format} duration={1400} />
      </span>
      <span
        className={cn(
          "truncate text-[1.6vh] font-medium",
          d ? (d.tone === "good" ? "text-success" : d.tone === "bad" ? "text-destructive" : "text-muted-foreground") : "text-muted-foreground",
        )}
      >
        {d ? `${d.text}${d.text.startsWith("+") || d.text.startsWith("−") ? " vs. período anterior" : ""}` : (foot as string)}
      </span>
    </div>
  );
}

function Panel({ title, subtitle, className, children }: { title: string; subtitle?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("tv-card flex min-h-0 flex-col gap-[1vh] rounded-[1.2vh] border border-border px-[1.1vw] py-[1.4vh]", className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-[2vh] font-semibold">{title}</h2>
        {subtitle && <span className="truncate text-[1.5vh] text-muted-foreground">{subtitle}</span>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

type RankRow = { id: string; name: string; avatar: string | null; sub: string; value: number; unit: string; extra: string };

/** Top 5 com troca de posição animada e destaque quando o número sobe. */
function Ranking({ rows, empty }: { rows: RankRow[]; empty: string }) {
  if (!rows.length) return <div className="flex h-full items-center justify-center text-[1.8vh] text-muted-foreground">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  // Ordem estável por id: a posição vem do transform, para a troca deslizar.
  const byId = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return (
    <div className="relative h-full">
      {byId.map((r) => (
        <RankItem key={r.id} row={r} position={rows.findIndex((x) => x.id === r.id)} max={max} />
      ))}
    </div>
  );
}

function RankItem({ row: r, position, max }: { row: RankRow; position: number; max: number }) {
  const prev = useRef(r.value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (r.value > prev.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 2200);
      prev.current = r.value;
      return () => clearTimeout(t);
    }
    prev.current = r.value;
  }, [r.value]);

  const medal = ["#f5c542", "#c9d1dc", "#d6995b"][position];
  return (
    <div className="absolute inset-x-0 top-0 h-1/5 py-[0.5vh] transition-transform duration-700 ease-out" style={{ transform: `translateY(${position * 100}%)` }}>
      <div className={cn("flex h-full items-center gap-[0.8vw] rounded-[1vh] px-[0.6vw] transition-colors duration-700", flash ? "bg-success/15 ring-1 ring-success/50" : "bg-transparent")}>
        <span
          className="flex size-[4vh] shrink-0 items-center justify-center rounded-full text-[2vh] font-bold tabular"
          style={medal ? { backgroundColor: medal, color: "#0b0f15" } : { color: "var(--muted-foreground)" }}
        >
          {position + 1}
        </span>
        <Avatar name={r.name} src={r.avatar} className="size-[5vh]! shrink-0 text-[1.8vh]!" />
        <div className="flex min-w-0 flex-1 flex-col gap-[0.5vh]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[2.1vh] font-semibold">{r.name}</span>
            <span className="shrink-0 text-[2.6vh] font-bold tabular">
              <AnimatedNumber value={r.value} format={(v) => fInt(v ?? 0)} duration={1200} />{" "}
              <span className="text-[1.4vh] font-medium text-muted-foreground">{r.unit}</span>
            </span>
          </div>
          <div className="h-[0.8vh] overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-[width] duration-1000 ease-out" style={{ width: `${(100 * r.value) / max}%` }} />
          </div>
          <span className="truncate text-[1.45vh] text-muted-foreground">
            {r.sub} · {r.extra}
          </span>
        </div>
      </div>
    </div>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return {
    time: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    date: now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }),
  };
}

/** Sem mexer o mouse por `ms`: some com o cursor e os botões. */
function useIdle(ms: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), ms);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [ms]);
  return idle;
}
