// Leva as mídias e PDFs que ainda estão no Storage do Supabase para o R2.
// Para cada arquivo: copia, confere o tamanho no R2, marca a origem como 'r2'
// e só então apaga do Supabase. Pode rodar de novo (só pega o que falta).
//
//   npx tsx --env-file=.env.local scripts/media-to-r2.mts [--dry-run]

import { createClient } from "@supabase/supabase-js";
import { r2Head, r2Key, r2Put } from "../lib/r2.ts";

const BUCKET = "whatsapp-media";
const dryRun = process.argv.includes("--dry-run");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

type Job = { table: "messages" | "reports"; id: string | number; path: string; mime: string | null; storeColumn: "media_store" | "file_store" };

async function pending(): Promise<Job[]> {
  const jobs: Job[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("messages")
      .select("id, media_path, media_mime")
      .eq("media_store", "supabase")
      .not("media_path", "is", null)
      .range(from, from + 999);
    if (error) throw error;
    jobs.push(...data.map((m) => ({ table: "messages" as const, id: m.id, path: m.media_path as string, mime: m.media_mime as string | null, storeColumn: "media_store" as const })));
    if (data.length < 1000) break;
  }
  const { data: reports, error } = await db.from("reports").select("id, file_path").eq("file_store", "supabase").not("file_path", "is", null);
  if (error) throw error;
  jobs.push(...reports.map((r) => ({ table: "reports" as const, id: r.id, path: r.file_path as string, mime: "application/pdf", storeColumn: "file_store" as const })));
  return jobs;
}

const jobs = await pending();
console.log(`${jobs.length} arquivo(s) no Supabase${dryRun ? " (simulação)" : ""}`);
let moved = 0;
let missing = 0;
let failed = 0;
let bytes = 0;

for (const job of jobs) {
  try {
    const { data: blob, error } = await db.storage.from(BUCKET).download(job.path);
    if (error || !blob) {
      // O arquivo sumiu do Storage: não há o que copiar; a mensagem fica como estava.
      missing++;
      console.warn(`sem arquivo no Supabase: ${job.table} ${job.id} (${job.path})`);
      continue;
    }
    const body = new Uint8Array(await blob.arrayBuffer());
    if (dryRun) {
      moved++;
      bytes += body.byteLength;
      continue;
    }
    const key = r2Key(job.path);
    await r2Put(key, body, job.mime ?? blob.type ?? "application/octet-stream");
    const head = await r2Head(key);
    if (!head || head.size !== body.byteLength) throw new Error(`tamanho no R2 não confere (${head?.size} ≠ ${body.byteLength})`);

    const { error: upd } = await db.from(job.table).update({ [job.storeColumn]: "r2" }).eq("id", job.id);
    if (upd) throw upd;
    const { error: rm } = await db.storage.from(BUCKET).remove([job.path]);
    if (rm) console.warn(`copiado, mas não apagou do Supabase: ${job.path}: ${rm.message}`);
    moved++;
    bytes += body.byteLength;
  } catch (e) {
    failed++;
    console.error(`falhou ${job.table} ${job.id} (${job.path}):`, e instanceof Error ? e.message : e);
  }
}

console.log(`${dryRun ? "copiaria" : "movidos"}: ${moved} (${(bytes / 1048576).toFixed(1)} MB) · sem arquivo: ${missing} · falhas: ${failed}`);
if (failed) process.exitCode = 1;
