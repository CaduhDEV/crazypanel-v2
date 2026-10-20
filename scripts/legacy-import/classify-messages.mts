// Categoria e subcategoria em cada mensagem (inclusive fora de atendimento).
//   atendimento → a do atendimento
//   regras      → categoria antiga + palavras-chave da mensagem
//   herdada     → respostas e contexto: o assunto da mensagem citada ou, sem
//                 citação, da última mensagem classificada no grupo (até 30 min antes)
// Também completa atendimentos importados sem categoria/subcategoria pela
// maioria das mensagens. Pode rodar de novo.
//
//   npx tsx --env-file=.env.local scripts/legacy-import/classify-messages.mts [--dry-run]

import { writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { classifyMessage, type Category, type Topic } from "./classify.ts";

const DRY = process.argv.includes("--dry-run");
const INHERIT_WINDOW_MS = 30 * 60 * 1000;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const LEGACY_URL = process.env.LEGACY_SUPABASE_URL!;
const LEGACY_KEY = process.env.LEGACY_SUPABASE_SERVICE_KEY!;
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

type Result = { category: Category; topic: Topic | null; source: "atendimento" | "regras" | "herdada" };
interface Msg {
  id: string;
  group_jid: string;
  ticket_id: string | null;
  legacy_id: string | null;
  wa_id: string | null;
  quoted_wa_id: string | null;
  body: string | null;
  sent_at: string;
  is_note: boolean;
}
interface Ticket {
  id: string;
  category: Category | null;
  topic: Topic | null;
  legacy_id: string | null;
}

async function all<T>(table: string, select: string): Promise<T[]> {
  const out: T[] = [];
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await db.from(table).select(select).gt("id", last).order("id").limit(1000);
    if (error) throw error;
    out.push(...(data as unknown as T[]));
    if (data.length < 1000) return out;
    last = (data.at(-1) as unknown as { id: string }).id;
  }
}

async function oldCategories(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let last = 0; ; ) {
    const res = await fetch(`${LEGACY_URL}/rest/v1/messages?select=id,category&id=gt.${last}&order=id&limit=1000`, {
      headers: { apikey: LEGACY_KEY, Authorization: `Bearer ${LEGACY_KEY}` },
    });
    const rows = (await res.json()) as { id: number; category: string | null }[];
    for (const r of rows) if (r.category) map.set(`m:${r.id}`, r.category);
    if (rows.length < 1000) return map;
    last = rows.at(-1)!.id;
  }
}

function majority<T extends string>(values: (T | null | undefined)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  for (const [v, n] of counts) if (!best || n > counts.get(best)!) best = v;
  return best;
}

async function main() {
  log("lendo mensagens, atendimentos e categorias antigas…");
  const [messages, tickets, oldCat] = await Promise.all([
    all<Msg>("messages", "id, group_jid, ticket_id, legacy_id, wa_id, quoted_wa_id, body, sent_at, is_note"),
    all<Ticket>("tickets", "id, category, topic, legacy_id"),
    oldCategories(),
  ]);
  log(`${messages.length} mensagens, ${tickets.length} atendimentos, ${oldCat.size} categorias antigas`);
  const ticketById = new Map(tickets.map((t) => [t.id, t]));

  // 1) Regra por mensagem, em ordem cronológica por grupo (a herança olha para trás).
  messages.sort((a, b) => a.group_jid.localeCompare(b.group_jid) || a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id));
  const rule = new Map<string, Result>(); // id → resultado só pelas regras
  const byWa = new Map<string, Result>();
  const last = new Map<string, { r: Result; at: number }>(); // grupo → último assunto
  for (const m of messages) {
    if (m.is_note) continue;
    const at = Date.parse(m.sent_at);
    const own = classifyMessage(oldCat.get(m.legacy_id ?? "") ?? null, m.body ?? "");
    let r: Result | null = null;
    if (own && own !== "inherit") {
      r = { ...own, source: "regras" };
      if (!r.topic) {
        // Sem palavra-chave de assunto: a subcategoria da citada ou da conversa, se for da mesma categoria.
        const quoted = m.quoted_wa_id ? byWa.get(m.quoted_wa_id) : undefined;
        const thread = last.get(m.group_jid);
        const near = thread && at - thread.at <= INHERIT_WINDOW_MS ? thread.r : undefined;
        r.topic = (quoted?.category === r.category ? quoted.topic : null) ?? (near?.category === r.category ? near.topic : null) ?? null;
      }
      last.set(m.group_jid, { r, at });
    } else if (own === "inherit" || m.quoted_wa_id) {
      const quoted = m.quoted_wa_id ? byWa.get(m.quoted_wa_id) : undefined;
      const thread = last.get(m.group_jid);
      const from = quoted ?? (thread && at - thread.at <= INHERIT_WINDOW_MS ? thread.r : undefined);
      if (from) r = { category: from.category, topic: from.topic, source: "herdada" };
    }
    if (r) {
      rule.set(m.id, r);
      if (m.wa_id) byWa.set(m.wa_id, r);
    }
  }

  // 2) Atendimentos importados sem categoria/subcategoria: maioria das mensagens.
  const msgsByTicket = new Map<string, Msg[]>();
  for (const m of messages) if (m.ticket_id && !m.is_note) (msgsByTicket.get(m.ticket_id) ?? msgsByTicket.set(m.ticket_id, []).get(m.ticket_id)!).push(m);
  const ticketFixes: { id: string; category: Category; topic: Topic | null }[] = [];
  for (const t of tickets) {
    if (!t.legacy_id || (t.category && t.topic)) continue;
    const results = (msgsByTicket.get(t.id) ?? []).map((m) => rule.get(m.id)).filter(Boolean) as Result[];
    const category = t.category ?? majority(results.map((r) => r.category));
    if (!category) continue;
    const topic = t.topic ?? majority(results.filter((r) => r.category === category).map((r) => r.topic));
    if (category !== t.category || topic !== t.topic) {
      ticketFixes.push({ id: t.id, category, topic });
      t.category = category;
      t.topic = topic;
    }
  }

  // 3) Resultado final: atendimento classificado vence; senão, a regra.
  const rows: { id: string; category: Category; topic: Topic | null; source: Result["source"] }[] = [];
  const sources: Record<string, number> = {};
  const dist: Record<string, number> = {};
  let none = 0;
  for (const m of messages) {
    const t = m.ticket_id ? ticketById.get(m.ticket_id) : undefined;
    const r: Result | undefined = t?.category ? { category: t.category, topic: t.topic, source: "atendimento" } : m.is_note ? undefined : rule.get(m.id);
    if (!r) {
      if (!m.is_note) none++;
      continue;
    }
    rows.push({ id: m.id, ...r });
    inc(sources, r.source);
    inc(dist, `${r.category} · ${r.topic ?? "sem subcategoria"}`);
  }
  const report = {
    dry_run: DRY,
    mensagens: messages.filter((m) => !m.is_note).length,
    classificadas: rows.length,
    sem_categoria: none,
    por_origem: sources,
    atendimentos_completados: ticketFixes.length,
    distribuicao: Object.fromEntries(Object.entries(dist).sort((a, b) => b[1] - a[1])),
  };
  mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./out/categorias-mensagens.json", import.meta.url), JSON.stringify(report, null, 2));
  log(JSON.stringify({ mensagens: report.mensagens, classificadas: rows.length, sem_categoria: none, por_origem: sources, atendimentos_completados: ticketFixes.length }));
  if (DRY) return;

  // 4) Grava: atendimentos (o gatilho leva às mensagens deles) e depois as mensagens.
  for (const f of ticketFixes) {
    const { error } = await db.from("tickets").update({ category: f.category, topic: f.topic }).eq("id", f.id);
    if (error) throw error;
  }
  let changed = 0;
  for (const part of chunk(rows, 1000)) {
    const { data, error } = await db.rpc("set_message_categories", { p_rows: part });
    if (error) throw error;
    changed += data as number;
  }
  log(`atendimentos completados: ${ticketFixes.length} · mensagens atualizadas: ${changed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
