import { createAdminClient } from "@/lib/supabase/admin";
import { clientFromRow, getInstanceRow } from "@/lib/uazapi/instance";

// Somente servidor. Fotos no bucket público `avatars`:
//   contacts/<contactId>-<versão>.jpg  (copiadas do WhatsApp)
//   profiles/<profileId>-<versão>.jpg  (enviadas pelo atendente)

export const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

type Admin = ReturnType<typeof createAdminClient>;

/** Grava a imagem com um nome novo (fura o cache) e devolve a URL pública. */
export async function uploadAvatar(db: Admin, folder: "contacts" | "profiles", ownerId: string, bytes: Buffer, mime: string) {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const path = `${folder}/${ownerId}-${Date.now().toString(36)}.${ext}`;
  const { error } = await db.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`upload da foto falhou: ${error.message}`);
  return { path, url: db.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl };
}

/** Remove a foto anterior (best-effort) a partir da URL pública salva. */
export async function removeAvatarByUrl(db: Admin, url: string | null | undefined) {
  const marker = `/object/public/${AVATAR_BUCKET}/`;
  const i = url?.indexOf(marker) ?? -1;
  if (!url || i < 0) return;
  await db.storage.from(AVATAR_BUCKET).remove([url.slice(i + marker.length)]);
}

/**
 * Copia a foto de perfil do WhatsApp do contato. Consulta a uazapi no máximo
 * 1x por semana por contato (ou sempre, com `force`). Nunca lança.
 */
export async function refreshContactAvatar(contactId: string, opts: { force?: boolean } = {}): Promise<void> {
  const db = createAdminClient();
  try {
    const { data: c } = await db
      .from("contacts")
      .select("id, phone, lid, avatar_url, avatar_checked_at")
      .eq("id", contactId)
      .maybeSingle<{ id: string; phone: string | null; lid: string | null; avatar_url: string | null; avatar_checked_at: string | null }>();
    if (!c) return;
    if (!opts.force && c.avatar_checked_at && Date.now() - new Date(c.avatar_checked_at).getTime() < RECHECK_MS) return;

    // Marca antes de buscar: rajadas de mensagens não disparam várias consultas.
    await db.from("contacts").update({ avatar_checked_at: new Date().toISOString() }).eq("id", c.id);

    const number = c.phone ?? (c.lid ? `${c.lid}@lid` : null);
    if (!number) return;

    const details = await clientFromRow(await getInstanceRow()).chatDetails(number);
    const remote = details.imagePreview || details.image;
    if (!remote) {
      // Sem foto (ou privada): limpa a antiga para não exibir algo desatualizado.
      if (c.avatar_url) {
        await removeAvatarByUrl(db, c.avatar_url);
        await db.from("contacts").update({ avatar_url: null }).eq("id", c.id);
      }
      return;
    }

    const res = await fetch(remote, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!res.ok) throw new Error(`download da foto falhou (${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();

    const { url } = await uploadAvatar(db, "contacts", c.id, bytes, mime.startsWith("image/") ? mime : "image/jpeg");
    await db.from("contacts").update({ avatar_url: url }).eq("id", c.id);
    await removeAvatarByUrl(db, c.avatar_url);
  } catch (e) {
    console.error(`[avatar] contato ${contactId}:`, e);
  }
}
