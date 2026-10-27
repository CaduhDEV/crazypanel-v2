import { createAdminClient } from "@/lib/supabase/admin";
import { r2Key, r2PresignGet, r2Put } from "@/lib/r2";
import type { MessageKind } from "@/lib/types";

// Somente servidor. Mídias novas ficam no Cloudflare R2 (bucket privado, sob
// R2_PREFIX) e as antigas no bucket `whatsapp-media` do Supabase até o
// backfill. São servidas por /api/media/:id (confere a sessão e redireciona
// para um link assinado de curta duração).

export type MediaStore = "supabase" | "r2";

/** Bucket antigo do Supabase (só leitura das mídias anteriores ao R2). */
export const MEDIA_BUCKET = "whatsapp-media";
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
};

export function extensionFor(mime: string | null, fileName?: string | null): string {
  const fromName = fileName?.includes(".") ? fileName.split(".").pop()?.toLowerCase() : null;
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? base.split("/")[1]?.replace(/[^a-z0-9]/g, "").slice(0, 8) ?? "bin";
}

/** Caminho no bucket: in|out/AAAA/MM/<id>.<ext>. */
export function mediaPath(direction: "in" | "out", id: string, mime: string | null, fileName?: string | null): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${direction}/${now.getUTCFullYear()}/${month}/${id}.${extensionFor(mime, fileName)}`;
}

/** Baixa um arquivo público (ex.: fileURL da uazapi, que expira em 2 dias) e guarda no R2. */
export async function copyRemoteToStorage(url: string, path: string, mime: string | null): Promise<{ size: number; mime: string; store: MediaStore }> {
  // Cabe na função (60 s) junto com o pedido à uazapi; o que não der, a rotina tenta de novo.
  const res = await fetch(url, { signal: AbortSignal.timeout(35_000), cache: "no-store" });
  if (!res.ok) throw new Error(`download da mídia falhou (${res.status})`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_MEDIA_BYTES) throw new Error("mídia maior que o limite de 100 MB");

  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = mime ?? res.headers.get("content-type") ?? "application/octet-stream";
  await r2Put(r2Key(path), buffer, contentType);
  return { size: buffer.length, mime: contentType, store: "r2" };
}

/** Guarda bytes gerados pelo painel (ex.: PDF do relatório) no R2. */
export async function storeFile(path: string, bytes: ArrayBuffer | Uint8Array, contentType: string): Promise<MediaStore> {
  await r2Put(r2Key(path), bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), contentType);
  return "r2";
}

/** Link temporário para abrir o arquivo, onde quer que ele esteja. */
export async function mediaUrl(
  file: { path: string; store?: MediaStore | null; mime?: string | null },
  expiresIn: number,
  downloadName?: string,
): Promise<string> {
  if (file.store === "r2") return r2PresignGet(r2Key(file.path), expiresIn, { download: downloadName, contentType: file.mime });
  return signedMediaUrl(file.path, expiresIn, downloadName);
}

/** Link assinado do Supabase (mídias anteriores ao R2). */
export async function signedMediaUrl(path: string, expiresIn: number, downloadName?: string): Promise<string> {
  const { data, error } = await createAdminClient()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrl(path, expiresIn, downloadName ? { download: downloadName } : undefined);
  if (error || !data) throw new Error(`não foi possível assinar a mídia: ${error?.message}`);
  return data.signedUrl;
}

/** Tipo de mensagem a partir do mime de um arquivo enviado pelo atendente. */
export function kindFromMime(mime: string): MessageKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}
