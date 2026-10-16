"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember } from "@/lib/auth/session";
import { ActionError, fail, ok, type ActionResult } from "@/lib/action";
import { removeAvatarByUrl, uploadAvatar } from "@/lib/avatars";

const MAX_BYTES = 900 * 1024; // o navegador já reduz para 256px antes de enviar
const MIMES = ["image/jpeg", "image/png", "image/webp"];

/** Troca a foto do próprio atendente. Recebe FormData com o campo `file`. */
export async function updateMyAvatar(form: FormData): Promise<ActionResult<string>> {
  try {
    const profile = await requireMember();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("Selecione uma imagem.");
    if (!MIMES.includes(file.type)) throw new ActionError("Use uma imagem JPG, PNG ou WebP.");
    if (file.size > MAX_BYTES) throw new ActionError("Imagem grande demais.");

    const db = createAdminClient();
    const { url } = await uploadAvatar(db, "profiles", profile.id, Buffer.from(await file.arrayBuffer()), file.type);
    const { error } = await db.from("profiles").update({ avatar_url: url }).eq("id", profile.id);
    if (error) throw error;
    await removeAvatarByUrl(db, profile.avatar_url);

    revalidatePath("/", "layout");
    return ok(url);
  } catch (e) {
    if (e instanceof ActionError) return fail(e.message);
    console.error("[action] updateMyAvatar", e);
    return fail("Não foi possível trocar a foto. Tente novamente.");
  }
}

/** Remove a foto do próprio atendente (volta às iniciais). */
export async function removeMyAvatar(): Promise<ActionResult<void>> {
  try {
    const profile = await requireMember();
    const db = createAdminClient();
    const { error } = await db.from("profiles").update({ avatar_url: null }).eq("id", profile.id);
    if (error) throw error;
    await removeAvatarByUrl(db, profile.avatar_url);
    revalidatePath("/", "layout");
    return ok(undefined);
  } catch (e) {
    console.error("[action] removeMyAvatar", e);
    return fail("Não foi possível remover a foto.");
  }
}
