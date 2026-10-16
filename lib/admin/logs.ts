"use server";

import { after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { siteUrl } from "@/lib/site-url";
import { DISCORD_WEBHOOK_RE, postDiscord, testEmbed } from "@/lib/alerts/discord";
import { processWebhookEvent } from "@/lib/webhook/process";

// =============================================================================
// Alertas (Discord)
// =============================================================================
export interface AlertSettingsView {
  configured: boolean;
  hint: string | null;
  mention: string;
  notifyDisconnect: boolean;
  notifyReconnect: boolean;
  updatedAt: string | null;
}

/** A URL do webhook nunca volta para a tela: só se está configurada e o final dela. */
export async function getAlertSettings(): Promise<ActionResult<AlertSettingsView>> {
  return runAction(z.object({}), {}, async () => {
    await requireAdmin();
    const { data } = await createAdminClient()
      .from("alert_settings")
      .select("discord_webhook_encrypted, discord_webhook_hint, discord_mention, notify_disconnect, notify_reconnect, updated_at")
      .eq("id", 1)
      .maybeSingle();
    return {
      configured: !!data?.discord_webhook_encrypted,
      hint: (data?.discord_webhook_hint as string | null) ?? null,
      mention: (data?.discord_mention as string | null) ?? "",
      notifyDisconnect: data?.notify_disconnect ?? true,
      notifyReconnect: data?.notify_reconnect ?? true,
      updatedAt: (data?.updated_at as string | null) ?? null,
    };
  });
}

const settingsSchema = z.object({
  /** Vazio mantém a URL salva; "remove" apaga. */
  webhookUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || DISCORD_WEBHOOK_RE.test(v), { error: "Cole a URL do webhook do Discord (https://discord.com/api/webhooks/…)." })
    .optional(),
  removeWebhook: z.boolean().default(false),
  mention: z.string().trim().max(120).default(""),
  notifyDisconnect: z.boolean(),
  notifyReconnect: z.boolean(),
});

export async function saveAlertSettings(input: z.input<typeof settingsSchema>): Promise<ActionResult<void>> {
  return runAction(settingsSchema, input, async (s) => {
    const admin = await requireAdmin();
    const patch: Record<string, unknown> = {
      discord_mention: s.mention || null,
      notify_disconnect: s.notifyDisconnect,
      notify_reconnect: s.notifyReconnect,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    };
    if (s.removeWebhook) {
      patch.discord_webhook_encrypted = null;
      patch.discord_webhook_hint = null;
    } else if (s.webhookUrl) {
      patch.discord_webhook_encrypted = encryptSecret(s.webhookUrl);
      patch.discord_webhook_hint = s.webhookUrl.slice(-6);
    }
    const { error } = await createAdminClient().from("alert_settings").update(patch).eq("id", 1);
    if (error) throw error;
  });
}

/** Manda um embed de teste para o webhook salvo. */
export async function sendTestAlert(): Promise<ActionResult<void>> {
  return runAction(z.object({}), {}, async () => {
    const admin = await requireAdmin();
    const { data } = await createAdminClient().from("alert_settings").select("discord_webhook_encrypted, discord_mention").eq("id", 1).maybeSingle();
    if (!data?.discord_webhook_encrypted) throw new ActionError("Salve a URL do webhook antes de testar.");
    try {
      await postDiscord(
        decryptSecret(data.discord_webhook_encrypted as string),
        (data.discord_mention as string | null) ?? null,
        testEmbed(`${await siteUrl()}/admin/logs`, admin.name),
      );
    } catch (e) {
      throw new ActionError(e instanceof Error ? `Não foi possível enviar: ${e.message}` : "Não foi possível enviar.");
    }
  });
}

// =============================================================================
// Eventos do webhook
// =============================================================================
export interface WebhookEventRow {
  id: number;
  event_type: string;
  received_at: string;
  processed_at: string | null;
  attempts: number;
  error: string | null;
  summary: string | null;
}

const eventsSchema = z.object({
  type: z.string().max(40).default(""),
  state: z.enum(["todos", "ok", "erro", "pendente"]).default("todos"),
  /** Paginação por cursor: eventos com id menor que este. */
  before: z.number().int().positive().optional(),
});

const PAGE = 50;

/** Uma linha curta do que o evento traz (sem abrir o payload inteiro). */
function summarize(type: string, p: Record<string, unknown>): string | null {
  if (type === "messages") {
    const m = (p.message ?? {}) as Record<string, unknown>;
    const who = (m.senderName as string) || (m.sender_pn as string) || "";
    const where = (m.groupName as string) || (m.chatid as string) || "";
    const text = String(m.text ?? m.content ?? "").slice(0, 80);
    return [m.fromMe ? "eu" : who, where && `em ${where}`, text && `· ${text}`].filter(Boolean).join(" ");
  }
  if (type === "connection") {
    const i = (p.instance ?? {}) as Record<string, unknown>;
    return [i.status, i.lastDisconnectReason && `· ${i.lastDisconnectReason}`].filter(Boolean).join(" ");
  }
  if (type === "messages_update") {
    const e = (p.event ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(e.MessageIDs) ? e.MessageIDs.length : 0;
    return [p.state ?? e.Type, ids && `· ${ids} mensagem(ns)`].filter(Boolean).join(" ");
  }
  if (type === "groups") {
    const e = (p.event ?? {}) as Record<string, unknown>;
    const name = (e.Name as Record<string, unknown> | undefined)?.Name;
    const joins = Array.isArray(e.Join) ? e.Join.length : 0;
    const leaves = Array.isArray(e.Leave) ? e.Leave.length : 0;
    return [p.type, name && `· ${name}`, joins && `· +${joins}`, leaves && `· -${leaves}`].filter(Boolean).join(" ");
  }
  return null;
}

export async function listWebhookEvents(input: z.input<typeof eventsSchema>): Promise<ActionResult<{ events: WebhookEventRow[]; hasMore: boolean; types: string[] }>> {
  return runAction(eventsSchema, input, async ({ type, state, before }) => {
    await requireAdmin();
    const db = createAdminClient();
    let q = db
      .from("webhook_events")
      .select("id, event_type, received_at, processed_at, attempts, error, payload")
      .order("id", { ascending: false })
      .limit(PAGE + 1);
    if (type) q = q.eq("event_type", type);
    if (state === "ok") q = q.not("processed_at", "is", null);
    if (state === "erro") q = q.not("error", "is", null).is("processed_at", null);
    if (state === "pendente") q = q.is("processed_at", null).is("error", null);
    if (before) q = q.lt("id", before);
    const { data, error } = await q;
    if (error) throw error;

    const rows = (data ?? []) as (Omit<WebhookEventRow, "summary"> & { payload: Record<string, unknown> })[];
    const { data: typeRows } = await db.from("webhook_events").select("event_type").order("id", { ascending: false }).limit(500);
    return {
      events: rows.slice(0, PAGE).map(({ payload, ...r }) => ({ ...r, summary: summarize(r.event_type, payload ?? {}) })),
      hasMore: rows.length > PAGE,
      types: [...new Set((typeRows ?? []).map((t) => t.event_type as string))].sort(),
    };
  });
}

const idSchema = z.object({ id: z.number().int().positive() });

/** Payload completo de um evento (o token da instância é removido). */
export async function getWebhookEventPayload(input: z.input<typeof idSchema>): Promise<ActionResult<unknown>> {
  return runAction(idSchema, input, async ({ id }) => {
    await requireAdmin();
    const { data } = await createAdminClient().from("webhook_events").select("payload").eq("id", id).maybeSingle();
    if (!data) throw new ActionError("Evento não encontrado.");
    const payload = { ...(data.payload as Record<string, unknown>) };
    delete payload.token;
    return payload;
  });
}

/** Reprocessa um evento (mesmo os já processados: o processamento é idempotente). */
export async function reprocessEvent(input: z.input<typeof idSchema>): Promise<ActionResult<void>> {
  return runAction(idSchema, input, async ({ id }) => {
    await requireAdmin();
    const db = createAdminClient();
    await db.from("webhook_events").update({ processed_at: null }).eq("id", id);
    after(() => processWebhookEvent(id));
  });
}

// =============================================================================
// Logs de conexão
// =============================================================================
export interface ConnectionLogRow {
  id: number;
  status: string;
  previous_status: string | null;
  reason: string | null;
  phone: string | null;
  created_at: string;
  alert_status: "sent" | "skipped" | "failed" | null;
  alert_error: string | null;
}

export async function listConnectionLogs(): Promise<ActionResult<ConnectionLogRow[]>> {
  return runAction(z.object({}), {}, async () => {
    await requireAdmin();
    const { data, error } = await createAdminClient()
      .from("connection_logs")
      .select("id, status, previous_status, reason, phone, created_at, alert_status, alert_error")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as ConnectionLogRow[];
  });
}
