"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { getSettings } from "@/lib/settings";
import { getUazapi } from "@/lib/uazapi/instance";
import { UazapiError, type UazapiClient } from "@/lib/uazapi/client";
import {
  communityGroups,
  fillJoinMessage,
  GROUP_CAPACITY,
  logCommunityEvent,
  sendPrivate,
  type Admin,
  type JoinRequestRow,
} from "@/lib/community/core";
import { JOIN_SYNC_MIN_INTERVAL_MS, syncWhatsAppJoinRequests, type JoinSyncResult } from "@/lib/community/sync";

const uazMessage = (e: unknown) => (e instanceof UazapiError ? e.message : e instanceof Error ? e.message : String(e));

/** Identificador aceito pela uazapi: telefone (dígitos) ou o JID @lid. */
const participantId = (r: Pick<JoinRequestRow, "phone" | "lid">) => r.phone ?? (r.lid ? `${r.lid}@lid` : null);

async function loadRequest(db: Admin, id: string): Promise<JoinRequestRow> {
  const { data } = await db.from("join_requests").select("*").eq("id", id).maybeSingle<JoinRequestRow>();
  if (!data) throw new ActionError("Solicitação não encontrada.");
  if (!["pending", "error", "expired"].includes(data.status)) throw new ActionError("Essa solicitação já foi decidida.");
  return data;
}

/**
 * Cria (ou reaproveita) o lead da solicitação aceita: telefone, nome, e-mail,
 * empresa e dados do CRM. O lead só nasce aqui, no aceite.
 */
async function createLeadFromRequest(db: Admin, req: JoinRequestRow, adminId: string): Promise<string | null> {
  const { data: contactId } = await db.rpc("upsert_contact", { p_phone: req.phone, p_lid: req.lid, p_name: req.name });
  const id = (contactId as string | null) ?? null;
  if (!id) return null;
  const { data: contact } = await db.from("contacts").select("email, company_id").eq("id", id).maybeSingle();
  const now = new Date().toISOString();
  await db
    .from("contacts")
    .update({
      email: (contact?.email as string | null) ?? req.email,
      ...(req.company_id && !contact?.company_id ? { company_id: req.company_id, linked_at: now, linked_by: adminId } : {}),
      ...(req.crm_lead_id ? { crm_lead_id: req.crm_lead_id, crm_tax_id: req.crm_tax_id ?? null, crm_checked_at: now } : {}),
    })
    .eq("id", id);
  await db.from("join_requests").update({ contact_id: id }).eq("id", req.id);
  return id;
}

/** Ocupação real do grupo (uazapi); se a consulta falhar, usa o que o painel conhece. */
async function occupancy(db: Admin, uaz: UazapiClient, jid: string): Promise<number | null> {
  try {
    const info = await uaz.groupInfo(jid);
    if (typeof info.ParticipantCount === "number") return info.ParticipantCount;
    if (Array.isArray(info.Participants)) return info.Participants.length;
  } catch {}
  const { data } = await db.from("wa_groups").select("member_count").eq("jid", jid).maybeSingle();
  return (data?.member_count as number | null) ?? null;
}

// =============================================================================
// Leitura
// =============================================================================
export interface CommunityGroupOccupancy {
  jid: string;
  name: string;
  members: number | null;
  capacity: number;
  full: boolean;
}

/** Grupos da comunidade com a ocupação atual (diálogo de aceite). */
export async function getCommunityOccupancy(): Promise<ActionResult<CommunityGroupOccupancy[]>> {
  return runAction(z.object({}), {}, async () => {
    await requireAdmin();
    const db = createAdminClient();
    const uaz = await getUazapi();
    const groups = await communityGroups(db);
    return Promise.all(
      groups.map(async (g) => {
        const members = await occupancy(db, uaz, g.jid);
        return { ...g, members, capacity: GROUP_CAPACITY, full: members !== null && members >= GROUP_CAPACITY };
      }),
    );
  });
}

/** Lê os pedidos feitos pelo WhatsApp (no máximo 1x por minuto, salvo `force`). */
export async function refreshJoinRequests(input: { force?: boolean } = {}): Promise<ActionResult<JoinSyncResult>> {
  return runAction(z.object({ force: z.boolean().default(false) }), input, async ({ force }) => {
    await requireAdmin();
    try {
      const result = await syncWhatsAppJoinRequests({ ifOlderThanMs: force ? undefined : JOIN_SYNC_MIN_INTERVAL_MS });
      if (result.created || result.expired) revalidatePath("/solicitacoes");
      return result;
    } catch (e) {
      // Falha inesperada (banco, por exemplo): volta como aviso, sem derrubar a página.
      console.warn("[community] leitura dos pedidos do WhatsApp:", uazMessage(e));
      return { skipped: false, created: 0, expired: 0, unreadable: [], unavailable: "unreachable" as const };
    }
  });
}

// =============================================================================
// Aceitar
// =============================================================================
const acceptSchema = z.object({ id: z.uuid(), groupJids: z.array(z.string().endsWith("@g.us")).max(10).default([]) });

/**
 * Aceita a solicitação. Pedido do WhatsApp: aprova no grupo pedido. Pedido do
 * formulário: adiciona nos grupos escolhidos; se a privacidade da pessoa
 * bloquear, manda o link do grupo no privado (status "convidado").
 */
export async function acceptJoinRequest(input: z.input<typeof acceptSchema>): Promise<ActionResult<{ status: string; groups: string[] }>> {
  return runAction(acceptSchema, input, async ({ id, groupJids }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const req = await loadRequest(db, id);
    const who = participantId(req);
    if (!who) throw new ActionError("A solicitação não tem telefone nem identificador do WhatsApp.");

    const uaz = await getUazapi();
    const groups = new Map((await communityGroups(db)).map((g) => [g.jid, g.name]));
    const targets = req.source === "whatsapp" ? [req.group_jid!].filter(Boolean) : groupJids;
    if (!targets.length) throw new ActionError("Escolha ao menos um grupo.");

    // Vagas.
    for (const jid of targets) {
      const members = await occupancy(db, uaz, jid);
      if (members !== null && members >= GROUP_CAPACITY) throw new ActionError(`O grupo ${groups.get(jid) ?? jid} está cheio (${members}/${GROUP_CAPACITY}).`);
    }

    const added: string[] = [];
    const invited: string[] = [];
    const already: string[] = [];
    const failed: string[] = [];
    for (const jid of targets) {
      const groupName = groups.get(jid) ?? jid;
      try {
        const action = req.source === "whatsapp" ? "approve" : "add";
        const res = await uaz.updateParticipants(jid, action, [who]);
        const r = res.groupUpdated?.[0];
        if (!r || !r.Error) {
          added.push(jid);
          continue;
        }
        // 409: já é participante (ex.: entrou por link, ou o número está sem o 9º dígito no WhatsApp).
        if (r.Error === 409) {
          already.push(jid);
          continue;
        }
        if (action === "add" && r.Error === 403) {
          // Privacidade bloqueou: convite pelo link do grupo, no privado.
          const linkRes = await uaz.groupInviteLink(jid).catch(() => null);
          const link = JSON.stringify(linkRes ?? {}).match(/https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/)?.[0] ?? null;
          if (link && req.phone) {
            await sendPrivate(db, req, `Olá${req.name ? `, ${req.name}` : ""}! Seu pedido para entrar na comunidade DataCrazy foi aprovado. Entre no grupo ${groupName} por este link: ${link}`, "invite_link");
            invited.push(jid);
            await logCommunityEvent(db, { type: "invite_sent", request_id: id, group_jid: jid, contact_id: req.contact_id, phone: req.phone, name: req.name, actor_profile_id: admin.id, data: { reason: "privacy" } });
            continue;
          }
        }
        failed.push(jid);
        await logCommunityEvent(db, {
          type: action === "approve" ? "approve_failed" : "add_failed",
          request_id: id,
          group_jid: jid,
          contact_id: req.contact_id,
          phone: req.phone,
          name: req.name,
          actor_profile_id: admin.id,
          data: { error_code: r.Error },
        });
      } catch (e) {
        failed.push(jid);
        await logCommunityEvent(db, {
          type: req.source === "whatsapp" ? "approve_failed" : "add_failed",
          request_id: id,
          group_jid: jid,
          contact_id: req.contact_id,
          phone: req.phone,
          name: req.name,
          actor_profile_id: admin.id,
          data: { error: uazMessage(e) },
        });
      }
    }

    const status = added.length ? "accepted" : invited.length ? "invited" : already.length ? "joined" : "error";
    await db
      .from("join_requests")
      .update({
        status,
        target_groups: targets,
        decided_by: admin.id,
        decided_at: new Date().toISOString(),
        error: failed.length ? `Falhou em: ${failed.map((j) => groups.get(j) ?? j).join(", ")}` : null,
      })
      .eq("id", id);

    if (status !== "error") {
      req.contact_id = (await createLeadFromRequest(db, req, admin.id)) ?? req.contact_id;
      await logCommunityEvent(db, {
        type: "request_accepted",
        request_id: id,
        contact_id: req.contact_id,
        phone: req.phone,
        name: req.name,
        actor_profile_id: admin.id,
        data: { added, invited, already, failed },
      });
    }
    if (added.length) {
      const settings = await getSettings();
      const names = added.map((j) => groups.get(j) ?? j).join(", ");
      await sendPrivate(db, req, fillJoinMessage(settings.join_msg_accepted, { nome: req.name, grupo: names, email: req.email }), "accepted");
    }
    if (status === "error") throw new ActionError("Não foi possível colocar a pessoa em nenhum grupo. Veja o log da solicitação.");

    revalidatePath("/solicitacoes");
    return { status, groups: [...added, ...invited, ...already].map((j) => groups.get(j) ?? j) };
  });
}

// =============================================================================
// Recusar
// =============================================================================
const idSchema = z.object({ id: z.uuid() });

export async function rejectJoinRequest(input: z.input<typeof idSchema>): Promise<ActionResult<void>> {
  return runAction(idSchema, input, async ({ id }) => {
    const admin = await requireAdmin();
    const db = createAdminClient();
    const req = await loadRequest(db, id);

    if (req.source === "whatsapp" && req.group_jid) {
      const who = participantId(req);
      try {
        if (who) await (await getUazapi()).updateParticipants(req.group_jid, "reject", [who]);
      } catch (e) {
        // O pedido pode já ter sumido do WhatsApp; a recusa vale no painel mesmo assim.
        await logCommunityEvent(db, { type: "approve_failed", request_id: id, group_jid: req.group_jid, phone: req.phone, data: { action: "reject", error: uazMessage(e) } });
      }
    }

    await db.from("join_requests").update({ status: "rejected", decided_by: admin.id, decided_at: new Date().toISOString(), error: null }).eq("id", id);
    await logCommunityEvent(db, { type: "request_rejected", request_id: id, group_jid: req.group_jid, contact_id: req.contact_id, phone: req.phone, name: req.name, actor_profile_id: admin.id });

    const settings = await getSettings();
    await sendPrivate(db, req, fillJoinMessage(settings.join_msg_rejected, { nome: req.name, email: req.email }), "rejected");
    revalidatePath("/solicitacoes");
  });
}
