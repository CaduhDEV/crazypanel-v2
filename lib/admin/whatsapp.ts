"use server";

import { after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { encryptSecret } from "@/lib/crypto";
import { siteUrl } from "@/lib/site-url";
import { jidDigits, UazapiClient, UazapiError, type UazInstance } from "@/lib/uazapi/client";
import { clientFromRow, getInstanceRow, toInstanceView, webhookUrlFor, type InstanceView } from "@/lib/uazapi/instance";
import { processWebhookEvent } from "@/lib/webhook/process";
import { dispatchConnectionAlerts } from "@/lib/alerts/discord";

export interface InstanceState extends InstanceView {
  qrcode: string | null;
  paircode: string | null;
  webhookUrl: string;
}

async function expectedWebhookUrl(secret: string) {
  return webhookUrlFor(await siteUrl(), secret);
}

/** Atualiza o banco com o que a uazapi informa e devolve o estado para a tela. */
async function syncFromRemote(instance: UazInstance | undefined): Promise<{ qrcode: string | null; paircode: string | null }> {
  if (!instance) return { qrcode: null, paircode: null };
  const patch: Record<string, unknown> = {};
  if (instance.status) patch.status = instance.status;
  if (instance.profileName !== undefined) patch.profile_name = instance.profileName || null;
  if (instance.profilePicUrl !== undefined) patch.profile_pic_url = instance.profilePicUrl || null;
  if (instance.status === "connected" && instance.owner) patch.phone = jidDigits(instance.owner);
  if (instance.lastDisconnectReason !== undefined) patch.last_disconnect_reason = instance.lastDisconnectReason || null;
  if (Object.keys(patch).length) {
    await createAdminClient().from("whatsapp_instance").update(patch).eq("id", 1);
    // Mudança de status vira log (trigger) e, se for queda/volta, alerta no Discord.
    if (patch.status) after(() => dispatchConnectionAlerts());
  }
  return { qrcode: instance.qrcode || null, paircode: instance.paircode || null };
}

/** Estado atual da instância. Com `live`, consulta a uazapi (QR atualizado durante a conexão). */
export async function getInstanceState(live = true): Promise<ActionResult<InstanceState>> {
  return runAction(z.boolean(), live, async (refresh) => {
    await requireAdmin();
    let row = await getInstanceRow();
    let codes = { qrcode: null as string | null, paircode: null as string | null };

    if (refresh && row.base_url && row.token_encrypted) {
      try {
        const res = await clientFromRow(row).status();
        codes = await syncFromRemote(res.instance);
        row = await getInstanceRow();
      } catch (e) {
        if (!(e instanceof UazapiError)) throw e;
      }
    }

    const webhookUrl = await expectedWebhookUrl(row.webhook_secret);
    return { ...toInstanceView(row, webhookUrl), ...codes, webhookUrl };
  });
}

const configSchema = z.object({
  baseUrl: z
    .url({ error: "Informe a Server URL completa, com https://." })
    .trim()
    .refine((u) => /^https?:\/\//.test(u), { error: "Use uma URL http(s)." }),
  token: z.string().trim().max(500).optional(),
});

/** Salva Server URL e token, testa a credencial e registra o webhook. */
export async function saveInstanceConfig(input: z.input<typeof configSchema>): Promise<ActionResult<void>> {
  return runAction(configSchema, input, async ({ baseUrl, token }) => {
    await requireAdmin();
    const row = await getInstanceRow();
    const url = baseUrl.replace(/\/+$/, "");

    if (!token && !row.token_encrypted) throw new ActionError("Informe o token da instância.");

    const client = token ? new UazapiClient(url, token) : clientFromRow({ ...row, base_url: url });
    let status: UazInstance | undefined;
    try {
      status = (await client.status()).instance;
    } catch (e) {
      throw new ActionError(e instanceof UazapiError ? e.message : "Não foi possível validar a instância.");
    }

    const patch: Record<string, unknown> = { base_url: url, webhook_url: null, webhook_configured_at: null };
    if (token) {
      patch.token_encrypted = encryptSecret(token);
      patch.token_hint = token.slice(-4);
    }
    await createAdminClient().from("whatsapp_instance").update(patch).eq("id", 1);
    await syncFromRemote(status);
    await registerWebhook(client, row.webhook_secret);
  });
}

async function registerWebhook(client: UazapiClient, secret: string) {
  const url = await expectedWebhookUrl(secret);
  try {
    await client.setWebhook(url);
  } catch (e) {
    throw new ActionError(e instanceof UazapiError ? `Webhook não configurado: ${e.message}` : "Webhook não configurado.");
  }
  await createAdminClient()
    .from("whatsapp_instance")
    .update({ webhook_url: url, webhook_configured_at: new Date().toISOString() })
    .eq("id", 1);
}

export async function configureWebhook(): Promise<ActionResult<void>> {
  return runAction(z.undefined(), undefined, async () => {
    await requireAdmin();
    const row = await getInstanceRow();
    await registerWebhook(clientFromRow(row), row.webhook_secret);
  });
}

const connectSchema = z.object({
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || /^\d{10,15}$/.test(v), { error: "Número inválido. Use DDI + DDD + número." })
    .optional(),
});

/** Inicia o pareamento: QR Code (sem número) ou código de pareamento (com número). */
export async function connectInstance(
  input: z.input<typeof connectSchema>,
): Promise<ActionResult<{ qrcode: string | null; paircode: string | null }>> {
  return runAction(connectSchema, input, async ({ phone }) => {
    await requireAdmin();
    const client = clientFromRow(await getInstanceRow());
    try {
      const res = await client.connect(phone || undefined);
      return await syncFromRemote(res.instance ?? { status: "connecting" });
    } catch (e) {
      throw new ActionError(e instanceof UazapiError ? e.message : "Não foi possível iniciar a conexão.");
    }
  });
}

export async function disconnectInstance(): Promise<ActionResult<void>> {
  return runAction(z.undefined(), undefined, async () => {
    await requireAdmin();
    const client = clientFromRow(await getInstanceRow());
    try {
      const res = await client.disconnect();
      await syncFromRemote(res.instance ?? { status: "disconnected" });
    } catch (e) {
      throw new ActionError(e instanceof UazapiError ? e.message : "Não foi possível desconectar.");
    }
  });
}

// =============================================================================
// Diagnóstico dos eventos recebidos
// =============================================================================
export interface WebhookEventSummary {
  id: number;
  event_type: string;
  received_at: string;
  processed_at: string | null;
  attempts: number;
  error: string | null;
}

export async function listRecentEvents(): Promise<ActionResult<{ events: WebhookEventSummary[]; failed: number }>> {
  return runAction(z.undefined(), undefined, async () => {
    await requireAdmin();
    const db = createAdminClient();
    const [{ data: events }, { count }] = await Promise.all([
      db
        .from("webhook_events")
        .select("id, event_type, received_at, processed_at, attempts, error")
        .order("received_at", { ascending: false })
        .limit(15),
      db.from("webhook_events").select("id", { count: "exact", head: true }).not("error", "is", null).is("processed_at", null),
    ]);
    return { events: (events ?? []) as WebhookEventSummary[], failed: count ?? 0 };
  });
}

/** Reprocessa eventos que falharam (até 200 por vez, os mais antigos primeiro). */
export async function reprocessFailedEvents(): Promise<ActionResult<number>> {
  return runAction(z.undefined(), undefined, async () => {
    await requireAdmin();
    const { data } = await createAdminClient()
      .from("webhook_events")
      .select("id")
      .not("error", "is", null)
      .is("processed_at", null)
      .order("received_at", { ascending: true })
      .limit(200);
    const ids = (data ?? []).map((r) => r.id as number);
    after(async () => {
      for (const id of ids) await processWebhookEvent(id);
    });
    return ids.length;
  });
}
