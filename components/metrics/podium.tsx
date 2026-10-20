"use client";

import { useEffect, useRef } from "react";
import { Crown, Flame, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedNumber } from "@/components/metrics/live";
import { fInt } from "@/lib/reports/format";

export type PodiumItem = {
  id: string;
  name: string;
  avatar: string | null;
  sub: string;
  value: number;
  unit: string;
  extra?: string;
};

/** Efeito contínuo e suave de confetes caindo pelo ranking */
function ConfettiEffect() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = canvas.offsetWidth);
    let height = (canvas.height = canvas.offsetHeight);

    const onResize = () => {
      if (!canvas) return;
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener("resize", onResize);

    // Paleta festiva e elegante: ouro, prata, bronze, azul e verde
    const COLORS = [
      "#F59E0B", // ouro brilhante
      "#FCD34D", // ouro claro
      "#E2E8F0", // prata reluzente
      "#CBD5E1", // prata suave
      "#CD7F32", // bronze clássico
      "#D97706", // bronze quente
      "#3B82F6", // azul primary
      "#10B981", // verde sucesso
    ];

    const count = 48;
    // Partículas distribuídas por toda a altura logo no início para visual instantâneo
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      w: 8 + Math.random() * 8,
      h: 5 + Math.random() * 6,
      vx: (Math.random() - 0.5) * 1.4,
      vy: 1.2 + Math.random() * 1.8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.06,
      swaySpeed: 0.015 + Math.random() * 0.025,
      swayAmp: 16 + Math.random() * 20,
      swayOffset: Math.random() * Math.PI * 2,
      opacity: 0.75 + Math.random() * 0.25,
    }));

    let lastTime = performance.now();

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.y += p.vy * (dt * 60);
        p.rotation += p.rotationSpeed * (dt * 60);
        const currentX = p.x + Math.sin(now * p.swaySpeed * 0.05 + p.swayOffset) * p.swayAmp * 0.05 + p.vx;

        // Se passar da base, recicla suavemente para o topo
        if (p.y > height + 20) {
          p.y = -15 - Math.random() * 25;
          p.x = Math.random() * width;
        }

        ctx.save();
        ctx.translate(currentX, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-30 h-full w-full rounded-[1.6vh]" />;
}

export function PodiumView({
  title,
  subtitle,
  items,
  emptyMessage,
  activeTab,
  onTabChange,
  className,
}: {
  title: string;
  subtitle?: string;
  items: PodiumItem[];
  emptyMessage: string;
  activeTab?: "comunidade" | "equipe";
  onTabChange?: (tab: "comunidade" | "equipe") => void;
  className?: string;
}) {
  if (!items.length) {
    return (
      <div className={cn("tv-card flex h-[76vh] w-full flex-col items-center justify-center rounded-[1.6vh] border border-border p-[3vh]", className)}>
        <Trophy className="size-[6vh] text-muted-foreground/40 mb-[1.5vh]" />
        <span className="text-[2vh] text-muted-foreground">{emptyMessage}</span>
      </div>
    );
  }

  const first = items[0];
  const second = items[1];
  const third = items[2];
  const fourth = items[3];
  const fifth = items[4];

  const thirdValue = third?.value ?? 0;

  return (
    <div className={cn("tv-card relative overflow-hidden flex h-[76vh] w-full flex-col justify-between rounded-[1.6vh] border border-border/80 px-[2vw] py-[2.4vh]", className)}>
      {/* Confetes descendo */}
      <ConfettiEffect key={activeTab ?? title} />

      {/* Cabeçalho do Painel */}
      <div className="flex shrink-0 items-center justify-between pb-[1vh]">
        <div className="flex items-center gap-[0.8vw]">
          <div className="flex size-[4.2vh] items-center justify-center rounded-[1vh] border border-amber-400/40 bg-amber-400/15 shadow-[0_0_20px_rgba(245,158,11,0.3)]">
            <Trophy className="size-[2.4vh] text-amber-400" />
          </div>
          <div className="flex flex-col">
            <h2 className="text-[2.4vh] font-extrabold tracking-tight text-foreground">{title}</h2>
            {subtitle && <span className="text-[1.35vh] text-muted-foreground">{subtitle}</span>}
          </div>
        </div>

        {/* Toggle Opcional de Abas (Comunidade / Equipe) */}
        {activeTab && onTabChange && (
          <div className="flex rounded-lg border border-border bg-card/60 p-[0.3vh]">
            <button
              type="button"
              onClick={() => onTabChange("comunidade")}
              className={cn(
                "rounded-[0.6vh] px-[1vw] py-[0.45vh] text-[1.3vh] font-semibold transition-all",
                activeTab === "comunidade" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Comunidade
            </button>
            <button
              type="button"
              onClick={() => onTabChange("equipe")}
              className={cn(
                "rounded-[0.6vh] px-[1vw] py-[0.45vh] text-[1.3vh] font-semibold transition-all",
                activeTab === "equipe" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Equipe
            </button>
          </div>
        )}
      </div>

      {/* Linha do Pódio: 2º Lugar, 1º Campeão, 3º Lugar */}
      <div className="flex flex-1 min-h-0 items-end justify-center gap-[1.8vw] pt-[2.2vh] pb-[2.4vh]">
        {/* 2º LUGAR (Prata Mais Prateado com Halo Prateado/Cromado) */}
        <div className="relative flex flex-1 h-[90%] max-w-[420px] flex-col items-center justify-between rounded-[1.6vh] border-2 border-slate-300/80 bg-gradient-to-b from-slate-200/20 via-slate-800/35 to-card/95 px-[1.6vw] pt-[2.8vh] pb-[2.2vh] text-center shadow-[0_0_45px_rgba(226,232,240,0.25),inset_0_1px_3px_rgba(255,255,255,0.45)] ring-1 ring-slate-300/50 backdrop-blur-md transition-all hover:border-slate-200 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out fill-mode-both">
          {/* Brilho atrás do card: prata luminoso */}
          <div className="pointer-events-none absolute -inset-[2vw] -z-10 rounded-[3vh] bg-[radial-gradient(ellipse_at_center,rgba(226,232,240,0.36)_0%,rgba(148,163,184,0.18)_45%,transparent_75%)] blur-2xl" />
          <div className="pointer-events-none absolute -inset-[1vw] -z-10 rounded-[3vh] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.2)_0%,transparent_60%)] blur-lg" />

          <div className="absolute -top-[1.4vh] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-slate-100 via-white to-slate-200 px-[1.2vw] py-[0.4vh] text-[1.2vh] font-black uppercase tracking-wider text-slate-900 shadow-[0_0_20px_rgba(226,232,240,0.6)] ring-2 ring-white/95">
            2º LUGAR
          </div>
          {second ? (
            <>
              <Avatar name={second.name} src={second.avatar} className="size-[8.2vh]! text-[2.8vh]! shrink-0 rounded-full ring-4 ring-slate-200 shadow-[0_0_28px_rgba(226,232,240,0.45)]" />
              <div className="flex flex-col items-center gap-[0.3vh] w-full px-[0.5vw]">
                <span className="line-clamp-2 text-balance text-[2vh] font-bold tracking-tight text-foreground leading-snug">{second.name}</span>
                <span className="truncate max-w-[95%] text-[1.3vh] text-slate-300/80">{second.sub}</span>
              </div>
              <div className="flex flex-col items-center my-[0.5vh]">
                <span className="text-[5.4vh] font-black tabular leading-none text-slate-100 drop-shadow-[0_0_18px_rgba(226,232,240,0.35)]">
                  <AnimatedNumber value={second.value} format={(v) => fInt(v ?? 0)} duration={1200} />
                </span>
                <span className="text-[1.25vh] font-semibold uppercase tracking-wider text-slate-300/90 mt-[0.4vh]">{second.unit}</span>
              </div>
              <span className="text-[1.25vh] font-medium text-slate-200/90">{second.extra}</span>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[1.5vh] text-muted-foreground">Vaga aberta</div>
          )}
        </div>

        {/* 1º CAMPEÃO (Ouro Mais Dourado com Halo Dourado Rico e Brilho Quente) */}
        <div className="relative flex flex-[1.22] h-full max-w-[480px] flex-col items-center justify-between rounded-[1.8vh] border-2 border-amber-400 bg-gradient-to-b from-amber-500/25 via-amber-950/25 to-card/95 px-[2vw] pt-[3.2vh] pb-[2.6vh] text-center shadow-[0_0_60px_rgba(245,158,11,0.38),inset_0_1px_3px_rgba(251,191,36,0.5)] ring-2 ring-amber-400/60 backdrop-blur-md transition-all hover:border-amber-300 animate-in fade-in slide-in-from-bottom-10 zoom-in-95 duration-750 delay-100 ease-out fill-mode-both">
          {/* Brilho atrás do card: ouro rico e profundo */}
          <div className="pointer-events-none absolute -inset-[2.2vw] -z-10 rounded-[3vh] bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.45)_0%,rgba(217,119,6,0.25)_45%,transparent_75%)] blur-2xl" />
          <div className="pointer-events-none absolute -inset-[1vw] -z-10 rounded-[3vh] bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.3)_0%,transparent_60%)] blur-lg" />

          <div className="absolute -top-[1.6vh] left-1/2 flex -translate-x-1/2 items-center gap-[0.4vw] whitespace-nowrap rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 px-[1.6vw] py-[0.5vh] text-[1.35vh] font-black uppercase tracking-wider text-[#241400] shadow-[0_0_30px_rgba(245,158,11,0.75)] ring-2 ring-amber-200">
            <Crown className="size-[1.6vh] fill-amber-950 text-amber-950" />
            1º CAMPEÃO
          </div>
          {first ? (
            <>
              <Avatar name={first.name} src={first.avatar} className="size-[10vh]! text-[3.4vh]! shrink-0 rounded-full ring-4 ring-amber-400 shadow-[0_0_36px_rgba(245,158,11,0.65)]" />
              <div className="flex flex-col items-center gap-[0.3vh] w-full px-[0.5vw]">
                <span className="line-clamp-2 text-balance text-[2.3vh] font-extrabold tracking-tight text-foreground leading-snug">{first.name}</span>
                <span className="truncate max-w-[95%] text-[1.4vh] font-semibold text-amber-200">{first.sub}</span>
              </div>
              <div className="flex flex-col items-center my-[0.5vh]">
                <span className="text-[6.8vh] font-black tabular leading-none text-amber-400 drop-shadow-[0_0_24px_rgba(245,158,11,0.5)]">
                  <AnimatedNumber value={first.value} format={(v) => fInt(v ?? 0)} duration={1200} />
                </span>
                <span className="text-[1.35vh] font-bold uppercase tracking-wider text-amber-300 mt-[0.4vh]">{first.unit}</span>
              </div>
              <span className="text-[1.35vh] font-medium text-amber-100">{first.extra}</span>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[1.5vh] text-muted-foreground">Vaga aberta</div>
          )}
        </div>

        {/* 3º LUGAR (Bronze Mais Cor de Bronze/Cobre com Halo Metálico Quente) */}
        <div className="relative flex flex-1 h-[86%] max-w-[420px] flex-col items-center justify-between rounded-[1.6vh] border-2 border-[#cd7f32]/85 bg-gradient-to-b from-[#cd7f32]/22 via-amber-950/35 to-card/95 px-[1.6vw] pt-[2.8vh] pb-[2.2vh] text-center shadow-[0_0_45px_rgba(205,127,50,0.3),inset_0_1px_3px_rgba(245,158,11,0.4)] ring-1 ring-[#cd7f32]/50 backdrop-blur-md transition-all hover:border-[#d97736] animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 ease-out fill-mode-both">
          {/* Brilho atrás do card: bronze metálico clássico */}
          <div className="pointer-events-none absolute -inset-[2vw] -z-10 rounded-[3vh] bg-[radial-gradient(ellipse_at_center,rgba(205,127,50,0.42)_0%,rgba(180,83,9,0.22)_45%,transparent_75%)] blur-2xl" />
          <div className="pointer-events-none absolute -inset-[1vw] -z-10 rounded-[3vh] bg-[radial-gradient(ellipse_at_center,rgba(217,119,6,0.25)_0%,transparent_60%)] blur-lg" />

          <div className="absolute -top-[1.4vh] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-[#e08945] via-[#cd7f32] to-[#a05215] px-[1.2vw] py-[0.4vh] text-[1.2vh] font-black uppercase tracking-wider text-[#240d04] shadow-[0_0_20px_rgba(205,127,50,0.55)] ring-2 ring-[#f0a667]">
            3º LUGAR
          </div>
          {third ? (
            <>
              <Avatar name={third.name} src={third.avatar} className="size-[8.2vh]! text-[2.8vh]! shrink-0 rounded-full ring-4 ring-[#cd7f32] shadow-[0_0_28px_rgba(205,127,50,0.45)]" />
              <div className="flex flex-col items-center gap-[0.3vh] w-full px-[0.5vw]">
                <span className="line-clamp-2 text-balance text-[2vh] font-bold tracking-tight text-foreground leading-snug">{third.name}</span>
                <span className="truncate max-w-[95%] text-[1.3vh] text-amber-200/80">{third.sub}</span>
              </div>
              <div className="flex flex-col items-center my-[0.5vh]">
                <span className="text-[5.4vh] font-black tabular leading-none text-[#f3a464] drop-shadow-[0_0_18px_rgba(205,127,50,0.4)]">
                  <AnimatedNumber value={third.value} format={(v) => fInt(v ?? 0)} duration={1200} />
                </span>
                <span className="text-[1.25vh] font-semibold uppercase tracking-wider text-amber-300/80 mt-[0.4vh]">{third.unit}</span>
              </div>
              <span className="text-[1.25vh] font-medium text-amber-300/90">{third.extra}</span>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[1.5vh] text-muted-foreground">Vaga aberta</div>
          )}
        </div>
      </div>

      {/* Linha Inferior: NA DISPUTA PELO PÓDIO (4º e 5º Lugares) */}
      <div className="shrink-0 flex flex-col gap-[0.8vh] pt-[1vh] border-t border-border/60 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200 ease-out fill-mode-both">
        <div className="flex items-center gap-[0.5vw]">
          <Flame className="size-[1.6vh] text-amber-400" />
          <span className="text-[1.3vh] font-bold uppercase tracking-wider text-muted-foreground">Na disputa pelo pódio</span>
        </div>

        <div className="grid grid-cols-2 gap-[1.4vw]">
          {/* 4º Lugar */}
          {fourth ? (
            <div className="flex items-center justify-between rounded-[1.2vh] border border-border/80 bg-card/60 px-[1.3vw] py-[1.2vh] backdrop-blur-md transition-all hover:border-border">
              <div className="flex items-center gap-[0.8vw] min-w-0">
                <span className="flex size-[3.8vh] shrink-0 items-center justify-center rounded-[0.8vh] border border-border/80 bg-muted/60 text-[1.4vh] font-extrabold text-muted-foreground tabular">
                  4º
                </span>
                <Avatar name={fourth.name} src={fourth.avatar} className="size-[5.2vh]! text-[1.8vh]! shrink-0 rounded-full ring-1 ring-border" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[1.8vh] font-semibold text-foreground">{fourth.name}</span>
                  <span className="truncate text-[1.3vh] text-muted-foreground">
                    {fourth.sub} · {fInt(fourth.value)} {fourth.unit}
                  </span>
                </div>
              </div>
              <div className="shrink-0 pl-[1vw]">
                {third ? (
                  <span className="inline-flex items-center rounded-[0.8vh] border border-amber-400/30 bg-amber-400/10 px-[0.9vw] py-[0.5vh] text-[1.35vh] font-bold text-amber-400">
                    {thirdValue - fourth.value > 0
                      ? `faltam ${fInt(thirdValue - fourth.value)} para o pódio`
                      : "empatado com o 3º"}
                  </span>
                ) : (
                  <span className="text-[1.35vh] text-muted-foreground">{fourth.extra}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-[1.2vh] border border-dashed border-border/50 py-[1.4vh] text-[1.3vh] text-muted-foreground">
              4º lugar vago
            </div>
          )}

          {/* 5º Lugar */}
          {fifth ? (
            <div className="flex items-center justify-between rounded-[1.2vh] border border-border/80 bg-card/60 px-[1.3vw] py-[1.2vh] backdrop-blur-md transition-all hover:border-border">
              <div className="flex items-center gap-[0.8vw] min-w-0">
                <span className="flex size-[3.8vh] shrink-0 items-center justify-center rounded-[0.8vh] border border-border/80 bg-muted/60 text-[1.4vh] font-extrabold text-muted-foreground tabular">
                  5º
                </span>
                <Avatar name={fifth.name} src={fifth.avatar} className="size-[5.2vh]! text-[1.8vh]! shrink-0 rounded-full ring-1 ring-border" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[1.8vh] font-semibold text-foreground">{fifth.name}</span>
                  <span className="truncate text-[1.3vh] text-muted-foreground">
                    {fifth.sub} · {fInt(fifth.value)} {fifth.unit}
                  </span>
                </div>
              </div>
              <div className="shrink-0 pl-[1vw]">
                {third ? (
                  <span className="inline-flex items-center rounded-[0.8vh] border border-amber-400/30 bg-amber-400/10 px-[0.9vw] py-[0.5vh] text-[1.35vh] font-bold text-amber-400">
                    {thirdValue - fifth.value > 0
                      ? `faltam ${fInt(thirdValue - fifth.value)} para o pódio`
                      : "empatado com o 3º"}
                  </span>
                ) : (
                  <span className="text-[1.35vh] text-muted-foreground">{fifth.extra}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-[1.2vh] border border-dashed border-border/50 py-[1.4vh] text-[1.3vh] text-muted-foreground">
              5º lugar vago
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
