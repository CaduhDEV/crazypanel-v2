"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/session";
import { ActionError, runAction, type ActionResult } from "@/lib/action";
import { getUazapi } from "@/lib/uazapi/instance";
import { splitIdentity, UazapiError, type UazGroup } from "@/lib/uazapi/client";

function wrapUazapi(e: unknown): never {
  if (e instanceof UazapiError) throw new ActionError(e.message);
  throw e;
}

/** Busca todos os grupos da conta na uazapi (paginado) e atualiza a lista. Escuta não muda. */
export async function syncGroups(): Promise<ActionResult<number>> {
  return runAction(z.undefined(), undefined, async () => {
    await requireAdmin();
    const uaz = await getUazapi();
    const groups: UazGroup[] = [];

    try {
      let offset = 0;
      for (let page = 0; page < 50; page++) {
        const res = await uaz.listGroups(offset, 200);
        groups.push(...(res.groups ?? []));
        if (!res.pagination?.hasMore || res.pagination.nextOffset == null) break;
        offset = res.pagination.nextOffset;
      }
    } catch (e) {
      wrapUazapi(e);
    }

    const now = new Date().toISOString();
    const rows = groups
      .filter((g) => g.JID?.endsWith("@g.us"))
      .map((g) => ({
        jid: g.JID,
        name: g.Name || null,
        description: g.Topic || null,
        picture_url: g.image_preview_url || g.image_url || null,
        member_count: g.ParticipantCount ?? null,
        is_announce: g.IsAnnounce === true,
        is_community: g.IsParent === true,
        synced_at: now,
      }));

    const db = createAdminClient();
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("wa_groups").upsert(rows.slice(i, i + 500), { onConflict: "jid" });
      if (error) throw error;
    }
    revalidatePath("/admin/grupos");
    return rows.length;
  });
}

const listeningSchema = z.object({ jid: z.string().endsWith("@g.us"), listening: z.boolean() });

export async function setGroupListening(input: z.input<typeof listeningSchema>): Promise<ActionResult<void>> {
  return runAction(listeningSchema, input, async ({ jid, listening }) => {
    await requireAdmin();
    const { error } = await createAdminClient().from("wa_groups").update({ listening }).eq("jid", jid);
    if (error) throw error;
    revalidatePath("/admin/grupos");
  });
}

const partnerSchema = z.object({ jid: z.string().endsWith("@g.us"), isPartnerGroup: z.boolean() });

/**
 * Marca o grupo como "de parceiros": os clientes que estão nele viram parceiros
 * (equipe continua equipe). Desmarcar não volta ninguém a cliente.
 */
export async function setPartnerGroup(input: z.input<typeof partnerSchema>): Promise<ActionResult<void>> {
  return runAction(partnerSchema, input, async ({ jid, isPartnerGroup }) => {
    await requireAdmin();
    const { error } = await createAdminClient().from("wa_groups").update({ is_partner_group: isPartnerGroup }).eq("jid", jid);
    if (error) throw error;
    revalidatePath("/admin/grupos");
    revalidatePath("/leads");
  });
}

const jidSchema = z.object({ jid: z.string().endsWith("@g.us") });

/** Traz os participantes do grupo para a base de leads (inclui quem nunca falou). */
export async function syncGroupMembers(input: z.input<typeof jidSchema>): Promise<ActionResult<number>> {
  return runAction(jidSchema, input, async ({ jid }) => {
    await requireAdmin();
    const uaz = await getUazapi();
    let info: UazGroup | undefined;
    try {
      info = await uaz.groupInfo(jid);
    } catch (e) {
      wrapUazapi(e);
    }

    const members = (info?.Participants ?? [])
      .map((p) => {
        const { phone, lid } = splitIdentity(p.PhoneNumber, p.LID, p.JID);
        return { phone, lid, name: p.DisplayName || null, is_admin: p.IsAdmin === true || p.IsSuperAdmin === true };
      })
      .filter((m) => m.phone || m.lid);

    const { data, error } = await createAdminClient().rpc("sync_group_members", { p_group_jid: jid, p_members: members });
    if (error) throw error;
    revalidatePath("/admin/grupos");
    revalidatePath("/leads");
    return (data as number) ?? members.length;
  });
}
