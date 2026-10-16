import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Só servidor: criptografa segredos antes de irem para o banco (token da instância uazapi).
 * AES-256-GCM com APP_ENCRYPTION_KEY (32 bytes em base64).
 * Formato: "v1.<iv>.<tag>.<dados>", tudo em base64url.
 */
function key(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY;
  const buf = secret ? Buffer.from(secret, "base64") : null;
  if (!buf || buf.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY ausente ou inválida (precisa de 32 bytes em base64).");
  }
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Segredo salvo em formato desconhecido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Comparação em tempo constante (segredo do webhook). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
