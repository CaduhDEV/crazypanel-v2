"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, Headphones, Maximize, Minimize, MonitorPlay, Pause, PieChart, Play, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { indicators, pct, type MetricsPayload } from "@/lib/reports/data";
import { delta, fInt, fMin, fPct } from "@/lib/reports/format";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedNumber, useLiveMetrics } from "@/components/metrics/live";
import { ResolutionDonut, TodayChart, TrendChart } from "@/components/metrics/charts";
import { PodiumView } from "@/components/metrics/podium";

// Telão do escritório: tela cheia, tema escuro, tudo atualizando sozinho.

const LOGO_PATH =
  "M95.5657 295.294L81.3239 266.381L83.6986 253.77L216.273 203.763L29.6997 163.986V129.706L37.5589 119.97L219.3 63.0427L0.647095 42.1422V9.22756L8.53698 0L289.531 33.3945L295.941 44.3661V73.7989L91.0102 142.341L266.719 178.411L273.376 188.488V215.648L95.5657 295.294Z";

const SLIDE_TABS = [
  { id: 0, label: "Visão Geral", icon: BarChart3 },
  { id: 1, label: "Top 5 Comunidade", icon: Users },
  { id: 2, label: "Top 5 Equipe", icon: Headphones },
  { id: 3, label: "Quem Resolveu", icon: PieChart },
  { id: 4, label: "Threads por Dia", icon: TrendingUp },
];

export function TvView({ initial }: { initial: MetricsPayload }) {
  const { data } = useLiveMetrics(initial, 30_000);
  const [full, setFull] = useState(false);
  const [slideMode, setSlideMode] = useState(false);
  // Slide atual e progresso juntos: o avanço é uma atualização só, sem efeito
  // colateral. (Antes o índice era trocado de dentro da atualização do progresso,
  // e o React em desenvolvimento roda essas funções duas vezes: pulava um slide.)
  const [slide, setSlide] = useState({ index: 0, progress: 0 });
  const slideIndex = slide.index;
  const slideProgress = slide.progress;
  const goTo = (index: number | ((current: number) => number)) =>
    setSlide((s) => ({ index: typeof index === "function" ? index(s.index) : index, progress: 0 }));
  const [slidePaused, setSlidePaused] = useState(false);
  const [trendView, setTrendView] = useState<"7d" | "hoje">("7d");
  const idle = useIdle(3000);
  const now = useClock();

  useEffect(() => {
    if (!slideMode || slidePaused) return;
    const timer = setInterval(() => {
      // 8 segundos por slide (80 × 100 ms)
      setSlide((s) => (s.progress >= 100 ? { index: (s.index + 1) % SLIDE_TABS.length, progress: 0 } : { ...s, progress: s.progress + 1.25 }));
    }, 100);
    return () => clearInterval(timer);
  }, [slideMode, slidePaused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s" || e.key === "S") {
        setSlideMode((m) => !m);
        setSlide({ index: 0, progress: 0 });
        setSlidePaused(false);
      } else if (e.code === "Space") {
        e.preventDefault();
        setSlidePaused((p) => !p);
      } else if (e.key === "ArrowRight") {
        setSlide((s) => ({ index: (s.index + 1) % SLIDE_TABS.length, progress: 0 }));
      } else if (e.key === "ArrowLeft") {
        setSlide((s) => ({ index: (s.index - 1 + SLIDE_TABS.length) % SLIDE_TABS.length, progress: 0 }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      {/* Barra de progresso segmentada estilo TV / Stories */}
      {slideMode && (
        <div className="absolute top-0 left-0 right-0 z-50 flex gap-[0.8vw] px-[2.2vw] pt-[0.8vh]">
          {SLIDE_TABS.map((tab, idx) => {
            const isPast = idx < slideIndex;
            const isCurrent = idx === slideIndex;
            const Icon = tab.icon;
            return (
              <button
                key={tab.label}
                type="button"
                onClick={() => goTo(idx)}
                className="group flex flex-1 flex-col gap-[0.4vh] text-left transition-all"
              >
                <div className="h-[4px] w-full overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full bg-primary transition-all ease-linear"
                    style={{
                      width: isPast ? "100%" : isCurrent ? `${slideProgress}%` : "0%",
                      transitionDuration: isCurrent ? "100ms" : "300ms",
                    }}
                  />
                </div>
                <div className="flex items-center gap-[0.4vw] text-[1.2vh] font-semibold text-muted-foreground group-hover:text-foreground">
                  <Icon className="size-[1.4vh]" />
                  <span className={cn(isCurrent && "text-foreground font-bold")}>{tab.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Cabeçalho */}
      <header className={cn("flex shrink-0 items-center gap-[1.2vw]", slideMode && "pt-[2.2vh]")}>
        <svg viewBox="0 0 32 32" className="size-[4.4vh] shrink-0" aria-hidden>
          <rect width="32" height="32" rx="8" fill="#2f62a8" />
          <g transform="translate(7.6 7.6) scale(.0568)">
            <path d={LOGO_PATH} fill="#fff" />
          </g>
        </svg>
        <div className="flex items-center gap-[1.2vw]">
          <h1 className="text-[2.6vh] font-bold tracking-tight">Comunidades DataCrazy</h1>
        </div>

        <div className="ml-auto flex items-center gap-[1.4vw]">
          {slideMode && (
            <button
              type="button"
              onClick={() => setSlidePaused((paused) => !paused)}
              className="flex items-center gap-[0.4vw] rounded-[0.6vh] border border-border/80 bg-card/60 px-[0.8vw] py-[0.5vh] text-[1.3vh] font-semibold text-muted-foreground hover:text-foreground transition-all"
              title="Pausar / Retomar rotação (Espaço)"
            >
              {slidePaused ? <Play className="size-[1.4vh] text-amber-400" /> : <Pause className="size-[1.4vh]" />}
              {slidePaused ? <span className="text-amber-400 font-bold">Pausado</span> : "Pausar"}
            </button>
          )}

          <div className="flex rounded-lg border border-border bg-card/60 p-[0.3vh]">
            <button
              type="button"
              onClick={() => {
                setSlideMode(false);
                goTo(0);
                setSlidePaused(false);
              }}
              className={cn(
                "rounded-[0.6vh] px-[1vw] py-[0.5vh] text-[1.35vh] font-semibold transition-all",
                !slideMode ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Visão Completa
            </button>
            <button
              type="button"
              onClick={() => setSlideMode(true)}
              className={cn(
                "flex items-center gap-[0.4vw] rounded-[0.6vh] px-[1vw] py-[0.5vh] text-[1.35vh] font-semibold transition-all",
                slideMode ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <MonitorPlay className="size-[1.6vh]" /> Modo Slides (TV)
            </button>
          </div>

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

      {slideMode ? (
        <div className="relative flex flex-1 flex-col justify-center min-h-0 animate-in fade-in duration-500">
          {/* SLIDE 1: KPIs Principais */}
          {slideIndex === 0 && (
            <div className="flex flex-1 flex-col justify-center gap-[3vh] animate-in fade-in duration-500">
              <section className="grid grid-cols-3 gap-[1.8vw] px-[4vw]">
                <Big label="Na fila agora" value={f.abertas} format={(v) => fInt(v ?? 0)} foot={`${fInt(f.aguardando)} aguardando resposta`} tone={f.estouradas ? "bad" : "neutral"} />
                <Big label="SLA estourado" value={f.estouradas} format={(v) => fInt(v ?? 0)} foot={f.espera_max_min ? `espera máx. ${fMin(f.espera_max_min)}` : "ninguém esperando"} tone={f.estouradas ? "bad" : "good"} />
                <Big label="Resolvido pela comunidade" value={i.comunidade} format={fPct} foot={delta(i.comunidade, pi.comunidade, "up", "p.p.")} />
                <Big label="Sem resposta" value={i.semResposta} format={fPct} foot={delta(i.semResposta, pi.semResposta, "down", "p.p.")} />
                <Big label="1ª resposta da equipe" value={s.mediana_tecnico_min} format={fMin} foot={delta(s.mediana_tecnico_min, p.mediana_tecnico_min, "down", "min")} />
                <Big label="Dentro do SLA" value={i.sla} format={fPct} foot={delta(i.sla, pi.sla, "up", "p.p.")} />
              </section>
            </div>
          )}

          {/* SLIDE 2: Top 5 da Comunidade (Pódio) */}
          {slideIndex === 1 && (
            <div className="flex flex-1 flex-col justify-center min-h-0 animate-in fade-in duration-500 px-[4vw]">
              <PodiumView
                title="Destaques da Comunidade"
                subtitle="membros e parceiros que mais ajudaram outros membros no período"
                items={data.live.top_comunidade.map((a) => ({
                  id: a.id,
                  name: a.nome ?? "Sem nome",
                  avatar: a.avatar_url,
                  sub: a.empresa ? `${a.empresa} · ${a.tipo === "partner" ? "Parceiro" : "Membro"}` : a.tipo === "partner" ? "Parceiro" : "Membro",
                  value: a.threads,
                  unit: a.threads === 1 ? "dúvida ajudada" : "dúvidas ajudadas",
                  extra: `${fInt(a.resolvidas)} resolvidas diretamente`,
                }))}
                emptyMessage="Ninguém ajudou outros membros ainda."
                activeTab="comunidade"
                onTabChange={(tab) => {
                  if (tab === "equipe") goTo(2);
                }}
              />
            </div>
          )}

          {/* SLIDE 3: Top 5 da Equipe (Pódio) */}
          {slideIndex === 2 && (
            <div className="flex flex-1 flex-col justify-center min-h-0 animate-in fade-in duration-500 px-[4vw]">
              <PodiumView
                title="Destaques da Equipe"
                subtitle="atendimentos assumidos e velocidade de resposta da equipe técnica"
                items={data.live.top_equipe.map((t) => ({
                  id: t.id,
                  name: t.nome,
                  avatar: t.avatar_url,
                  sub: `1ª resposta ${fMin(t.mediana_min)} · ${fPct(pct(t.dentro_sla, t.respondidas))} dentro do SLA`,
                  value: t.assumidas,
                  unit: t.assumidas === 1 ? "atendimento" : "atendimentos",
                  extra: `${fInt(t.resolvidas)} atendimentos resolvidos`,
                }))}
                emptyMessage="Nenhum atendimento assumido ainda."
                activeTab="equipe"
                onTabChange={(tab) => {
                  if (tab === "comunidade") goTo(1);
                }}
              />
            </div>
          )}

          {/* SLIDE 4: Quem Resolveu (Gráfico de Pizza em Tela Cheia) */}
          {slideIndex === 3 && (
            <div className="flex flex-1 flex-col justify-center min-h-0 animate-in fade-in duration-500 px-[4vw]">
              <Panel
                title="Quem resolveu"
                subtitle={`${fInt(s.threads)} threads no período analisado`}
                className="h-[76vh] w-full"
              >
                <div className="grid h-full grid-cols-12 gap-[3vw] items-center">
                  <div className="col-span-6 flex h-full items-center justify-center animate-in fade-in zoom-in-95 duration-700">
                    <div className="h-[52vh] w-full">
                      <ResolutionDonut resolucao={data.live.resolucao} big className="tv-chart h-full!" />
                    </div>
                  </div>
                  <div className="col-span-6 flex flex-col gap-[1.8vh] justify-center animate-in fade-in slide-in-from-right-4 duration-600">
                    <div className="rounded-[1.2vh] border border-border/80 bg-card/60 px-[1.5vw] py-[1.8vh]">
                      <span className="text-[1.5vh] uppercase tracking-wider text-muted-foreground font-semibold">Total de Threads</span>
                      <div className="text-[5.5vh] font-extrabold leading-none tabular mt-[0.5vh]">
                        <AnimatedNumber value={s.threads} format={(v) => fInt(v ?? 0)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-[1.4vh]">
                      <div className="rounded-[1.2vh] border border-success/30 bg-card/40 p-[1.5vh] flex flex-col gap-[0.6vh]">
                        <div className="flex items-baseline justify-between">
                          <span className="text-[1.6vh] font-medium text-success">Comunidade</span>
                          <span className="text-[1.8vh] font-bold text-success">{pct(data.live.resolucao.comunidade, s.threads)}%</span>
                        </div>
                        <span className="text-[3.5vh] font-extrabold tabular leading-none">{fInt(data.live.resolucao.comunidade)}</span>
                        <span className="text-[1.35vh] text-muted-foreground">resolvidas por membros</span>
                      </div>
                      <div className="rounded-[1.2vh] border border-primary/30 bg-card/40 p-[1.5vh] flex flex-col gap-[0.6vh]">
                        <div className="flex items-baseline justify-between">
                          <span className="text-[1.6vh] font-medium text-primary">Equipe</span>
                          <span className="text-[1.8vh] font-bold text-primary">{pct(data.live.resolucao.equipe, s.threads)}%</span>
                        </div>
                        <span className="text-[3.5vh] font-extrabold tabular leading-none">{fInt(data.live.resolucao.equipe)}</span>
                        <span className="text-[1.35vh] text-muted-foreground">atendidas pelo suporte</span>
                      </div>
                      <div className="rounded-[1.2vh] border border-border/60 bg-card/40 p-[1.5vh] flex flex-col gap-[0.6vh]">
                        <div className="flex items-baseline justify-between">
                          <span className="text-[1.6vh] font-medium text-[#7c9ee0]">Os Dois</span>
                          <span className="text-[1.8vh] font-bold text-[#7c9ee0]">{pct(data.live.resolucao.ambos, s.threads)}%</span>
                        </div>
                        <span className="text-[3.5vh] font-extrabold tabular leading-none">{fInt(data.live.resolucao.ambos)}</span>
                        <span className="text-[1.35vh] text-muted-foreground">atuação conjunta</span>
                      </div>
                      <div className="rounded-[1.2vh] border border-destructive/30 bg-card/40 p-[1.5vh] flex flex-col gap-[0.6vh]">
                        <div className="flex items-baseline justify-between">
                          <span className="text-[1.6vh] font-medium text-destructive">Sem Resposta</span>
                          <span className="text-[1.8vh] font-bold text-destructive">{pct(data.live.resolucao.sem_resposta, s.threads)}%</span>
                        </div>
                        <span className="text-[3.5vh] font-extrabold tabular leading-none">{fInt(data.live.resolucao.sem_resposta)}</span>
                        <span className="text-[1.35vh] text-muted-foreground">sem retorno no período</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          )}

          {/* SLIDE 5: Tendência de Threads (Gráfico de Linha em Tela Cheia) */}
          {slideIndex === 4 && (
            <div className="flex flex-1 flex-col justify-center min-h-0 animate-in fade-in duration-500 px-[4vw]">
              <Panel
                title="Threads por dia"
                subtitle="evolução diária de comunidade, equipe e sem resposta"
                className="h-[76vh] w-full flex flex-col"
              >
                <div className="flex items-center justify-end gap-[0.8vw] pb-[1vh]">
                  <div className="flex rounded-lg border border-border bg-card/60 p-[0.3vh]">
                    <button
                      type="button"
                      onClick={() => setTrendView("7d")}
                      className={cn(
                        "rounded-[0.6vh] px-[0.8vw] py-[0.4vh] text-[1.3vh] font-semibold transition-all",
                        trendView === "7d" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Últimos 7 dias
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrendView("hoje")}
                      className={cn(
                        "rounded-[0.6vh] px-[0.8vw] py-[0.4vh] text-[1.3vh] font-semibold transition-all",
                        trendView === "hoje" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Hoje (hora a hora)
                    </button>
                  </div>
                </div>
                <div key={`${slideIndex}-${trendView}`} className="h-[62vh] w-full">
                  {trendView === "7d" ? (
                    <TrendChart serie={data.live.serie} className="tv-chart" />
                  ) : (
                    <TodayChart hoje={data.live.hoje} className="tv-chart" />
                  )}
                </div>
              </Panel>
            </div>
          )}
        </div>
      ) : (
        <>
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
        </>
      )}
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
function Ranking({ rows, empty, variant = "compact" }: { rows: RankRow[]; empty: string; variant?: "compact" | "tv" }) {
  if (!rows.length) return <div className="flex h-full items-center justify-center text-[1.8vh] text-muted-foreground">{empty}</div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  // Ordem estável por id: a posição vem do transform, para a troca deslizar.
  const byId = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return (
    <div className="relative h-full">
      {byId.map((r) => (
        <RankItem key={r.id} row={r} position={rows.findIndex((x) => x.id === r.id)} max={max} variant={variant} />
      ))}
    </div>
  );
}

const MEDAL_STYLES = [
  {
    // 1º Ouro
    badge:
      "bg-gradient-to-b from-[#FFF59D] via-[#FBC02D] to-[#F57F17] text-[#2E1C00] shadow-[0_0_14px_rgba(251,192,45,0.5),inset_0_1.5px_2px_rgba(255,255,255,0.9)] ring-2 ring-[#FFEE58]",
    bar: "bg-gradient-to-r from-[#FBC02D] via-[#FFD54F] to-[#FFF9C4]",
    glow: "bg-amber-400/5",
  },
  {
    // 2º Prata
    badge:
      "bg-gradient-to-b from-[#FFFFFF] via-[#CFD8DC] to-[#90A4AE] text-[#1A252C] shadow-[0_0_12px_rgba(207,216,220,0.5),inset_0_1.5px_2px_rgba(255,255,255,0.95)] ring-2 ring-white/80",
    bar: "bg-gradient-to-r from-[#90A4AE] via-[#CFD8DC] to-white",
    glow: "bg-slate-300/5",
  },
  {
    // 3º Bronze
    badge:
      "bg-gradient-to-b from-[#FFCCBC] via-[#D7A87A] to-[#8D5B4C] text-[#240D04] shadow-[0_0_12px_rgba(215,168,122,0.45),inset_0_1.5px_2px_rgba(255,255,255,0.7)] ring-2 ring-[#FFAB91]/80",
    bar: "bg-gradient-to-r from-[#8D5B4C] via-[#D7A87A] to-[#FFCCBC]",
    glow: "bg-orange-950/10",
  },
];

function RankItem({ row: r, position, max, variant = "compact" }: { row: RankRow; position: number; max: number; variant?: "compact" | "tv" }) {
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

  const medalStyle = MEDAL_STYLES[position];
  const isTv = variant === "tv";
  return (
    <div className="absolute inset-x-0 top-0 h-1/5 py-[0.5vh] transition-transform duration-700 ease-out" style={{ transform: `translateY(${position * 100}%)` }}>
      <div
        className={cn(
          "flex h-full items-center rounded-[1.2vh] transition-colors duration-700",
          isTv ? "gap-[1.2vw] px-[1.2vw]" : "gap-[0.8vw] px-[0.6vw]",
          flash ? "bg-success/15 ring-1 ring-success/50" : medalStyle?.glow ?? "bg-transparent",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full tabular transition-transform duration-300",
            isTv ? "size-[5.6vh] text-[2.7vh]" : "size-[4.2vh] text-[2.1vh]",
            medalStyle ? `${medalStyle.badge} font-black scale-105` : "bg-muted/40 text-muted-foreground border border-border/60 font-semibold",
          )}
        >
          {position + 1}
        </span>
        <Avatar name={r.name} src={r.avatar} className={cn(isTv ? "size-[6.8vh]! text-[2.2vh]!" : "size-[5vh]! text-[1.8vh]!", "shrink-0")} />
        <div className="flex min-w-0 flex-1 flex-col gap-[0.5vh]">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate font-semibold", isTv ? "text-[2.6vh]" : "text-[2.1vh]")}>{r.name}</span>
            <span className={cn("shrink-0 font-bold tabular", isTv ? "text-[3.4vh]" : "text-[2.6vh]")}>
              <AnimatedNumber value={r.value} format={(v) => fInt(v ?? 0)} duration={1200} />{" "}
              <span className={cn("font-medium text-muted-foreground", isTv ? "text-[1.8vh]" : "text-[1.4vh]")}>{r.unit}</span>
            </span>
          </div>
          <div className={cn("overflow-hidden rounded-full bg-muted/60", isTv ? "h-[1.2vh]" : "h-[0.8vh]")}>
            <div
              className={cn("h-full rounded-full transition-[width] duration-1000 ease-out", medalStyle ? medalStyle.bar : "bg-gradient-to-r from-primary to-success")}
              style={{ width: `${(100 * r.value) / max}%` }}
            />
          </div>
          <span className={cn("truncate text-muted-foreground", isTv ? "text-[1.7vh]" : "text-[1.45vh]")}>
            {r.sub} · {r.extra}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Relógio só no navegador: no servidor a hora seria outra e quebraria a hidratação. */
function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  if (!now) return { time: "--:--:--", date: " " };
  return {
    time: now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    date: now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" }),
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
