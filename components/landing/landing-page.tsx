"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, LogIn, Plus, Zap } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

interface Ticket {
  id: string;
  avatar: string;
  name: string;
  channel: string;
  preview: string;
  status: "ok" | "alert" | "crit";
  seconds: number;
}

const SAMPLE_CLIENTS = [
  { name: "Lucas Fonseca", channel: "WhatsApp Direto", preview: "Como configurar o webhook de eventos no n8n?" },
  { name: "Mariana Siqueira", channel: "Comunidade VIP", preview: "Preciso ajustar o limite de disparos diários na instância." },
  { name: "Renan Ribeiro", channel: "API & Integrações", preview: "Erro 429 na rota de sincronização de contatos." },
  { name: "TechCorp Suporte", channel: "Comunidade CRM", preview: "Dúvida sobre transferência de fila para atendentes." },
  { name: "Beatriz Nogueira", channel: "WhatsApp Direto", preview: "Urgente: mensagens em lote pausadas no gateway." },
];

export function LandingPage() {
  const [tickets, setTickets] = useState<Ticket[]>([
    {
      id: "1",
      avatar: "G",
      name: "Guinho",
      channel: "Comunidade CRM",
      preview: "Preciso alinhar a chave do webhook de eventos...",
      status: "ok",
      seconds: 132,
    },
    {
      id: "2",
      avatar: "C",
      name: "Carlus",
      channel: "API & Integrações",
      preview: "A resposta da rota de disparos está dando 429...",
      status: "alert",
      seconds: 245,
    },
    {
      id: "3",
      avatar: "S",
      name: "Stevam.ecom BR",
      channel: "Comunidade CRM",
      preview: "Urgente: mensagens em lote travadas na fila!",
      status: "crit",
      seconds: 1422,
    },
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTickets((prev) =>
        prev.map((t) => ({
          ...t,
          seconds: t.seconds + 1,
        }))
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const rem = (s % 60).toString().padStart(2, "0");
    return `${m}:${rem}`;
  };

  const simulateNewTicket = () => {
    const random = SAMPLE_CLIENTS[Math.floor(Math.random() * SAMPLE_CLIENTS.length)];
    const newTicket: Ticket = {
      id: String(Date.now()),
      avatar: random.name[0],
      name: random.name,
      channel: random.channel,
      preview: random.preview,
      status: "ok",
      seconds: 2,
    };
    // Mantém no máximo 4 chamados na fila para preservar a altura e a harmonia do card
    setTickets((prev) => [newTicket, ...prev].slice(0, 4));
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Topbar da Landing Page */}
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-border bg-background/95 px-6 backdrop-blur-sm sm:px-10">
        <Logo />
        <div className="flex items-center gap-3">
          <Link
            href="/esqueci-senha"
            className="rounded-md border border-border px-3.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Recuperar Acesso
          </Link>
          <Button asChild size="sm" className="font-semibold">
            <Link href="/login" className="flex items-center gap-1.5">
              <LogIn className="size-3.5" />
              <span>Entrar no Painel</span>
            </Link>
          </Button>
        </div>
      </header>

      {/* Hero Principal */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 items-center px-6 py-12 sm:px-10 lg:py-16">
        <div className="grid w-full items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          
          {/* Lado Esquerdo: Copy Humanizada & CTAs */}
          <div className="flex flex-col gap-6">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
              <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
              <span>Fila WhatsApp Operando em Alta Performance</span>
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl lg:leading-[1.15]">
              Atendimento WhatsApp sem mensagens perdidas nem{" "}
              <span className="text-primary">clientes no vácuo.</span>
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Organize cada conversa por SLA ao vivo, identifique tickets prestes a estourar e mantenha seus atendentes focados nos clientes mais urgentes — tudo integrado à base de dados da sua empresa.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button asChild size="lg" className="font-semibold shadow-md">
                <Link href="/login" className="flex items-center gap-2">
                  <span>Acessar Área do Atendente</span>
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={simulateNewTicket}
                className="flex items-center gap-2"
              >
                <Plus className="size-4" />
                <span>Simular Novo Chamado</span>
              </Button>
            </div>

            {/* Faixa de Métricas */}
            <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-6">
              <div className="flex flex-col">
                <span className="font-mono text-2xl font-bold text-foreground">01:42</span>
                <span className="text-xs text-muted-foreground">Tempo Médio 1ª Resposta</span>
              </div>
              <div className="flex flex-col">
                <span className="font-mono text-2xl font-bold text-foreground">99,4%</span>
                <span className="text-xs text-muted-foreground">SLAs Cumpridos no Mês</span>
              </div>
              <div className="flex flex-col">
                <span className="font-mono text-2xl font-bold text-foreground">0</span>
                <span className="text-xs text-muted-foreground">Conversas Esquecidas</span>
              </div>
            </div>
          </div>

          {/* Lado Direito: Demonstração ao Vivo da Fila */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-xl sm:p-6">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-red-500/80" />
                <span className="size-2.5 rounded-full bg-amber-500/80" />
                <span className="size-2.5 rounded-full bg-emerald-500/80" />
                <span className="ml-2 font-mono text-xs text-muted-foreground">fila-tempo-real.crm</span>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                <Zap className="size-3" />
                ao vivo
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {tickets.map((t) => {
                let badgeCls = "bg-sla-ok text-sla-ok-foreground";
                let label = `NO PRAZO ${formatTime(t.seconds)}`;
                if (t.status === "alert") {
                  badgeCls = "bg-sla-warn text-sla-warn-foreground";
                  label = `EM ALERTA ${formatTime(t.seconds)}`;
                } else if (t.status === "crit") {
                  badgeCls = "bg-sla-breach text-sla-breach-foreground";
                  label = `ESTOURADO ${formatTime(t.seconds)}`;
                }

                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3.5 transition-all hover:border-primary/40 hover:bg-muted/60"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card font-semibold text-primary">
                        {t.avatar}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold text-foreground">{t.name}</span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {t.channel}
                          </span>
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          {t.preview}
                        </span>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded px-2 py-1 font-mono text-[11px] font-bold ${badgeCls}`}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </main>

      {/* Rodapé da Landing */}
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        CrazyPanel · Sistema de Gestão de Atendimentos WhatsApp em Tempo Real
      </footer>
    </div>
  );
}
