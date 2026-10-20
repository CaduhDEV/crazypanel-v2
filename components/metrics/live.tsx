"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MetricsPayload } from "@/lib/reports/data";
import { periodQuery } from "@/lib/reports/period";

/**
 * Métricas ao vivo: busca de novo a cada `intervalMs` e, em segundos, quando
 * chega mensagem ou muda um atendimento (Realtime do Supabase). Quem usa
 * recria o componente (key) ao trocar de período.
 */
export function useLiveMetrics(initial: MetricsPayload, intervalMs = 60_000) {
  const [data, setData] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = periodQuery(initial.period);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/metrics?${query}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Falha ao atualizar.");
      setData(body as MetricsPayload);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao atualizar.");
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  useEffect(() => {
    const soon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 2500);
    };
    const supabase = createClient();
    const channel = supabase
      .channel(`metrics-live-${query}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_events" }, soon)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [refresh, query]);

  return { data, updatedAt, refreshing, error, refresh };
}

/**
 * Número com animação de roleta vertical (odômetro) sem piscar a tela.
 * A velocidade é proporcional à variação do número.
 */
export function AnimatedNumber({
  value,
  format,
  duration,
}: {
  value: number | null;
  format: (v: number | null) => string;
  duration?: number;
}) {
  const prevRef = useRef<number | null>(value);
  const [animDuration, setAnimDuration] = useState(700);

  useEffect(() => {
    if (value !== null && prevRef.current !== null && value !== prevRef.current) {
      const diff = Math.abs(value - prevRef.current);
      // Quanto maior o número que mudou, mais rápido/dinâmico o tempo
      const calcDuration = duration ?? Math.min(1400, Math.max(500, 500 + diff * 60));
      setAnimDuration(calcDuration);
    }
    prevRef.current = value;
  }, [value, duration]);

  if (value === null) return <>{format(null)}</>;

  const text = format(value);

  return (
    <span className="inline-flex items-baseline overflow-hidden select-none">
      {text.split("").map((char, idx) => {
        const isDigit = /\d/.test(char);
        if (!isDigit) {
          return (
            <span key={idx} className="inline-block">
              {char}
            </span>
          );
        }
        const digit = parseInt(char, 10);
        return (
          <span
            key={idx}
            className="inline-block overflow-hidden tabular"
            style={{ height: "1em", verticalAlign: "top", width: "0.62em", textAlign: "center" }}
          >
            <span
              className="flex flex-col transition-transform ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{
                transform: `translateY(-${digit * 10}%)`,
                transitionDuration: `${animDuration}ms`,
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <span key={n} style={{ height: "1em" }} className="flex items-center justify-center">
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** "atualizado há 12 s", recalculado a cada segundo. */
export function useSince(ts: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}
