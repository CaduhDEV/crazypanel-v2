"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MetricsPayload } from "@/lib/reports/data";

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
  const days = initial.days;
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/metrics?dias=${days}`, { cache: "no-store" });
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
  }, [days]);

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
      .channel(`metrics-live-${days}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_events" }, soon)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [refresh, days]);

  return { data, updatedAt, refreshing, error, refresh };
}

/** Número que conta até o valor novo quando ele muda. */
export function AnimatedNumber({ value, format, duration = 900 }: { value: number | null; format: (v: number | null) => string; duration?: number }) {
  const [shown, setShown] = useState<number | null>(value);
  const from = useRef<number | null>(value);

  useEffect(() => {
    if (value === null || from.current === null) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const diff = value - start;
    if (!diff) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + diff * eased;
      setShown(Number.isInteger(value) && Number.isInteger(start) ? Math.round(v) : Math.round(v * 10) / 10);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, duration]);

  return <>{format(shown)}</>;
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
