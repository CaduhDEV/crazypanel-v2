"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { getUazapi } from "@/lib/uazapi/instance";
import { TRACK_SOURCE, UazapiError, type UazMediaType, type UazMessage } from "@/lib/uazapi/client";
import { getSettings } from "@/lib/settings";
import { kindFromMime, MAX_MEDIA_BYTES, mediaPath, mediaUrl } from "@/lib/media";
import { r2Head, r2Key, r2PresignPut } from "@/lib/r2";
import { storeIncomingMedia } from "@/lib/webhook/process";
import type { Message, Profile, ResolvedBy } from "@/lib/types";
import { RESOLVED_BY, VOICE_NOTE_PREFIX } from "@/lib/types";
import { isActivePair } from "@/lib/taxonomy";
import { getTaxonomy } from "@/lib/taxonomy-server";

const id = z.uuid({ error: "Identificador inválido." });

type TicketRow = { id: string; group_jid: string; status: "open" | "closed"; assignee_id: string | null };

async function loadTicket(ticketId: string): Promise<TicketRow> {
  const { data } = await createAdminClient()
    .from("tickets")
    .select("id, group_jid, status, assignee_id")
    .eq("id", ticketId)
    .maybeSingle<TicketRow>();
  if (!data) throw new ActionError("Atendimento não encontrado.");
  return data;
}

async function loadMessage(messageId: string): Promise<Message> {
  const { data } = await createAdminClient().from("messages").select("*").eq("id", messageId).maybeSingle<Message>();
  if (!data) throw new ActionError("Mensagem não encontrada.");
  return data;
}

async function quotedWaId(replyToId: string | undefined): Promise<string | null> {
  if (!replyToId) return null;
  const quoted = await loadMessage(replyToId);
  if (!quoted.wa_id) throw new ActionError("Essa mensagem ainda não foi confirmada pelo WhatsApp. Tente responder em instantes.");
  return quoted.wa_id;
}

function sign(profile: Profile, text: string, enabled: boolean): string {
  return enabled ? `*${profile.name}:*\n\n${text}` : text;
}

function sentWaId(res: UazMessage): string | null {
  return res.messageid ?? res.id?.split(":").pop() ?? null;
}

function friendlySendError(e: unknown): string {
  if (e instanceof UazapiError || e instanceof ActionError) return e.message;
  return "Falha ao enviar pelo WhatsApp.";
}

/**
 * Envia uma mensagem já gravada como `pending` e atualiza o status.
 * O track_id é o id da linha: o eco do webhook encontra a mesma mensagem.
 */
async function deliver(message: Message, profile: Profile): Promise<Message> {
  const db = createAdminClient();
  const [uaz, settings] = await Promise.all([getUazapi(), getSettings()]);
  const common = {
    number: message.group_jid,
    replyid: message.quoted_wa_id ?? undefined,
    delay: settings.typing_delay_ms,
    track_source: TRACK_SOURCE,
    track_id: message.id,
  };

  try {
    let res: UazMessage;
    if (message.kind === "text") {
      res = await uaz.sendText({ ...common, text: sign(profile, message.body ?? "", settings.sign_messages) });
    } else {
      if (!message.media_path) throw new ActionError("Arquivo da mensagem não encontrado.");
      const file = await mediaUrl({ path: message.media_path, store: message.media_store, mime: message.media_mime }, 3600);
      const caption = message.body?.trim() ? sign(profile, message.body.trim(), settings.sign_messages) : undefined;
      res = await uaz.sendMedia({
        ...common,
        type: uazMediaType(message),
        file,
        text: caption,
        docName: message.kind === "document" ? (message.media_name ?? undefined) : undefined,
        mimetype: message.media_mime ?? undefined,
      });
    }

    const sentAt = new Date().toISOString();
    const { data: updated } = await db
      .from("messages")
      .update({ wa_id: sentWaId(res), status: "sent", error: null, sent_at: sentAt })
      .eq("id", message.id)
      .select("*")
      .single<Message>();

    if (message.ticket_id) {
      await db.rpc("register_ticket_reply", {
        p_ticket_id: message.ticket_id,
        p_author_id: profile.id,
        p_preview: message.body?.trim() || mediaLabel(message),
        p_sent_at: sentAt,
      });
    }
    return updated ?? message;
  } catch (e) {
    const error = friendlySendError(e);
    const { data: failed } = await db
      .from("messages")
      .update({ status: "failed", error })
      .eq("id", message.id)
      .select("*")
      .single<Message>();
    return failed ?? { ...message, status: "failed", error };
  }
}

/** Gravações feitas no painel (VOICE_NOTE_PREFIX) vão como mensagem de voz; arquivos de áudio, como áudio. */
function uazMediaType(message: Message): UazMediaType {
  if (message.kind === "audio") return message.media_name?.startsWith(VOICE_NOTE_PREFIX) ? "ptt" : "audio";
  if (message.kind === "image" || message.kind === "video" || message.kind === "sticker") return message.kind;
  return "document";
}

function mediaLabel(message: Pick<Message, "kind">): string {
  const labels: Record<string, string> = { image: "Imagem", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha" };
  return labels[message.kind] ?? "Mensagem";
}

// =============================================================================
// Texto e notas
// =============================================================================
const sendTextSchema = z.object({
  ticketId: id,
  text: z.string().trim().min(1, { error: "Escreva uma mensagem." }).max(4096, { error: "Mensagem longa demais." }),
  replyToId: id.optional(),
  note: z.boolean().optional(),
  /** Id gerado no navegador: a mensagem já aparece na conversa antes do envio terminar. */
  clientId: id.optional(),
});

export async function sendTextMessage(input: z.input<typeof sendTextSchema>): Promise<ActionResult<Message>> {
  return runAction(sendTextSchema, input, async ({ ticketId, text, replyToId, note, clientId }) => {
    const [profile, ticket] = await Promise.all([requireMember(), loadTicket(ticketId)]);
    const db = createAdminClient();

    if (note) {
      const { data, error } = await db
        .from("messages")
        .insert({
          ...(clientId && { id: clientId }),
          group_jid: ticket.group_jid,
          ticket_id: ticket.id,
          author_id: profile.id,
          is_note: true,
          sender_name: profile.name,
          kind: "text",
          body: text,
          quoted_wa_id: replyToId ? (await loadMessage(replyToId)).wa_id : null,
        })
        .select("*")
        .single<Message>();
      if (error) throw error;
      return data;
    }

    if (ticket.status === "closed") throw new ActionError("Este atendimento já foi finalizado.");

    const { data: pending, error } = await db
      .from("messages")
      .insert({
        ...(clientId && { id: clientId }),
        group_jid: ticket.group_jid,
        ticket_id: ticket.id,
        author_id: profile.id,
        from_me: true,
        sender_name: profile.name,
        kind: "text",
        body: text,
        quoted_wa_id: await quotedWaId(replyToId),
        status: "pending",
      })
      .select("*")
      .single<Message>();
    if (error) throw error;

    return deliver(pending, profile);
  });
}

// =============================================================================
// Mídia: o navegador sobe direto para o R2 (link de envio assinado) e depois envia
// =============================================================================
const uploadSchema = z.object({
  ticketId: id,
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(3).max(120),
  size: z.number().int().positive().max(MAX_MEDIA_BYTES, { error: "O arquivo passa do limite de 100 MB." }),
});

export async function createMediaUpload(
  input: z.input<typeof uploadSchema>,
): Promise<ActionResult<{ path: string; url: string }>> {
  return runAction(uploadSchema, input, async ({ ticketId, fileName, mime }) => {
    await requireMember();
    const ticket = await loadTicket(ticketId);
    if (ticket.status === "closed") throw new ActionError("Este atendimento já foi finalizado.");

    const path = mediaPath("out", crypto.randomUUID(), mime, fileName);
    return { path, url: await r2PresignPut(r2Key(path), mime, 15 * 60) };
  });
}

const sendMediaSchema = z.object({
  ticketId: id,
  path: z.string().regex(/^out\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/, { error: "Arquivo inválido." }),
  fileName: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(3).max(120),
  size: z.number().int().positive().max(MAX_MEDIA_BYTES),
  caption: z.string().trim().max(1024).optional(),
  replyToId: id.optional(),
  durationSeconds: z.number().int().min(0).max(3600).optional(),
});

export async function sendMediaMessage(input: z.input<typeof sendMediaSchema>): Promise<ActionResult<Message>> {
  return runAction(sendMediaSchema, input, async ({ ticketId, path, fileName, mime, size, caption, replyToId, durationSeconds }) => {
    const [profile, ticket] = await Promise.all([requireMember(), loadTicket(ticketId)]);
    if (ticket.status === "closed") throw new ActionError("Este atendimento já foi finalizado.");
    // O arquivo precisa ter chegado ao R2, com o tamanho declarado, antes de virar mensagem.
    const uploaded = await r2Head(r2Key(path));
    if (!uploaded) throw new ActionError("O envio do arquivo não terminou. Tente de novo.");
    if (uploaded.size !== size || uploaded.size > MAX_MEDIA_BYTES) throw new ActionError("O arquivo enviado não confere. Tente de novo.");

    const { data: pending, error } = await createAdminClient()
      .from("messages")
      .insert({
        group_jid: ticket.group_jid,
        ticket_id: ticket.id,
        author_id: profile.id,
        from_me: true,
        sender_name: profile.name,
        kind: kindFromMime(mime),
        body: caption || null,
        media_path: path,
        media_store: "r2",
        media_mime: mime,
        media_name: fileName,
        media_size: size,
        media_duration: durationSeconds ?? null,
        media_status: "ready",
        quoted_wa_id: await quotedWaId(replyToId),
        status: "pending",
      })
      .select("*")
      .single<Message>();
    if (error) throw error;

    return deliver(pending, profile);
  });
}

const messageIdSchema = z.object({ messageId: id });

/** Reenvia uma mensagem que falhou. */
export async function retryMessage(input: z.input<typeof messageIdSchema>): Promise<ActionResult<Message>> {
  return runAction(messageIdSchema, input, async ({ messageId }) => {
    const profile = await requireMember();
    const message = await loadMessage(messageId);
    if (!message.from_me || message.status !== "failed") throw new ActionError("Só mensagens que falharam podem ser reenviadas.");
    if (message.author_id !== profile.id && profile.role !== "admin") throw new ActionError("Só quem enviou pode reenviar.");
    await createAdminClient().from("messages").update({ status: "pending", error: null }).eq("id", messageId);
    return deliver({ ...message, status: "pending" }, profile);
  });
}

/** Tenta baixar de novo uma mídia recebida que falhou. */
/** Baixa de novo a mídia recebida. Devolve a mensagem atualizada (telas sem Realtime, como o Histórico, usam). */
export async function retryMediaDownload(input: z.input<typeof messageIdSchema>): Promise<ActionResult<Message>> {
  return runAction(messageIdSchema, input, async ({ messageId }) => {
    const [, message] = await Promise.all([requireMember(), loadMessage(messageId)]);
    if (message.from_me || !message.wa_id) throw new ActionError("Esta mídia não pode ser baixada de novo.");
    const db = createAdminClient();
    await db.from("messages").update({ media_status: "pending" }).eq("id", messageId);
    // Uma tentativa só: quem clicou está esperando a resposta.
    const ok = await storeIncomingMedia(db, messageId, { waId: message.wa_id, mime: message.media_mime, fileName: message.media_name }, { attempts: 1 });
    if (!ok) throw new ActionError("O WhatsApp não entregou o arquivo agora. Tente de novo em instantes.");
    return loadMessage(messageId);
  });
}

// =============================================================================
// Reação, edição e exclusão
// =============================================================================
const reactSchema = z.object({ messageId: id, emoji: z.string().max(16) });

export async function reactToMessage(input: z.input<typeof reactSchema>): Promise<ActionResult<void>> {
  return runAction(reactSchema, input, async ({ messageId, emoji }) => {
    const profile = await requireMember();
    const message = await loadMessage(messageId);
    if (!message.wa_id || message.is_note) throw new ActionError("Não é possível reagir a esta mensagem.");

    await (await getUazapi()).react(message.wa_id, emoji);

    const db = createAdminClient();
    if (!emoji) {
      await db.from("message_reactions").delete().eq("message_id", messageId).eq("reactor_key", "me");
      return;
    }
    // A conta conectada tem uma reação por mensagem: trocar substitui.
    await db.from("message_reactions").upsert(
      { message_id: messageId, reactor_key: "me", author_id: profile.id, reactor_name: profile.name, emoji, reacted_at: new Date().toISOString() },
      { onConflict: "message_id,reactor_key" },
    );
  });
}

function assertCanChange(message: Message, profile: Profile) {
  if (!message.from_me && !message.is_note) throw new ActionError("Só mensagens enviadas pelo painel podem ser alteradas.");
  if (message.author_id !== profile.id && profile.role !== "admin") throw new ActionError("Só quem enviou pode alterar esta mensagem.");
}

const editSchema = z.object({ messageId: id, text: z.string().trim().min(1).max(4096) });

export async function editMessage(input: z.input<typeof editSchema>): Promise<ActionResult<void>> {
  return runAction(editSchema, input, async ({ messageId, text }) => {
    const profile = await requireMember();
    const message = await loadMessage(messageId);
    assertCanChange(message, profile);
    if (message.kind !== "text") throw new ActionError("Só mensagens de texto podem ser editadas.");

    if (!message.is_note) {
      if (!message.wa_id) throw new ActionError("A mensagem ainda não foi enviada.");
      const settings = await getSettings();
      const author = message.author_id === profile.id ? profile : { ...profile, name: message.sender_name ?? profile.name };
      await (await getUazapi()).editMessage(message.wa_id, sign(author, text, settings.sign_messages));
    }
    await createAdminClient().from("messages").update({ body: text, edited_at: new Date().toISOString() }).eq("id", messageId);
  });
}

export async function deleteMessage(input: z.input<typeof messageIdSchema>): Promise<ActionResult<void>> {
  return runAction(messageIdSchema, input, async ({ messageId }) => {
    const profile = await requireMember();
    const message = await loadMessage(messageId);
    assertCanChange(message, profile);
    const db = createAdminClient();

    if (message.is_note || !message.wa_id) {
      await db.from("messages").delete().eq("id", messageId);
      return;
    }
    await (await getUazapi()).deleteMessage(message.wa_id);
    await db.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", messageId);
  });
}

// =============================================================================
// Responsável, fila e encerramento
// =============================================================================
const assignSchema = z.object({ ticketId: id, assigneeId: id.nullable() });

export async function assignTicket(input: z.input<typeof assignSchema>): Promise<ActionResult<void>> {
  return runAction(assignSchema, input, async ({ ticketId, assigneeId }) => {
    const [profile, ticket] = await Promise.all([requireMember(), loadTicket(ticketId)]);
    if (ticket.status === "closed") throw new ActionError("Este atendimento já foi finalizado.");
    if (ticket.assignee_id === assigneeId) return;

    const db = createAdminClient();
    if (assigneeId) {
      const { data: target } = await db.from("profiles").select("active").eq("id", assigneeId).maybeSingle();
      if (!target?.active) throw new ActionError("Esse atendente não está ativo.");
    }

    // Só troca se o responsável ainda for o que foi lido: dois atendentes clicando
    // em "Assumir" juntos não ficam os dois achando que são donos.
    const update = db.from("tickets").update({ assignee_id: assigneeId }).eq("id", ticketId).eq("status", "open");
    const { data: changed, error } = await (ticket.assignee_id ? update.eq("assignee_id", ticket.assignee_id) : update.is("assignee_id", null)).select("id");
    if (error) throw error;
    if (!changed?.length) throw new ActionError("O responsável deste atendimento acabou de mudar. Confira e tente de novo.");
    await db.from("ticket_events").insert({
      ticket_id: ticketId,
      type: assigneeId ? "assigned" : "unassigned",
      actor_id: profile.id,
      data: { from: ticket.assignee_id, to: assigneeId },
    });
  });
}

export async function claimNextTicket(): Promise<ActionResult<string | null>> {
  return runAction(z.undefined(), undefined, async () => {
    const profile = await requireMember();
    const { data, error } = await createAdminClient().rpc("claim_next_ticket", { p_profile_id: profile.id });
    if (error) throw error;
    return (data as string | null) ?? null;
  });
}

const resolvedByValues = RESOLVED_BY.map((r) => r.value) as [ResolvedBy, ...ResolvedBy[]];
// Chaves das tabelas ticket_categories/ticket_topics; o par é conferido na ação.
const taxonomyKey = (error: string) => z.string({ error }).regex(/^[a-z0-9_]{2,40}$/, { error });

const closeSchema = z
  .object({
    ticketId: id,
    reason: z.enum(["resolved", "parallel"]),
    category: taxonomyKey("Escolha a categoria do atendimento."),
    topic: taxonomyKey("Escolha a subcategoria do atendimento."),
    resolvedBy: z.enum(resolvedByValues).optional(),
    resolutionMessageId: id.optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((d) => d.reason !== "resolved" || !!d.resolvedBy, {
    error: "Diga quem resolveu: comunidade, equipe ou os dois.",
    path: ["resolvedBy"],
  });

export async function closeTicket(input: z.input<typeof closeSchema>): Promise<ActionResult<void>> {
  return runAction(closeSchema, input, async ({ ticketId, reason, category, topic, resolvedBy, resolutionMessageId, note }) => {
    const [profile, ticket, taxonomy] = await Promise.all([requireMember(), loadTicket(ticketId), getTaxonomy()]);
    if (ticket.status === "closed") throw new ActionError("Este atendimento já foi finalizado.");
    if (!isActivePair(taxonomy, category, topic)) {
      throw new ActionError("Essa categoria ou subcategoria não está mais disponível. Feche e abra o atendimento de novo para ver as opções atuais.");
    }

    const db = createAdminClient();
    // Só fecha se ainda estiver aberto: dois atendentes finalizando juntos não
    // gravam dois encerramentos (o segundo recebe o aviso).
    const { data: closed, error } = await db
      .from("tickets")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: profile.id,
        close_reason: reason,
        category,
        topic,
        resolved_by: reason === "resolved" ? (resolvedBy ?? null) : null,
        resolution_message_id: reason === "resolved" ? (resolutionMessageId ?? null) : null,
        close_note: note || null,
        waiting_since: null,
        assignee_id: ticket.assignee_id ?? profile.id,
      })
      .eq("id", ticketId)
      .eq("status", "open")
      .select("id");
    if (error) throw error;
    if (!closed?.length) throw new ActionError("Este atendimento já foi finalizado por outra pessoa.");
    await db.from("ticket_events").insert({
      ticket_id: ticketId,
      type: "closed",
      actor_id: profile.id,
      data: { reason, category, topic, resolved_by: resolvedBy ?? null },
    });
  });
}

const clearSchema = z.object({ groupJids: z.array(z.string().endsWith("@g.us")).optional() });

/** Admin: encerra de uma vez os atendimentos abertos (todos ou de alguns grupos). */
export async function clearQueue(input: z.input<typeof clearSchema>): Promise<ActionResult<number>> {
  return runAction(clearSchema, input, async ({ groupJids }) => {
    const profile = await requireAdmin();
    const db = createAdminClient();
    let query = db
      .from("tickets")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: profile.id,
        close_reason: "sla_cleared",
        waiting_since: null,
      })
      .eq("status", "open");
    if (groupJids?.length) query = query.in("group_jid", groupJids);
    const { data, error } = await query.select("id");
    if (error) throw error;

    if (data?.length) {
      await db.from("ticket_events").insert(
        data.map((t) => ({ ticket_id: t.id, type: "closed", actor_id: profile.id, data: { reason: "sla_cleared" } })),
      );
    }
    return data?.length ?? 0;
  });
}

/**
 * "Separar": a mensagem não pertence a este atendimento. Ela vira um atendimento
 * novo do autor, com o SLA contando a partir dela.
 */
export async function moveMessageToNewTicket(input: z.input<typeof messageIdSchema>): Promise<ActionResult<string>> {
  return runAction(messageIdSchema, input, async ({ messageId }) => {
    const profile = await requireMember();
    const message = await loadMessage(messageId);
    if (message.from_me || message.is_note || !message.contact_id || !message.ticket_id) {
      throw new ActionError("Só mensagens de contatos podem ser separadas.");
    }
    const db = createAdminClient();
    const preview = message.body?.trim().slice(0, 280) || mediaLabel(message);

    const { data: created, error } = await db
      .from("tickets")
      .insert({
        group_jid: message.group_jid,
        contact_id: message.contact_id,
        subject: preview,
        opened_at: message.sent_at,
        last_message_at: message.sent_at,
        last_message_preview: preview,
        last_customer_message_at: message.sent_at,
        waiting_since: message.sent_at,
        message_count: 1,
      })
      .select("id")
      .single();
    if (error) throw error;

    await db.from("messages").update({ ticket_id: created.id }).eq("id", messageId);
    // Separada: a pergunta "faz parte?" está respondida (antes da migration, a coluna não existe e o erro é ignorado).
    await db.from("messages").update({ context_check: null }).eq("id", messageId);
    const { data: old } = await db.from("tickets").select("message_count").eq("id", message.ticket_id).single();
    await db.from("tickets").update({ message_count: Math.max(0, (old?.message_count ?? 1) - 1) }).eq("id", message.ticket_id);
    await db.from("ticket_events").insert([
      { ticket_id: message.ticket_id, type: "message_moved", actor_id: profile.id, data: { message_id: messageId, to: created.id } },
      { ticket_id: created.id, type: "opened", actor_id: profile.id, data: { message_id: messageId, from: message.ticket_id } },
    ]);
    return created.id as string;
  });
}

// =============================================================================
// Participantes (mais de um lead no mesmo atendimento)
// =============================================================================
const removeParticipantSchema = z.object({ ticketId: id, contactId: id, openTicket: z.boolean() });

/**
 * Retira um lead do atendimento. As mensagens dele vão para um atendimento
 * próprio (openTicket) ou saem da fila; ele não volta para este atendimento.
 */
export async function removeTicketParticipant(input: z.input<typeof removeParticipantSchema>): Promise<ActionResult<string | null>> {
  return runAction(removeParticipantSchema, input, async ({ ticketId, contactId, openTicket }) => {
    const [profile, ticket] = await Promise.all([requireMember(), loadTicket(ticketId)]);
    if (ticket.status === "closed") throw new ActionError("Este atendimento já foi finalizado.");

    const { data, error } = await createAdminClient().rpc("remove_ticket_participant", {
      p_ticket_id: ticketId,
      p_contact_id: contactId,
      p_actor_id: profile.id,
      p_open_ticket: openTicket,
    });
    if (error) {
      if (error.code === "23514") throw new ActionError("O lead principal não pode ser retirado.");
      throw error;
    }
    return (data as string | null) ?? null;
  });
}

// =============================================================================
// Sugestões de contexto (mensagem de outro lead durante um atendimento)
// =============================================================================
const suggestionSchema = z.object({ id: z.number().int().positive() });

/** Junta o atendimento do lead ao atendimento em andamento. */
export async function acceptContextSuggestion(input: z.input<typeof suggestionSchema>): Promise<ActionResult<void>> {
  return runAction(suggestionSchema, input, async ({ id }) => {
    const profile = await requireMember();
    const { error } = await createAdminClient().rpc("accept_context_suggestion", { p_id: id, p_actor_id: profile.id });
    if (error) {
      if (error.code === "23514") throw new ActionError("Este atendimento já foi finalizado.");
      if (error.code === "22023") throw new ActionError("Outra pessoa já decidiu essa sugestão.");
      throw error;
    }
  });
}

/** Ignora: o lead segue no atendimento próprio e não é sugerido de novo aqui. */
export async function dismissContextSuggestion(input: z.input<typeof suggestionSchema>): Promise<ActionResult<void>> {
  return runAction(suggestionSchema, input, async ({ id }) => {
    const profile = await requireMember();
    const { data, error } = await createAdminClient()
      .from("ticket_context_suggestions")
      .update({ status: "dismissed", decided_at: new Date().toISOString(), decided_by: profile.id })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Outra pessoa já decidiu essa sugestão.");
  });
}

// =============================================================================
// Mesclar atendimentos e confirmar contexto
// =============================================================================
const mergeSchema = z.object({ sourceId: id, targetId: id });

/** Junta o atendimento de origem ao de destino (mesmo grupo, os dois abertos). */
export async function mergeTickets(input: z.input<typeof mergeSchema>): Promise<ActionResult<string>> {
  return runAction(mergeSchema, input, async ({ sourceId, targetId }) => {
    const profile = await requireMember();
    const { error } = await createAdminClient().rpc("merge_tickets", { p_source_id: sourceId, p_target_id: targetId, p_actor_id: profile.id });
    if (error) {
      // Mensagens das exceções da função (já em português).
      if (["22023", "23514", "P0002"].includes(error.code ?? "")) throw new ActionError(error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".");
      throw error;
    }
    return targetId;
  });
}

/** "Faz parte deste atendimento? Sim": tira a pergunta da mensagem. */
export async function confirmMessageContext(input: z.input<typeof messageIdSchema>): Promise<ActionResult<void>> {
  return runAction(messageIdSchema, input, async ({ messageId }) => {
    await requireMember();
    const { error } = await createAdminClient()
      .from("messages")
      .update({ context_check: "confirmed" })
      .eq("id", messageId)
      .eq("context_check", "pending");
    if (error) throw error;
  });
}
