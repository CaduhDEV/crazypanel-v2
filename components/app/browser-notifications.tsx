"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app/app-context";

// Notificações do navegador (Notification API). Só funcionam com permissão do
// usuário e em contexto seguro (https ou localhost).

export type PushPermission = NotificationPermission | "unsupported";

export const PUSH_VARIABLES = ["lead", "empresa", "grupo", "mensagem", "numero"] as const;
export type PushVars = Partial<Record<(typeof PUSH_VARIABLES)[number], string | number | null | undefined>>;

/** Troca {lead}, {grupo}… pelos valores; variável sem valor some (sem "{x}" sobrando). */
export function fillTemplate(template: string, vars: PushVars): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key as keyof PushVars] ?? ""))
    .replace(/\s+([·:,.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s·:,-]+|[\s·:,-]+$/g, "")
    .trim();
}

const supported = () => typeof window !== "undefined" && "Notification" in window && window.isSecureContext;
const readPermission = (): PushPermission => (supported() ? Notification.permission : "unsupported");

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribePermission(listener: () => void) {
  listeners.add(listener);
  let status: PermissionStatus | null = null;
  navigator.permissions
    ?.query({ name: "notifications" })
    .then((s) => {
      status = s;
      s.onchange = emit;
    })
    .catch(() => {});
  return () => {
    listeners.delete(listener);
    if (status) status.onchange = null;
  };
}

/** Permissão atual, atualizada quando o usuário muda (pelo pedido ou nas configurações do site). */
export function usePushPermission(): [PushPermission, () => Promise<PushPermission>] {
  const permission = useSyncExternalStore(
    subscribePermission,
    readPermission,
    () => "default" as PushPermission,
  );

  const request = useCallback(async () => {
    if (!supported()) return "unsupported" as const;
    const result = await Notification.requestPermission();
    emit();
    return result;
  }, []);

  return [permission, request];
}

/** Mostra a notificação; clicar foca o painel e chama onClick. */
export function showBrowserNotification(opts: { title: string; body: string; tag?: string; onClick?: () => void }): boolean {
  if (!supported() || Notification.permission !== "granted") return false;
  try {
    const n = new Notification(opts.title, { body: opts.body, tag: opts.tag, icon: "/icon.svg", badge: "/icon.svg" });
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
    return true;
  } catch {
    // Alguns navegadores móveis só aceitam notificação via service worker.
    return false;
  }
}

const PROMPT_DISMISSED_KEY = "crazypanel:push-prompt-dismissed";

/**
 * Ao entrar no painel, se as notificações estão ligadas pelo admin e o
 * navegador ainda não decidiu, oferece permitir. O pedido nativo precisa de um
 * clique do usuário na maioria dos navegadores, por isso o botão.
 */
export function PushPermissionPrompt() {
  const { settings } = useApp();
  const [permission, request] = usePushPermission();

  useEffect(() => {
    if (!settings.push_enabled || permission !== "default") return;
    try {
      if (sessionStorage.getItem(PROMPT_DISMISSED_KEY)) return;
    } catch {}

    const id = toast("Ativar notificações do navegador?", {
      description: "Para saber de atendimentos novos e SLA estourado mesmo com o painel em outra aba.",
      duration: Infinity,
      action: {
        label: "Permitir",
        onClick: async () => {
          const result = await request();
          if (result === "granted") toast.success("Notificações ativadas.");
          else if (result === "denied") toast.error("Notificações bloqueadas.");
        },
      },
      cancel: {
        label: "Agora não",
        onClick: () => {
          try {
            sessionStorage.setItem(PROMPT_DISMISSED_KEY, "1");
          } catch {}
        },
      },
    });
    return () => {
      toast.dismiss(id);
    };
  }, [settings.push_enabled, permission, request]);

  return null;
}
