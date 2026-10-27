import { createAdminClient } from "@/lib/supabase/admin";
import { getTaxonomy } from "@/lib/taxonomy-server";
import { categoryLabel, classificationLabel } from "@/lib/taxonomy";

// Somente servidor. Leitura do cérebro para o agente do CRM (ferramentas MCP
// consultar_cerebro e panorama_comunidade): respostas em português, curtas,
// com as datas e a frequência para o agente saber o quanto a informação é atual.

const DAY = 86_400_000;
/** Sem ser vista há mais que isso, a informação pode ter mudado. */
const STALE_DAYS = 120;

type SearchRow = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  topic: string | null;
  status: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  answer_changed_at: string;
  proposed_answer: string | null;
  proposed_at: string | null;
  score: number;
};

const day = (iso: string) => iso.slice(0, 10);

export async function searchBrain(input: { pergunta: string; categoria?: string | null; limite?: number }) {
  const db = createAdminClient();
  const taxonomy = await getTaxonomy();
  const { data, error } = await db.rpc("brain_search", {
    p_query: input.pergunta.slice(0, 500),
    p_category: input.categoria || null,
    p_limit: Math.min(10, Math.max(1, input.limite ?? 5)),
    p_include_drafts: true,
  });
  if (error) throw error;
  const rows = (data ?? []) as SearchRow[];
  const now = Date.now();
  return {
    pergunta: input.pergunta,
    encontrados: rows.length,
    itens: rows.map((r) => {
      const idle = Math.floor((now - Date.parse(r.last_seen_at)) / DAY);
      // Resposta mais nova vista depois da atual: ela é a informação de agora.
      const newer = r.proposed_answer && r.proposed_at && Date.parse(r.proposed_at) > Date.parse(r.answer_changed_at);
      return {
        pergunta: r.question,
        resposta: newer ? r.proposed_answer : r.answer,
        ...(newer ? { resposta_anterior: r.answer, resposta_mudou_em: day(r.proposed_at!) } : {}),
        assunto: classificationLabel(taxonomy, r.category, r.topic) ?? categoryLabel(taxonomy, r.category) ?? null,
        revisado_pela_equipe: r.status === "approved" && !newer,
        vezes_que_apareceu: r.occurrences,
        primeira_vez: day(r.first_seen_at),
        ultima_vez: day(r.last_seen_at),
        resposta_atualizada_em: day(newer ? r.proposed_at! : r.answer_changed_at),
        atualidade: idle > STALE_DAYS ? `não aparece há ${idle} dias: pode estar desatualizada` : "recente",
      };
    }),
    como_ler:
      "Itens ordenados por relevância, frequência e recência. Prefira a resposta mais recente e a mais frequente; avise quando o item não foi revisado pela equipe ou pode estar desatualizado.",
  };
}

export async function brainPanorama(days: number) {
  const db = createAdminClient();
  const taxonomy = await getTaxonomy();
  const sinceIso = new Date(Date.now() - days * DAY).toISOString();

  const [tickets, sources, helpers, flags, changed] = await Promise.all([
    db.from("tickets").select("status, close_reason, category, topic, resolved_by").gte("opened_at", sinceIso).limit(5000),
    db.from("brain_sources").select("item_id").gte("seen_at", sinceIso).limit(5000),
    db
      .from("tickets")
      .select("resolution_message_id, msg:messages!tickets_resolution_message_id_fkey(contact_id, contact:contacts!contact_id(name, kind))")
      .gte("closed_at", sinceIso)
      .in("resolved_by", ["community", "both"])
      .not("resolution_message_id", "is", null)
      .limit(2000),
    db.from("moderation_events").select("by_ai, rule").eq("type", "flag_added").is("reverted_at", null).gte("created_at", sinceIso).limit(5000),
    db
      .from("brain_items")
      .select("question, answer_changed_at, proposed_at, first_seen_at")
      .neq("status", "archived")
      .or(`answer_changed_at.gte.${sinceIso},proposed_at.gte.${sinceIso}`)
      .limit(50),
  ]);

  const count = <T,>(list: T[], key: (x: T) => string | null) => {
    const m = new Map<string, number>();
    for (const x of list) {
      const k = key(x);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const t = (tickets.data ?? []) as { status: string; close_reason: string | null; category: string | null; topic: string | null; resolved_by: string | null }[];
  const resolved = t.filter((x) => x.close_reason === "resolved");

  const topItems = count((sources.data ?? []) as { item_id: string }[], (s) => s.item_id).slice(0, 8);
  const { data: items } = topItems.length
    ? await db.from("brain_items").select("id, question").in("id", topItems.map(([id]) => id))
    : { data: [] };
  const questionOf = new Map(((items ?? []) as { id: string; question: string }[]).map((i) => [i.id, i.question]));

  type HelperRow = { msg: { contact_id: string | null; contact: { name: string | null; kind: string } | null } | null };
  const helperRows = ((helpers.data ?? []) as unknown as HelperRow[]).filter((h) => h.msg?.contact && h.msg.contact.kind !== "team");
  const f = (flags.data ?? []) as { by_ai: boolean; rule: string | null }[];

  return {
    periodo_dias: days,
    desde: day(sinceIso),
    atendimentos: {
      abertos: t.length,
      resolvidos: resolved.length,
      resolvidos_pela_comunidade: resolved.filter((x) => x.resolved_by === "community" || x.resolved_by === "both").length,
      resolvidos_pela_equipe: resolved.filter((x) => x.resolved_by === "team").length,
      ainda_abertos: t.filter((x) => x.status === "open").length,
    },
    assuntos_em_alta: count(t, (x) => classificationLabel(taxonomy, x.category, x.topic) ?? categoryLabel(taxonomy, x.category))
      .slice(0, 8)
      .map(([assunto, vezes]) => ({ assunto, vezes })),
    duvidas_que_mais_se_repetem: topItems.map(([id, vezes]) => ({ pergunta: questionOf.get(id) ?? "?", vezes })).filter((x) => x.pergunta !== "?"),
    quem_mais_ajudou: count(helperRows, (h) => h.msg?.contact?.name ?? null)
      .slice(0, 5)
      .map(([nome, respostas]) => ({ nome, respostas_que_resolveram: respostas })),
    respostas_que_mudaram: ((changed.data ?? []) as { question: string; answer_changed_at: string; proposed_at: string | null; first_seen_at: string }[])
      .filter((i) => i.proposed_at || i.answer_changed_at !== i.first_seen_at)
      .slice(0, 8)
      .map((i) => ({ pergunta: i.question, mudou_em: day(i.proposed_at ?? i.answer_changed_at) })),
    moderacao: {
      flags: f.length,
      dadas_pela_ia: f.filter((x) => x.by_ai).length,
      regras_mais_violadas: count(f, (x) => x.rule)
        .slice(0, 4)
        .map(([regra, vezes]) => ({ regra, vezes })),
    },
  };
}
