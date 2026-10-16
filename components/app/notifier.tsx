"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app/app-context";
import { useOpenTickets } from "@/components/app/use-open-tickets";
import { slaInfo, type SlaState } from "@/lib/sla";
import { contactLabel } from "@/lib/utils";
import type { AppSettings, TicketWithRelations } from "@/lib/types";
import { fillTemplate, showBrowserNotification, type PushVars } from "@/components/app/browser-notifications";

// Preferência de som por navegador (conveniência local).
const SOUND_KEY = "crazypanel:sound";
const soundListeners = new Set<() => void>();

function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function useSoundEnabled(): [boolean, (on: boolean) => void] {
  const enabled = useSyncExternalStore(
    (l) => {
      soundListeners.add(l);
      return () => soundListeners.delete(l);
    },
    readSound,
    () => true,
  );
  const set = useCallback((on: boolean) => {
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {}
    soundListeners.forEach((l) => l());
  }, []);
  return [enabled, set];
}

function play(name: "messages" | "warn" | "sla") {
  const audio = new Audio(`/sounds/${name}.mp3`);
  audio.volume = 0.6;
  audio.play().catch(() => {
    // Navegador bloqueia som antes da primeira interação: ignora.
  });
}

const varsOf = (t: TicketWithRelations): PushVars => ({
  lead: contactLabel(t.contact),
  empresa: t.contact?.company?.name,
  grupo: t.group?.name ?? "Grupo",
  mensagem: t.last_message_preview ?? t.subject,
  numero: t.number,
});

/** Notificação do navegador quando o painel não está em foco (com ele à vista, o som e a fila bastam). */
function pushFor(kind: "new" | "breach", t: TicketWithRelations, settings: AppSettings, open: (id: string) => void) {
  if (!settings.push_enabled || (document.visibilityState === "visible" && document.hasFocus())) return;
  const vars = varsOf(t);
  showBrowserNotification({
    title: fillTemplate(kind === "new" ? settings.push_new_title : settings.push_breach_title, vars),
    body: fillTemplate(kind === "new" ? settings.push_new_body : settings.push_breach_body, vars),
    tag: `${kind}:${t.id}`,
    onClick: () => open(t.id),
  });
}

/**
 * Avisa com som e notificação do navegador: atendimento novo na fila, e
 * atendimento sem responsável (ou meu) que entra em alerta ou estoura o SLA.
 * Só avisa em transições. O som depende do admin (push_sound) e da escolha
 * do usuário no menu.
 */
export function TicketNotifier() {
  const { profile, settings } = useApp();
  const { data: tickets } = useOpenTickets();
  const [userSound] = useSoundEnabled();
  const enabled = userSound && settings.push_sound;
  const router = useRouter();
  const openTicket = useCallback((id: string) => router.push(`/atendimento?ticket=${id}`), [router]);
  const known = useRef<Set<string> | null>(null);
  const phases = useRef(new Map<string, SlaState>());

  useEffect(() => {
    if (!tickets) return;
    const ids = new Set(tickets.map((t) => t.id));
    if (known.current) {
      const arrived = tickets.filter((t) => !known.current!.has(t.id) && t.waiting_since);
      if (arrived.length && enabled) play("messages");
      for (const t of arrived.slice(0, 3)) pushFor("new", t, settings, openTicket);
    }
    known.current = ids;
  }, [tickets, enabled, settings, openTicket]);

  useEffect(() => {
    if (!tickets) return;
    const check = () => {
      const now = Date.now();
      let sound: "warn" | "sla" | null = null;
      for (const t of tickets) {
        if (t.assignee_id && t.assignee_id !== profile.id) continue;
        const state = slaInfo(t.waiting_since, now, settings).state;
        const prev = phases.current.get(t.id);
        phases.current.set(t.id, state);
        if (prev === undefined || prev === state) continue;
        if (state === "breach") {
          sound = "sla";
          pushFor("breach", t, settings, openTicket);
        }
        else if (state === "warn" && sound !== "sla") sound = "warn";
      }
      if (sound && enabled) play(sound);
    };
    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [tickets, enabled, profile.id, settings, openTicket]);

  return null;
}
