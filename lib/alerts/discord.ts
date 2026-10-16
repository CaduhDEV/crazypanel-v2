import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { siteUrl } from "@/lib/site-url";

// Somente servidor. Alertas de conexão no Discord (webhook com embed).

/** discord.com, discordapp.com, ptb. e canary.; /api/webhooks/<id>/<token>. */
export const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
  footer?: { text: string };
}

export async function postDiscord(webhookUrl: string, content: string | null, embed: DiscordEmbed): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "CrazyPanel",
      content: content || undefined,
      // Menções só no texto configurado; nada no embed dispara notificação.
      allowed_mentions: { parse: ["everyone", "roles", "users"] },
      embeds: [embed],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord respondeu ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
}

const COLORS = { down: 0xe5484d, up: 0x30a46c, info: 0x3b6fb3 } as const;

const STATUS_LABEL: Record<string, string> = {
  connected: "Conectado",
  connecting: "Conectando",
  disconnected: "Desconectado",
  hibernated: "Hibernado",
};

export const isDown = (status: string) => status === "disconnected" || status === "hibernated";

/** Embed de queda ou de volta da conexão. */
export function connectionEmbed(log: {
  status: string;
  previous_status: string | null;
  reason: string | null;
  phone: string | null;
  created_at: string;
}, panelUrl: string): DiscordEmbed {
  const down = isDown(log.status);
  const unix = Math.floor(Date.parse(log.created_at) / 1000);
  const phone = log.phone ? `+${log.phone}` : "—";
  return {
    title: down ? "🔴 WhatsApp desconectado" : "🟢 WhatsApp conectado de novo",
    description: down
      ? "A instância da uazapi caiu. Os atendimentos param de chegar até reconectar."
      : "A instância voltou. As mensagens novas voltam a abrir atendimentos.",
    url: panelUrl,
    color: down ? COLORS.down : COLORS.up,
    fields: [
      { name: "Número", value: phone, inline: true },
      { name: "Status", value: `${STATUS_LABEL[log.previous_status ?? ""] ?? log.previous_status ?? "—"} → ${STATUS_LABEL[log.status] ?? log.status}`, inline: true },
      { name: "Quando", value: `<t:${unix}:f> (<t:${unix}:R>)`, inline: false },
      ...(down && log.reason ? [{ name: "Motivo", value: log.reason.slice(0, 1000) }] : []),
    ],
    timestamp: log.created_at,
    footer: { text: "CrazyPanel · Logs de conexão" },
  };
}

export function testEmbed(panelUrl: string, by: string): DiscordEmbed {
  return {
    title: "✅ Alertas do CrazyPanel configurados",
    description: `Este canal vai receber os avisos de queda e de volta da conexão do WhatsApp.\nTeste enviado por ${by}.`,
    url: panelUrl,
    color: COLORS.info,
    timestamp: new Date().toISOString(),
    footer: { text: "CrazyPanel · Logs de conexão" },
  };
}

/**
 * Avalia os logs de conexão ainda não avisados e manda os alertas. Só quedas
 * e voltas (de/para "conectado") avisam; o resto é marcado como skipped.
 * Nunca lança: falha fica registrada no próprio log.
 */
export async function dispatchConnectionAlerts(): Promise<void> {
  const db = createAdminClient();
  try {
    const { data: logs } = await db
      .from("connection_logs")
      .select("id, status, previous_status, reason, phone, created_at")
      .is("alert_status", null)
      .order("created_at", { ascending: true })
      .limit(20);
    if (!logs?.length) return;

    const { data: cfg } = await db
      .from("alert_settings")
      .select("discord_webhook_encrypted, discord_mention, notify_disconnect, notify_reconnect")
      .eq("id", 1)
      .maybeSingle();
    const url = cfg?.discord_webhook_encrypted ? decryptSecret(cfg.discord_webhook_encrypted as string) : null;
    const panelUrl = `${await siteUrl()}/admin/logs`;

    for (const log of logs) {
      const down = isDown(log.status) && log.previous_status === "connected";
      const up = log.status === "connected" && !!log.previous_status && log.previous_status !== "connected";
      const wanted = url && ((down && cfg?.notify_disconnect) || (up && cfg?.notify_reconnect));

      // Marca antes de enviar: dois processos não mandam o mesmo alerta.
      const { data: claimed } = await db
        .from("connection_logs")
        .update({ alert_status: wanted ? "sent" : "skipped" })
        .eq("id", log.id)
        .is("alert_status", null)
        .select("id");
      if (!claimed?.length || !wanted) continue;

      try {
        await postDiscord(url, down ? (cfg?.discord_mention as string | null) : null, connectionEmbed(log, panelUrl));
      } catch (e) {
        await db
          .from("connection_logs")
          .update({ alert_status: "failed", alert_error: e instanceof Error ? e.message.slice(0, 500) : String(e) })
          .eq("id", log.id);
      }
    }
  } catch (e) {
    console.error("[alerts] falha ao despachar alertas de conexão:", e);
  }
}
