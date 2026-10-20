// Processamento dos eventos da uazapi gravados em webhook_events.
// Idempotente: o mesmo evento pode chegar (ou ser reprocessado) mais de uma vez.

import { createAdminClient } from "@/lib/supabase/admin";
import { clientFromRow, getInstanceRow } from "@/lib/uazapi/instance";
import { jidDigits, splitIdentity, TRACK_SOURCE, type UazMessage } from "@/lib/uazapi/client";
import { normalizeMessage, type NormalizedMessage } from "@/lib/uazapi/normalize";
import { copyRemoteToStorage, mediaPath } from "@/lib/media";
import { refreshContactAvatar } from "@/lib/avatars";
import { getSettings } from "@/lib/settings";
import { dispatchConnectionAlerts } from "@/lib/alerts/discord";
import type { MessageStatus } from "@/lib/types";

type Payload = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

export async function processWebhookEvent(eventId: number): Promise<void> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("webhook_events")
    .select("id, event_type, payload, processed_at, attempts")
    .eq("id", eventId)
    .maybeSingle<{ id: number; event_type: string; payload: Payload; processed_at: string | null; attempts: number }>();
  if (!row || row.processed_at) return;

  let error: string | null = null;
  try {
    await dispatch(db, row.event_type, row.payload);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error(`[webhook] evento ${eventId} (${row.event_type}) falhou:`, e);
  }

  await db
    .from("webhook_events")
    .update({ processed_at: error ? null : new Date().toISOString(), attempts: row.attempts + 1, error })
    .eq("id", eventId);
}

async function dispatch(db: Admin, eventType: string, payload: Payload) {
  switch (eventType) {
    case "messages":
      return handleMessage(db, payload);
    case "messages_update":
      return handleMessageUpdate(db, payload);
    case "connection":
      return handleConnection(db, payload);
    case "groups":
      return handleGroups(db, payload);
    default:
      return; // eventos não assinados: ignorados
  }
}

// =============================================================================
// messages
// =============================================================================
async function handleMessage(db: Admin, payload: Payload) {
  const m = normalizeMessage(payload.message as UazMessage);
  if (!m || !m.isGroup || !m.chatId.endsWith("@g.us")) return;

  // Eco de uma mensagem enviada pelo painel: já existe a linha (id = track_id).
  if (m.fromMe && m.trackSource === TRACK_SOURCE && m.trackId) {
    await db
      .from("messages")
      .update({ wa_id: m.waId })
      .eq("id", m.trackId)
      .is("wa_id", null);
    return;
  }

  const chat = (payload.chat ?? {}) as Record<string, unknown>;
  const listening = await ensureGroup(db, m.chatId, typeof chat.name === "string" ? chat.name : null);
  if (!listening) return;

  if (m.reaction) return handleReaction(db, m);

  if (m.edited) {
    const { data: edited } = await db
      .from("messages")
      .update({ body: m.body, edited_at: new Date().toISOString() })
      .eq("wa_id", m.waId)
      .select("id");
    if (edited?.length) return;
  }

  if (!m.body && !m.hasMedia) return; // mensagem de sistema sem conteúdo

  const { data: result, error } = await db.rpc("ingest_group_message", {
    p_wa_id: m.waId,
    p_group_jid: m.chatId,
    p_phone: m.phone,
    p_lid: m.lid,
    p_sender_name: m.senderName,
    p_from_me: m.fromMe,
    p_kind: m.kind,
    p_body: m.body,
    p_has_media: m.hasMedia,
    p_media_mime: m.mime,
    p_media_name: m.fileName,
    p_media_duration: m.durationSeconds ? Math.round(m.durationSeconds) : null,
    p_quoted_wa_id: m.quotedWaId,
    p_sent_at: m.sentAt.toISOString(),
  });
  if (error) throw new Error(`ingest_group_message: ${error.message}`);

  const ingested = result as {
    message_id: string;
    ticket_id?: string | null;
    contact_id?: string | null;
    ticket_created?: boolean;
    ticket_reopened?: boolean;
    duplicate: boolean;
  };
  if (m.hasMedia && !ingested.duplicate) {
    await storeIncomingMedia(db, ingested.message_id, m);
  }
  if (!m.fromMe && !ingested.duplicate && ingested.contact_id) {
    await refreshContactAvatar(ingested.contact_id);
  }
  if (!m.fromMe && !ingested.duplicate && !m.quotedWaId) {
    await flagUncertainContext(db, ingested, m.sentAt);
  }
}

/**
 * Pergunta "faz parte deste atendimento?" quando não há certeza: a mensagem
 * caiu num atendimento que já existia, sem citação, a equipe já respondeu
 * depois da mensagem anterior desse lead e passou mais que a janela de rajada
 * (quem escreve uma palavra por mensagem não é perguntado a cada envio).
 */
async function flagUncertainContext(
  db: Admin,
  ingested: { message_id: string; ticket_id?: string | null; contact_id?: string | null; ticket_created?: boolean; ticket_reopened?: boolean },
  sentAt: Date,
) {
  if (!ingested.ticket_id || !ingested.contact_id || ingested.ticket_created || ingested.ticket_reopened) return;
  try {
    const { data: contact } = await db.from("contacts").select("kind").eq("id", ingested.contact_id).maybeSingle();
    if (contact?.kind === "team") return;

    const { data: prev } = await db
      .from("messages")
      .select("sent_at")
      .eq("ticket_id", ingested.ticket_id)
      .eq("contact_id", ingested.contact_id)
      .eq("from_me", false)
      .lt("sent_at", sentAt.toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!prev) return; // primeira mensagem dele aqui: entrou por uma regra certa (citação, participante)

    const { burst_window_seconds: burst } = await getSettings();
    if (sentAt.getTime() - Date.parse(prev.sent_at as string) <= burst * 1000) return; // rajada: continuação

    // A equipe respondeu depois da mensagem anterior? Se não, é o lead completando o que disse.
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", ingested.ticket_id)
      .eq("from_me", true)
      .eq("is_note", false)
      .gt("sent_at", prev.sent_at as string)
      .lt("sent_at", sentAt.toISOString());
    if (!count) return;

    await db.from("messages").update({ context_check: "pending" }).eq("id", ingested.message_id);
  } catch (e) {
    console.error("[webhook] confirmação de contexto falhou:", e);
  }
}

/** Cadastra o grupo na primeira mensagem (desligado) e diz se ele é escutado. */
async function ensureGroup(db: Admin, jid: string, name: string | null): Promise<boolean> {
  const { data } = await db.from("wa_groups").select("listening, name").eq("jid", jid).maybeSingle();
  if (data) {
    if (name && !data.name) await db.from("wa_groups").update({ name }).eq("jid", jid);
    return data.listening as boolean;
  }
  await db.from("wa_groups").upsert({ jid, name, listening: false }, { onConflict: "jid", ignoreDuplicates: true });
  return false;
}

async function handleReaction(db: Admin, m: NormalizedMessage) {
  const { data: target } = await db.from("messages").select("id").eq("wa_id", m.reaction!.targetWaId).maybeSingle();
  if (!target) return;

  const reactorKey = m.fromMe ? "me" : (m.phone ?? m.lid);
  if (!reactorKey) return;

  if (!m.reaction!.emoji) {
    await db.from("message_reactions").delete().eq("message_id", target.id).eq("reactor_key", reactorKey);
    return;
  }

  let contactId: string | null = null;
  if (!m.fromMe) {
    const { data } = await db.rpc("upsert_contact", { p_phone: m.phone, p_lid: m.lid, p_name: m.senderName });
    contactId = (data as string) ?? null;
  }

  await db.from("message_reactions").upsert(
    {
      message_id: target.id,
      reactor_key: reactorKey,
      contact_id: contactId,
      reactor_name: m.fromMe ? null : m.senderName,
      emoji: m.reaction!.emoji,
      reacted_at: m.sentAt.toISOString(),
    },
    { onConflict: "message_id,reactor_key" },
  );
}

/**
 * Copia a mídia recebida para o Storage. A fileURL da uazapi expira em 2 dias,
 * então o arquivo precisa ser nosso. Falha não derruba a mensagem (já gravada).
 */
export async function storeIncomingMedia(
  db: Admin,
  messageId: string,
  m: Pick<NormalizedMessage, "waId" | "mime" | "fileName">,
) {
  try {
    const uaz = clientFromRow(await getInstanceRow());
    const dl = await uaz.download(m.waId);
    if (!dl.fileURL) throw new Error("download sem fileURL");
    const mime = dl.mimetype ?? m.mime;
    const path = mediaPath("in", messageId, mime, m.fileName);
    const stored = await copyRemoteToStorage(dl.fileURL, path, mime);
    await db
      .from("messages")
      .update({ media_path: path, media_store: stored.store, media_mime: stored.mime, media_size: stored.size, media_status: "ready" })
      .eq("id", messageId);
  } catch (e) {
    console.error(`[webhook] mídia da mensagem ${messageId} falhou:`, e);
    await db.from("messages").update({ media_status: "failed" }).eq("id", messageId);
  }
}

// =============================================================================
// messages_update (recibos, exclusão)
// =============================================================================
const STATUS_MAP: Record<string, MessageStatus> = {
  sent: "sent",
  serverack: "sent",
  delivered: "delivered",
  deliveryack: "delivered",
  read: "read",
  readself: "read",
  played: "played",
};
const STATUS_RANK: MessageStatus[] = ["pending", "sent", "delivered", "read", "played"];

async function handleMessageUpdate(db: Admin, payload: Payload) {
  const event = (payload.event ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(event.MessageIDs) ? (event.MessageIDs as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) return;

  const type = String(payload.type ?? event.Type ?? "").toLowerCase();
  const state = String(payload.state ?? event.Type ?? "").toLowerCase().replace(/[^a-z]/g, "");

  if (["deleted", "revoked", "revoke", "delete"].includes(state) || type === "deleted") {
    await db.from("messages").update({ deleted_at: new Date().toISOString() }).in("wa_id", ids);
    return;
  }

  let status: MessageStatus | undefined;
  if (type === "groupreceipts" && Array.isArray(event.Receipts)) {
    // Em grupo vale o participante mais adiantado.
    for (const r of event.Receipts as Array<Record<string, unknown>>) {
      const s = STATUS_MAP[String(r.state ?? "").toLowerCase()];
      if (s && (!status || STATUS_RANK.indexOf(s) > STATUS_RANK.indexOf(status))) status = s;
    }
  } else {
    status = STATUS_MAP[state];
  }
  if (!status) return;

  const { error } = await db.rpc("advance_message_status", { p_wa_ids: ids, p_status: status });
  if (error) throw new Error(`advance_message_status: ${error.message}`);
}

// =============================================================================
// connection
// =============================================================================
async function handleConnection(db: Admin, payload: Payload) {
  const instance = (payload.instance ?? {}) as Record<string, unknown>;
  const status = String(instance.status ?? "");
  if (!["disconnected", "connecting", "connected", "hibernated"].includes(status)) return;

  const patch: Record<string, unknown> = { status, last_event_at: new Date().toISOString() };
  if (status === "connected") {
    patch.phone = jidDigits(typeof payload.owner === "string" ? payload.owner : null);
    patch.last_disconnect_reason = null;
  } else if (status === "disconnected") {
    patch.last_disconnect_reason = typeof instance.lastDisconnectReason === "string" ? instance.lastDisconnectReason : null;
  }
  await db.from("whatsapp_instance").update(patch).eq("id", 1);
  // O trigger registrou a mudança em connection_logs; avisa no Discord se for queda/volta.
  await dispatchConnectionAlerts();
}

// =============================================================================
// groups (nome, entradas e saídas)
// =============================================================================
async function handleGroups(db: Admin, payload: Payload) {
  const event = (payload.event ?? {}) as Record<string, unknown>;
  const jid = typeof event.JID === "string" ? event.JID : null;
  if (!jid?.endsWith("@g.us")) return;

  const { data: group } = await db.from("wa_groups").select("jid").eq("jid", jid).maybeSingle();
  if (!group) return;

  const nameObj = event.Name as Record<string, unknown> | undefined;
  if (nameObj && typeof nameObj.Name === "string") {
    await db.from("wa_groups").update({ name: nameObj.Name }).eq("jid", jid);
  }

  // Quem fez a ação (admin que adicionou/removeu, membro que convidou, ou a própria pessoa).
  const actor = splitIdentity(
    typeof event.SenderPN === "string" ? event.SenderPN : null,
    typeof event.Sender === "string" ? event.Sender : null,
  );
  const actorName = typeof event.Notify === "string" && event.Notify ? event.Notify : null;
  const joinLids = asList(event.JoinLid);

  for (const [i, entry] of asList(event.Join).entries()) {
    const { phone, lid } = splitIdentity(...entry, ...(joinLids[i] ?? []));
    if (!phone && !lid) continue;
    const { data: contactId } = await db.rpc("upsert_contact", { p_phone: phone, p_lid: lid, p_name: null });
    if (contactId) {
      await db
        .from("group_members")
        .upsert({ group_jid: jid, contact_id: contactId, left_at: null }, { onConflict: "group_jid,contact_id" });
    }
    await logMembership(db, "join", jid, { phone, lid, contactId: (contactId as string | null) ?? null }, actor, actorName);
  }

  for (const entry of asList(event.Leave)) {
    const { phone, lid } = splitIdentity(...entry);
    const filters = [phone && `phone.eq.${phone}`, lid && `lid.eq.${lid}`].filter(Boolean).join(",");
    if (!filters) continue;
    const { data: contacts } = await db.from("contacts").select("id").or(filters);
    for (const c of contacts ?? []) {
      await db.from("group_members").update({ left_at: new Date().toISOString() }).eq("group_jid", jid).eq("contact_id", c.id);
    }
    await logMembership(db, "leave", jid, { phone, lid, contactId: (contacts?.[0]?.id as string | undefined) ?? null }, actor, actorName);
  }
}

/**
 * Log da comunidade para cada entrada/saída, classificada por quem fez a ação:
 * a própria pessoa (entrou pelo link/aprovação, ou saiu), um admin do grupo ou a
 * conta do painel (adicionou/removeu) ou outro membro (convidou).
 */
async function logMembership(
  db: Admin,
  kind: "join" | "leave",
  groupJid: string,
  person: { phone: string | null; lid: string | null; contactId: string | null },
  actor: { phone: string | null; lid: string | null },
  actorName: string | null,
) {
  try {
    const self =
      (!!person.phone && person.phone === actor.phone) || (!!person.lid && person.lid === actor.lid) || (!actor.phone && !actor.lid);

    let type: "joined_via_link" | "added_by_admin" | "invited_by_member" | "left" | "removed";
    if (kind === "leave") type = self ? "left" : "removed";
    else if (self) type = "joined_via_link";
    else {
      const { data: instance } = await db.from("whatsapp_instance").select("phone").eq("id", 1).maybeSingle();
      const isPanel = !!actor.phone && actor.phone === (instance?.phone as string | null);
      const filters = [actor.phone && `phone.eq.${actor.phone}`, actor.lid && `lid.eq.${actor.lid}`].filter(Boolean).join(",");
      const { data: actorContact } = filters ? await db.from("contacts").select("id").or(filters).limit(1).maybeSingle() : { data: null };
      const { data: membership } = actorContact
        ? await db.from("group_members").select("is_admin").eq("group_jid", groupJid).eq("contact_id", actorContact.id).maybeSingle()
        : { data: null };
      type = isPanel || membership?.is_admin ? "added_by_admin" : "invited_by_member";
    }

    // Entrou: a solicitação dele (aceita, convidada ou pendente) está resolvida.
    let requestId: string | null = null;
    if (kind === "join" && person.phone) {
      const { data: reqs } = await db
        .from("join_requests")
        .update({ status: "joined" })
        .eq("phone", person.phone)
        .in("status", ["pending", "accepted", "invited"])
        .select("id");
      requestId = (reqs?.[0]?.id as string | undefined) ?? null;
    }

    const { error } = await db.from("community_events").insert({
      type,
      group_jid: groupJid,
      contact_id: person.contactId,
      phone: person.phone,
      actor_phone: self ? null : actor.phone,
      actor_name: self ? null : actorName,
      request_id: requestId,
      data: { lid: person.lid },
    });
    // Antes da migration da comunidade a tabela não existe: só registra no console.
    if (error) console.error("[webhook] log da comunidade:", error.message);
  } catch (e) {
    console.error("[webhook] log da comunidade:", e);
  }
}

/** Join/Leave chegam como JIDs ou objetos com projeções PN/LID. */
function asList(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      return Object.values(item as Record<string, unknown>).filter((x): x is string => typeof x === "string" && x.includes("@"));
    }
    return [];
  });
}
