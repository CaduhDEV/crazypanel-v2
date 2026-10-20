// Importa o histórico do sistema antigo (groups / Evolution) para o painel.
// Só texto e legendas; idempotente (pode rodar de novo: só entra o que falta).
//
//   npx tsx --env-file=.env.local scripts/legacy-import/run.mts --dry-run   # só relatório
//   npx tsx --env-file=.env.local scripts/legacy-import/run.mts             # grava
//
// Relatório de conferência em scripts/legacy-import/out/.

import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { classify, type Classification } from "./classify.ts";
import {
  bodyOf,
  closeReasonOf,
  digits,
  identityKey,
  identityOf,
  identityOfNumber,
  norm,
  preview,
  REPLY_STATUS,
  replyWaIdOf,
  sameIdentity,
  waIdOf,
  type Identity,
  type OldAttendance,
  type OldMessage,
  type OldReply,
} from "./map.ts";

const DRY = process.argv.includes("--dry-run");
const OUT = new URL("./out/", import.meta.url);
const LEGACY_URL = process.env.LEGACY_SUPABASE_URL!;
const LEGACY_KEY = process.env.LEGACY_SUPABASE_SERVICE_KEY!;
if (!LEGACY_URL || !LEGACY_KEY) throw new Error("Defina LEGACY_SUPABASE_URL e LEGACY_SUPABASE_SERVICE_KEY no .env.local.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

const TEAM_EMAIL = /@datacrazy\.(io|com\.br)$/i;
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const inc = (o: Record<string, number>, k: string, n = 1) => (o[k] = (o[k] ?? 0) + n);

/** Mesmo critério do public.phone_key: sem DDI 55 e sem o 9º dígito. */
function phoneKey(raw: string | null | undefined): string {
  let d = digits(raw);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11 && d[2] === "9") d = d.slice(0, 2) + d.slice(3);
  return d;
}

// --- leitura do banco antigo ------------------------------------------------------
async function legacyGet<T>(path: string): Promise<T[]> {
  const res = await fetch(`${LEGACY_URL}/rest/v1/${path}`, { headers: { apikey: LEGACY_KEY, Authorization: `Bearer ${LEGACY_KEY}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`banco antigo: ${path}: ${JSON.stringify(body).slice(0, 200)}`);
  return body as T[];
}
async function legacyAll<T>(table: string, select: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await legacyGet<T>(`${table}?select=${select}&order=${order}&offset=${offset}&limit=1000`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
async function legacyMessages(): Promise<OldMessage[]> {
  const out: OldMessage[] = [];
  const cols = "id,group_id,number,sender,sender_jid,name,content,type,created_at,attendance_id,category,id_message,quoted_message_id";
  for (let last = 0; ; ) {
    const rows = await legacyGet<OldMessage>(`messages?select=${cols}&id=gt.${last}&order=id&limit=1000`);
    out.push(...rows);
    if (rows.length < 1000) return out;
    last = rows.at(-1)!.id;
  }
}

// --- execução -------------------------------------------------------------------------
const counts: Record<string, number> = {};
const skipped: Record<string, number> = {};
let runId: number | null = null;

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!DRY) {
    const { data } = await db.from("legacy_import_runs").insert({ dry_run: false }).select("id").single();
    runId = (data?.id as number | undefined) ?? null;
  }

  log("lendo o banco antigo…");
  const [oldGroups, oldProfiles, aliases, members, attendances, replies] = await Promise.all([
    legacyAll<{ group_id: string; name: string | null }>("groups", "group_id,name", "group_id"),
    legacyAll<{ name: string; email: string; phone: string | null }>("profiles", "name,email,phone", "email"),
    legacyAll<{ alias: string; canonical_number: string }>("user_aliases", "alias,canonical_number", "alias"),
    legacyAll<{ phone: string | null; lid: string | null; real_name: string | null; email: string | null; company_id: string | null; company_name: string | null; is_partner: boolean; strikes: number }>(
      "community_members",
      "phone,lid,real_name,email,company_id,company_name,is_partner,strikes",
      "identity",
    ),
    legacyAll<OldAttendance>("attendances", "id,group_id,lead_number,started_at,last_message_at,ended_at,status,finished_by,finished_note,finished_reason,title,avg_response_seconds", "started_at"),
    legacyAll<OldReply>("attendance_replies", "id,attendance_id,text,author,status,created_at,is_internal,wa_message_id", "created_at"),
  ]);
  const messages = await legacyMessages();
  Object.assign(counts, {
    antigo_mensagens: messages.length,
    antigo_atendimentos: attendances.length,
    antigo_respostas_equipe: replies.length,
    antigo_grupos: oldGroups.length,
    antigo_membros: members.length,
  });
  log(`${messages.length} mensagens, ${attendances.length} atendimentos, ${replies.length} respostas`);

  // 1) Grupos que faltam (entram desligados; os existentes não mudam).
  const { data: newGroups } = await db.from("wa_groups").select("jid");
  const have = new Set((newGroups ?? []).map((g) => g.jid as string));
  const groupName = new Map(oldGroups.map((g) => [g.group_id, g.name]));
  const needed = new Set([...messages.map((m) => m.group_id), ...attendances.map((a) => a.group_id)].filter((j) => j?.endsWith("@g.us")));
  const missingGroups = [...needed].filter((j) => !have.has(j)).map((jid) => ({ jid, name: groupName.get(jid) ?? null, listening: false }));
  counts.grupos_criados = missingGroups.length;
  if (!DRY && missingGroups.length) {
    const { error } = await db.from("wa_groups").upsert(missingGroups, { onConflict: "jid", ignoreDuplicates: true });
    if (error) throw error;
  }

  // 2) Identidades (telefone e LID). Pares primeiro: ligam o telefone ao LID no mesmo contato.
  const ids = new Map<string, Identity & { name: string | null }>();
  const addId = (i: Identity | null, name?: string | null) => {
    if (!i) return;
    const k = identityKey(i);
    const cur = ids.get(k);
    const n = name?.trim() || null;
    if (!cur) ids.set(k, { ...i, name: n });
    else if (n) cur.name = n; // o nome mais recente vence (mensagens vêm em ordem)
  };
  for (const a of aliases) addId({ phone: digits(a.canonical_number) || null, lid: digits(a.alias) || null });
  for (const m of members) addId({ phone: digits(m.phone) || null, lid: digits(m.lid) || null }, m.real_name);
  for (const m of messages) addId(identityOf(m), m.name);
  for (const a of attendances) addId(identityOfNumber(a.lead_number));
  const idRows = [...ids.entries()]
    .sort(([, a], [, b]) => Number(!!(b.phone && b.lid)) - Number(!!(a.phone && a.lid)))
    .map(([key, v]) => ({ key, phone: v.phone, lid: v.lid, name: v.name }));
  counts.identidades = idRows.length;
  counts.identidades_com_telefone_e_lid = idRows.filter((r) => r.phone && r.lid).length;

  const contactByKey = new Map<string, string>();
  if (DRY) {
    // Simulação: quantos já existem no painel (por LID, telefone ou phone_key).
    const lids = new Set<string>();
    const phones = new Set<string>();
    const keys = new Set<string>();
    for (const part of chunk(idRows.filter((r) => r.lid).map((r) => r.lid!), 300)) {
      const { data } = await db.from("contacts").select("lid").in("lid", part);
      data?.forEach((d) => lids.add(d.lid as string));
    }
    for (const part of chunk(idRows.filter((r) => r.phone).map((r) => r.phone!), 300)) {
      const { data } = await db.from("contacts").select("phone").in("phone", part);
      data?.forEach((d) => phones.add(d.phone as string));
    }
    for (const part of chunk([...new Set(idRows.filter((r) => r.phone).map((r) => phoneKey(r.phone)))], 300)) {
      const { data } = await db.from("contacts").select("phone_key").in("phone_key", part);
      data?.forEach((d) => keys.add(d.phone_key as string));
    }
    for (const r of idRows) {
      if (r.lid && lids.has(r.lid)) inc(counts, "contatos_casam_por_lid");
      else if (r.phone && phones.has(r.phone)) inc(counts, "contatos_casam_por_telefone");
      else if (r.phone && keys.has(phoneKey(r.phone))) inc(counts, "contatos_casam_por_phone_key");
      else inc(counts, "contatos_novos");
    }
  } else {
    log(`resolvendo ${idRows.length} identidades…`);
    for (const part of chunk(idRows, 300)) {
      const { data, error } = await db.rpc("legacy_import_contacts", { p_rows: part });
      if (error) throw error;
      for (const r of data as { key: string; contact_id: string }[]) contactByKey.set(r.key, r.contact_id);
    }
    counts.contatos_resolvidos = contactByKey.size;
  }
  const contactOf = (i: Identity | null) => (i ? (contactByKey.get(identityKey(i)) ?? null) : null);

  // 3) Enriquecimento: e-mail, empresa, parceiro e strikes (só o que está vazio); equipe.
  const teamKeys = new Set(oldProfiles.filter((p) => p.phone && TEAM_EMAIL.test(p.email)).map((p) => phoneKey(p.phone)));
  counts.equipe_telefones = teamKeys.size;
  if (!DRY) {
    let enriched = 0;
    for (const m of members) {
      const id = contactOf({ phone: digits(m.phone) || null, lid: digits(m.lid) || null });
      if (!id) continue;
      const { data: c } = await db.from("contacts").select("email, company_id, kind, strikes").eq("id", id).single();
      if (!c) continue;
      const patch: Record<string, unknown> = {};
      if (!c.email && m.email) patch.email = m.email.trim().toLowerCase();
      if (m.is_partner && c.kind === "customer") patch.kind = "partner";
      if ((m.strikes ?? 0) > (c.strikes ?? 0)) patch.strikes = m.strikes;
      if (!c.company_id && m.company_id) {
        const { data: co } = await db.from("companies").select("id").eq("external_id", m.company_id).maybeSingle();
        let companyId = (co?.id as string | undefined) ?? null;
        if (!companyId) {
          await db.from("companies").upsert({ name: m.company_name || m.company_id, external_id: m.company_id }, { onConflict: "external_id", ignoreDuplicates: true });
          const { data: again } = await db.from("companies").select("id").eq("external_id", m.company_id).maybeSingle();
          companyId = (again?.id as string | undefined) ?? null;
        }
        if (companyId) patch.company_id = companyId;
      }
      if (Object.keys(patch).length) {
        const { error } = await db.from("contacts").update(patch).eq("id", id);
        if (!error) enriched++;
      }
    }
    counts.contatos_enriquecidos = enriched;
    let team = 0;
    for (const part of chunk([...teamKeys], 100)) {
      const { data } = await db.from("contacts").update({ kind: "team" }).in("phone_key", part).neq("kind", "team").select("id");
      team += data?.length ?? 0;
    }
    counts.contatos_marcados_equipe = team;
  }
  const isTeam = (i: Identity | null) => !!i?.phone && teamKeys.has(phoneKey(i.phone));

  // 4) Quem fechou / respondeu → perfil do painel (nome normalizado).
  const { data: profiles } = await db.from("profiles").select("id, name");
  const profileByName = new Map((profiles ?? []).map((p) => [norm(p.name as string), p.id as string]));
  const authors: Record<string, string> = {};
  const profileOf = (name: string | null) => {
    if (!name) return null;
    const id = profileByName.get(norm(name)) ?? null;
    authors[name] = id ? ((profiles ?? []).find((p) => p.id === id)?.name as string) : "(sem perfil no painel)";
    return id;
  };

  // 5) Atendimentos → tickets (com classificação).
  const msgsByAtt = new Map<string, OldMessage[]>();
  for (const m of messages) if (m.attendance_id) (msgsByAtt.get(m.attendance_id) ?? msgsByAtt.set(m.attendance_id, []).get(m.attendance_id)!).push(m);
  const repliesByAtt = new Map<string, OldReply[]>();
  for (const r of replies) (repliesByAtt.get(r.attendance_id) ?? repliesByAtt.set(r.attendance_id, []).get(r.attendance_id)!).push(r);

  const ticketRows: Record<string, unknown>[] = [];
  const classifications = new Map<string, Classification & { owner: string[] }>();
  const helpersByAtt = new Map<string, Map<string, string>>(); // contato → primeira mensagem
  const categoryStats: Record<string, number> = {};
  for (const a of attendances) {
    const lead = identityOfNumber(a.lead_number);
    const contactId = DRY ? (lead ? "dry" : null) : contactOf(lead);
    if (!lead || !contactId) {
      inc(skipped, "atendimento sem lead");
      continue;
    }
    if (!a.group_id?.endsWith("@g.us")) {
      inc(skipped, "atendimento sem grupo");
      continue;
    }
    const msgs = (msgsByAtt.get(a.id) ?? []).sort((x, y) => x.created_at.localeCompare(y.created_at));
    const reps = (repliesByAtt.get(a.id) ?? []).filter((r) => !r.is_internal);
    const owner = msgs.filter((m) => {
      const i = identityOf(m);
      return i && sameIdentity(i, lead);
    });
    const others = msgs.filter((m) => !owner.includes(m) && m.type !== "reactionMessage");
    const teamMsgs = others.filter((m) => isTeam(identityOf(m)));
    const community = others.filter((m) => !teamMsgs.includes(m));
    const reason = closeReasonOf(a);
    const c = classify({
      finishedReason: a.finished_reason,
      ownerCategories: owner.map((m) => m.category),
      allCategories: msgs.map((m) => m.category),
      ownerText: owner.map((m) => m.content ?? "").join("\n"),
      allText: msgs.map((m) => m.content ?? "").join("\n"),
      communityReplied: community.length > 0,
      teamReplied: reps.length > 0 || teamMsgs.length > 0,
      resolved: reason === "resolved",
    });
    classifications.set(a.id, { ...c, owner: owner.slice(0, 3).map((m) => preview(m.content ?? `[${m.type}]`, 160)) });
    inc(categoryStats, `${c.category ?? "sem categoria"} · ${c.topic ?? "sem subcategoria"}`);

    if (!DRY) {
      const helpers = new Map<string, string>();
      for (const m of community) {
        const id = contactOf(identityOf(m));
        if (id && id !== contactId && !helpers.has(id)) helpers.set(id, m.created_at);
      }
      helpersByAtt.set(a.id, helpers);
    }

    const firstTeam = [...reps.map((r) => r.created_at), ...teamMsgs.map((m) => m.created_at)].filter((t) => t >= a.started_at).sort()[0] ?? null;
    const lastAt = [a.last_message_at, msgs.at(-1)?.created_at, reps.at(-1)?.created_at].filter(Boolean).sort().at(-1)!;
    const closer = a.status === "open" ? null : profileOf(a.finished_by);
    ticketRows.push({
      legacy_id: a.id,
      group_jid: a.group_id,
      contact_id: contactId,
      status: "closed",
      assignee_id: closer,
      subject: preview(a.title?.trim() || owner[0]?.content?.trim() || msgs[0]?.content?.trim() || "Atendimento importado", 280),
      opened_at: a.started_at,
      created_at: a.started_at,
      last_message_at: lastAt,
      first_response_at: firstTeam,
      category: c.category,
      topic: c.topic,
      resolved_by: c.resolvedBy,
      close_reason: reason,
      close_note: a.status === "open" ? "Aberto no sistema antigo; encerrado na importação." : a.finished_note?.trim() || null,
      closed_at: a.ended_at ?? lastAt,
      closed_by: closer,
      legacy: { source: "groups", finished_by: a.finished_by, finished_reason: a.finished_reason, title: a.title, status: a.status, avg_response_seconds: a.avg_response_seconds },
    });
  }
  counts.tickets_previstos = ticketRows.length;

  // Já importados (paginado: o PostgREST devolve no máximo 1.000 por vez).
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("tickets").select("legacy_id").not("legacy_id", "is", null).order("legacy_id").range(from, from + 999);
    data?.forEach((t) => existing.add(t.legacy_id as string));
    if ((data?.length ?? 0) < 1000) break;
  }
  const ticketByLegacy = new Map<string, string>();
  if (!DRY) {
    // Só os que faltam: tentar inserir um que já existe gasta um número da sequência (#) mesmo sem gravar.
    const missingTickets = ticketRows.filter((t) => !existing.has(t.legacy_id as string));
    log(`gravando ${missingTickets.length} atendimentos…`);
    for (const part of chunk(missingTickets, 200)) {
      const { error } = await db.from("tickets").upsert(part, { onConflict: "legacy_id", ignoreDuplicates: true });
      if (error) throw error;
    }
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from("tickets").select("id, legacy_id").not("legacy_id", "is", null).range(from, from + 999);
      data?.forEach((t) => ticketByLegacy.set(t.legacy_id as string, t.id as string));
      if ((data?.length ?? 0) < 1000) break;
    }
    counts.tickets_novos = ticketRows.filter((t) => !existing.has(t.legacy_id as string)).length;
  } else {
    counts.tickets_novos = ticketRows.filter((t) => !existing.has(t.legacy_id as string)).length;
  }

  // 6) Mensagens (texto e legendas) e respostas da equipe.
  const replyWaIds = new Set(replies.map((r) => r.wa_message_id?.trim()).filter(Boolean) as string[]);
  const attById = new Map(attendances.map((a) => [a.id, a]));
  const rows: Record<string, unknown>[] = [];
  for (const m of messages) {
    const b = bodyOf(m);
    if ("skip" in b) {
      inc(skipped, b.skip);
      continue;
    }
    const wa = waIdOf(m);
    if (replyWaIds.has(wa)) {
      inc(skipped, "eco de resposta do painel antigo (fica a versão com autor)");
      continue;
    }
    if (!m.group_id?.endsWith("@g.us")) {
      inc(skipped, "sem grupo");
      continue;
    }
    const ident = identityOf(m);
    rows.push({
      wa_id: wa,
      legacy_id: `m:${m.id}`,
      group_jid: m.group_id,
      ticket_id: m.attendance_id ? (ticketByLegacy.get(m.attendance_id) ?? null) : null,
      contact_id: DRY ? null : contactOf(ident),
      from_me: false,
      is_note: false,
      sender_name: m.name?.trim() || null,
      kind: "text",
      body: b.body,
      quoted_wa_id: m.quoted_message_id?.trim() || null,
      sent_at: m.created_at,
      created_at: m.created_at,
    });
    if (m.attendance_id) inc(counts, "mensagens_em_atendimento");
  }
  for (const r of replies) {
    const att = attById.get(r.attendance_id);
    const ticketId = DRY ? (att ? "dry" : null) : ticketByLegacy.get(r.attendance_id);
    if (!att || !ticketId) {
      inc(skipped, "resposta sem atendimento importado");
      continue;
    }
    if (!r.text?.trim()) {
      inc(skipped, "resposta sem texto (só mídia)");
      continue;
    }
    rows.push({
      wa_id: replyWaIdOf(r),
      legacy_id: `r:${r.id}`,
      group_jid: att.group_id,
      ticket_id: DRY ? null : ticketId,
      contact_id: null,
      author_id: profileOf(r.author),
      from_me: true,
      is_note: r.is_internal,
      sender_name: r.author?.trim() || null,
      kind: "text",
      body: r.text,
      status: r.is_internal ? null : (REPLY_STATUS[r.status ?? ""] ?? "sent"),
      sent_at: r.created_at,
      created_at: r.created_at,
    });
    inc(counts, r.is_internal ? "notas_internas" : "respostas_equipe");
  }
  counts.mensagens_previstas = rows.length;

  // Quantas já estão no painel (chegaram pelo webhook novo desde 15/10).
  let already = 0;
  for (const part of chunk(rows.map((r) => r.wa_id as string), 300)) {
    const { data } = await db.from("messages").select("wa_id").in("wa_id", part);
    already += data?.length ?? 0;
  }
  counts.mensagens_ja_no_painel = already;

  if (!DRY) {
    log(`gravando ${rows.length} mensagens…`);
    let inserted = 0;
    for (const [i, part] of chunk(rows, 500).entries()) {
      const { data, error } = await db.from("messages").upsert(part, { onConflict: "wa_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(`lote ${i}: ${error.message}`);
      inserted += data?.length ?? 0;
      if (i % 20 === 0) log(`  ${Math.min((i + 1) * 500, rows.length)}/${rows.length}`);
    }
    counts.mensagens_inseridas = inserted;

    // 7) Participantes e eventos dos tickets novos.
    const fresh = ticketRows.filter((t) => !existing.has(t.legacy_id as string));
    const participants: Record<string, unknown>[] = [];
    for (const t of fresh) {
      const ticketId = ticketByLegacy.get(t.legacy_id as string)!;
      for (const [contactId, joinedAt] of helpersByAtt.get(t.legacy_id as string) ?? []) participants.push({ ticket_id: ticketId, contact_id: contactId, joined_at: joinedAt });
    }
    for (const part of chunk(participants, 500)) {
      const { error } = await db.from("ticket_participants").upsert(part, { onConflict: "ticket_id,contact_id", ignoreDuplicates: true });
      if (error) throw error;
    }
    counts.participantes = participants.length;

    // Primeira mensagem de cada ticket novo: escolhida nas linhas importadas e buscada pelo wa_id
    // (uma linha exata por ticket; ler as mensagens por ticket passaria do limite de 1.000 do PostgREST).
    const firstWa = new Map<string, { wa: string; at: string }>();
    for (const r of rows) {
      const ticketId = r.ticket_id as string | null;
      if (!ticketId || r.is_note) continue;
      const cur = firstWa.get(ticketId);
      if (!cur || (r.sent_at as string) < cur.at) firstWa.set(ticketId, { wa: r.wa_id as string, at: r.sent_at as string });
    }
    const freshIds = new Set(fresh.map((t) => ticketByLegacy.get(t.legacy_id as string)!));
    const wanted = [...firstWa].filter(([ticketId]) => freshIds.has(ticketId));
    const firstMessage = new Map<string, string>();
    for (const part of chunk(wanted, 300)) {
      const { data } = await db.from("messages").select("id, wa_id").in("wa_id", part.map(([, v]) => v.wa));
      const idByWa = new Map((data ?? []).map((m) => [m.wa_id as string, m.id as string]));
      for (const [ticketId, v] of part) {
        const id = idByWa.get(v.wa);
        if (id) firstMessage.set(ticketId, id);
      }
    }
    const events = fresh.flatMap((t) => {
      const ticketId = ticketByLegacy.get(t.legacy_id as string)!;
      return [
        { ticket_id: ticketId, type: "opened", data: { message_id: firstMessage.get(ticketId) ?? null, legacy: true }, created_at: t.opened_at },
        {
          ticket_id: ticketId,
          type: "closed",
          actor_id: t.closed_by,
          data: { reason: t.close_reason, category: t.category, topic: t.topic, resolved_by: t.resolved_by, legacy: true, finished_by: (t.legacy as { finished_by: string | null }).finished_by },
          created_at: t.closed_at,
        },
      ];
    });
    for (const part of chunk(events, 500)) {
      const { error } = await db.from("ticket_events").insert(part);
      if (error) throw error;
    }
    counts.eventos = events.length;

    log("recalculando agregados…");
    const { data: agg, error } = await db.rpc("legacy_refresh_aggregates");
    if (error) throw error;
    counts.agregados = (agg as { tickets: number }).tickets;
  }

  // 8) Relatório de conferência.
  const report = { dry_run: DRY, gerado_em: new Date().toISOString(), contagens: counts, ignoradas: skipped, categorias: categoryStats, autores: authors };
  writeFileSync(new URL("relatorio.json", OUT), JSON.stringify(report, null, 2));
  const step = Math.max(1, Math.floor(attendances.length / 40));
  const sample = attendances.filter((_, i) => i % step === 0).slice(0, 40);
  const md = [
    `# Amostra da classificação (${sample.length} atendimentos)`,
    "",
    ...sample.map((a) => {
      const c = classifications.get(a.id);
      if (!c) return `- ${a.id}: não importado`;
      return [
        `## ${a.started_at.slice(0, 10)} · ${c.category ?? "sem categoria"} · ${c.topic ?? "sem subcategoria"} · quem resolveu: ${c.resolvedBy ?? "—"}`,
        `_base: ${c.basis}; motivo antigo: ${a.finished_reason ?? "—"}; fechou: ${a.finished_by ?? "—"}_`,
        ...c.owner.map((t) => `> ${t.replace(/\n/g, " ")}`),
        "",
      ].join("\n");
    }),
  ].join("\n");
  writeFileSync(new URL("amostra.md", OUT), md);
  log("pronto", JSON.stringify(counts));
  log("ignoradas", JSON.stringify(skipped));
  if (runId) await db.from("legacy_import_runs").update({ finished_at: new Date().toISOString(), counts: report }).eq("id", runId);
}

main().catch(async (e) => {
  console.error(e);
  if (runId) await db.from("legacy_import_runs").update({ finished_at: new Date().toISOString(), error: String(e?.message ?? e) }).eq("id", runId);
  process.exit(1);
});
