import { AwsClient } from "aws4fetch";

// Somente servidor. Cloudflare R2 (API compatível com S3): mídias e PDFs do
// painel ficam no bucket privado, sob o prefixo R2_PREFIX, e abrem por link
// pré-assinado de curta duração.

let client: AwsClient | null = null;

function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 não configurado (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).");
  }
  client ??= new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  return { client, base: `https://${accountId}.r2.cloudflarestorage.com/${bucket}` };
}

/** Chave no bucket: prefixo do painel + caminho (in/AAAA/MM/<id>.<ext>). */
export function r2Key(path: string): string {
  const prefix = (process.env.R2_PREFIX ?? "crazypanel/").replace(/^\/+/, "");
  return `${prefix.endsWith("/") || !prefix ? prefix : `${prefix}/`}${path.replace(/^\/+/, "")}`;
}

const objectUrl = (base: string, key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

export async function r2Put(key: string, body: ArrayBuffer | Uint8Array | Buffer, contentType: string): Promise<void> {
  const { client, base } = config();
  const res = await client.fetch(objectUrl(base, key), {
    method: "PUT",
    body: body as BodyInit,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) throw new Error(`upload no R2 falhou (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/** Tamanho e tipo do objeto, ou null se não existir. */
export async function r2Head(key: string): Promise<{ size: number; contentType: string | null } | null> {
  const { client, base } = config();
  const res = await client.fetch(objectUrl(base, key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`consulta no R2 falhou (${res.status})`);
  return { size: Number(res.headers.get("content-length") ?? 0), contentType: res.headers.get("content-type") };
}

export async function r2Get(key: string): Promise<Response> {
  const { client, base } = config();
  const res = await client.fetch(objectUrl(base, key), { method: "GET" });
  if (!res.ok) throw new Error(`leitura no R2 falhou (${res.status})`);
  return res;
}

export async function r2Delete(key: string): Promise<void> {
  const { client, base } = config();
  const res = await client.fetch(objectUrl(base, key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`exclusão no R2 falhou (${res.status})`);
}

/** Link de leitura temporário (o navegador e a uazapi abrem direto do R2). */
export async function r2PresignGet(key: string, seconds: number, opts: { download?: string; contentType?: string | null } = {}): Promise<string> {
  const { client, base } = config();
  const url = new URL(objectUrl(base, key));
  url.searchParams.set("X-Amz-Expires", String(Math.min(Math.max(60, Math.round(seconds)), 7 * 86_400)));
  if (opts.download) url.searchParams.set("response-content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`);
  if (opts.contentType) url.searchParams.set("response-content-type", opts.contentType);
  const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

/**
 * Link de envio temporário: o navegador sobe o arquivo direto para o R2.
 * A assinatura fixa só a chave e a validade (o R2 não amarra o Content-Type);
 * quem usa confere o objeto com r2Head antes de aceitá-lo.
 */
export async function r2PresignPut(key: string, contentType: string, seconds = 600): Promise<string> {
  const { client, base } = config();
  const url = new URL(objectUrl(base, key));
  url.searchParams.set("X-Amz-Expires", String(seconds));
  const signed = await client.sign(url.toString(), { method: "PUT", headers: { "Content-Type": contentType }, aws: { signQuery: true } });
  return signed.url;
}
