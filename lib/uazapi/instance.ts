import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { ActionError } from "@/lib/action";
import { UazapiClient } from "@/lib/uazapi/client";
import type { InstanceStatus } from "@/lib/types";

export interface InstanceRow {
  base_url: string | null;
  token_encrypted: string | null;
  token_hint: string | null;
  webhook_secret: string;
  webhook_url: string | null;
  webhook_configured_at: string | null;
  status: InstanceStatus;
  phone: string | null;
  profile_name: string | null;
  profile_pic_url: string | null;
  last_disconnect_reason: string | null;
  last_event_at: string | null;
  updated_at: string;
}

/** O que a tela do admin pode ver (sem token nem segredo). */
export interface InstanceView {
  configured: boolean;
  baseUrl: string | null;
  tokenHint: string | null;
  status: InstanceStatus;
  phone: string | null;
  profileName: string | null;
  profilePicUrl: string | null;
  lastDisconnectReason: string | null;
  lastEventAt: string | null;
  webhookConfiguredAt: string | null;
  webhookUrlMatches: boolean;
}

export async function getInstanceRow(): Promise<InstanceRow> {
  const { data, error } = await createAdminClient()
    .from("whatsapp_instance")
    .select("*")
    .eq("id", 1)
    .single<InstanceRow>();
  if (error || !data) throw new Error(`whatsapp_instance indisponível: ${error?.message}`);
  return data;
}

export function toInstanceView(row: InstanceRow, expectedWebhookUrl: string): InstanceView {
  return {
    configured: !!row.base_url && !!row.token_encrypted,
    baseUrl: row.base_url,
    tokenHint: row.token_hint,
    status: row.status,
    phone: row.phone,
    profileName: row.profile_name,
    profilePicUrl: row.profile_pic_url,
    lastDisconnectReason: row.last_disconnect_reason,
    lastEventAt: row.last_event_at,
    webhookConfiguredAt: row.webhook_configured_at,
    webhookUrlMatches: !!row.webhook_url && row.webhook_url === expectedWebhookUrl,
  };
}

export function clientFromRow(row: InstanceRow): UazapiClient {
  if (!row.base_url || !row.token_encrypted) {
    throw new ActionError("Configure a instância do WhatsApp em Administração → WhatsApp.");
  }
  return new UazapiClient(row.base_url, decryptSecret(row.token_encrypted));
}

/** Cliente pronto para uso. Lança ActionError quando a instância não está configurada. */
export async function getUazapi(): Promise<UazapiClient> {
  return clientFromRow(await getInstanceRow());
}

export function webhookUrlFor(siteUrl: string, secret: string): string {
  return `${siteUrl}/api/webhooks/uazapi?secret=${encodeURIComponent(secret)}`;
}
