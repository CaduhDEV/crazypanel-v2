// Classificação por regras dos atendimentos antigos no modelo novo
// (categoria · subcategoria · quem resolveu). Sem IA: categoria antiga como
// base e palavras-chave para a subcategoria; o que não der fica sem.

import { norm } from "./map.ts";

export type Category = "duvida" | "tecnico" | "comercial" | "comunidade";
export type Topic =
  | "funil" | "disparos" | "whatsapp" | "integracoes"
  | "envio" | "instancia" | "tela"
  | "upgrade" | "pagamento" | "cancelamento"
  | "sugestao" | "elogio" | "offtopic";

type Vote = "duvida" | "reclamacao" | "sugestao" | "elogio" | "offtopic";

/** Categoria antiga (por mensagem) → voto. Respostas e Contexto não decidem. */
const OLD_CATEGORY: Record<string, Vote> = {
  "duvidas basicas": "duvida",
  "duvidas avancadas": "duvida",
  "duvidas meta": "duvida",
  reclamacoes: "reclamacao",
  desabafo: "reclamacao",
  "feedback construtivo": "sugestao",
  elogio: "elogio",
  agradecimento: "elogio",
  "assuntos paralelos": "offtopic",
  divulgacao: "offtopic",
};
const VOTE_ORDER: Vote[] = ["duvida", "reclamacao", "sugestao", "elogio", "offtopic"];

// Palavras-chave (texto sem acento e minúsculo), em ordem de desempate.
const TOPIC_RULES: Record<"duvida" | "tecnico" | "comercial", [Topic, RegExp][]> = {
  duvida: [
    ["funil", /\b(funil|funis|pipelines?|etapas?|kanban|negocios?|cards?|colunas?|atividades?|tarefas?|vendedor\w*|responsave\w*)\b/g],
    ["disparos", /\b(disparos?|disparar|campanhas?|automac\w*|automatiz\w*|gatilhos?|reguas?|fluxos?|chatbot|bot|sequencias?|follow ?up|agendad\w*)\b/g],
    ["whatsapp", /\b(whats\w*|wpp|zap|qr ?code|qr|instancias?|uazapi|evolution|api oficial|api nao oficial|coex|cloud|conex(ao|oes)|restri\w*|banid\w*|banimento|templates?|janela de 24|numeros?|chip)\b/g],
    ["integracoes", /\b(integra\w*|meta ads|facebook|instagram|webhooks?|api|zapier|n8n|make|pixel|formularios?|rd station|hotmart|kiwify|google|planilha)\b/g],
  ],
  tecnico: [
    ["envio", /\b(nao (esta |estao )?(envia\w*|chega\w*|dispara\w*|recebe\w*|sai\w*)|falha (no|de|ao) envi\w*|nao (foi|foram) enviad\w*|recebimento|mensagens? (nao|travad\w*|pendentes?))\b/g],
    ["instancia", /\b(desconect\w*|caiu|cai(ndo)?|queda|sessao|instancias?|reconect\w*|qr ?code|offline|deslog\w*|instabil\w*|instave\w*|cair|fora do ar|conex(ao|oes)|coex|evolution|banid\w*|banimento|restri\w*|funcionando)\b/g],
    ["tela", /\b(erro|erros|tela|lent\w*|carregand\w*|travad\w*|trav(a|ou|ando)|bug\w*|nao (abre|carrega)|pagina|branca|500|404)\b/g],
  ],
  comercial: [
    ["upgrade", /\b(upgrade|planos?|starter|limites?|aumentar|contrat\w*|pacotes?|mais usuarios|mais disparos)\b/g],
    ["pagamento", /\b(faturas?|boletos?|pagamentos?|pagar|pago|pix|cartao|cobranc\w*|cobrad\w*|nota fiscal|nf|vencimento|reembolso|comiss\w*|assinatura|mensalidade)\b/g],
    ["cancelamento", /\b(cancel\w*|renova\w*|contrato|encerrar|desistir|multa)\b/g],
  ],
};

const COMMERCIAL = /\b(planos?|starter|faturas?|boletos?|pagamentos?|pix|cartao|cobranc\w*|cancelar|cancelamento|renova\w*|contrato|upgrade|reembolso|nota fiscal|comiss\w*|mensalidade)\b/;
/** Queda, instabilidade, conexão caindo: problema técnico, mesmo perguntado como dúvida. */
const OUTAGE = /\b(instabil\w*|instave\w*|caindo|caiu|cair|sair (a )?conexao|derrub\w*|fora do ar|desconect\w*|queda|banid\w*|banimento|restringid\w*|bloquead\w*|nao (esta|ta|tao|estao) funcionando|(esta|ta) funcionando\?|lentidao|travando)\b/;

function bestTopic(category: "duvida" | "tecnico" | "comercial", text: string): Topic | null {
  let best: Topic | null = null;
  let score = 0;
  for (const [topic, re] of TOPIC_RULES[category]) {
    const n = text.match(re)?.length ?? 0;
    if (n > score) {
      best = topic;
      score = n;
    }
  }
  return best;
}

export interface ClassifyInput {
  finishedReason: string | null;
  /** Categorias antigas das mensagens do autor da dúvida. */
  ownerCategories: (string | null)[];
  /** Categorias antigas de todas as mensagens do atendimento (desempate). */
  allCategories: (string | null)[];
  ownerText: string;
  allText: string;
  communityReplied: boolean;
  teamReplied: boolean;
  resolved: boolean;
}

export interface Classification {
  category: Category | null;
  topic: Topic | null;
  resolvedBy: "community" | "team" | "both" | null;
  /** Como a categoria foi decidida (vai para o relatório de conferência). */
  basis: string;
}

function vote(categories: (string | null)[]): Vote | null {
  const counts = new Map<Vote, number>();
  for (const c of categories) {
    const v = OLD_CATEGORY[norm(c)];
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: Vote | null = null;
  for (const v of VOTE_ORDER) if ((counts.get(v) ?? 0) > (best ? counts.get(best)! : 0)) best = v;
  return best;
}

export function classify(i: ClassifyInput): Classification {
  const ownerText = norm(i.ownerText);
  const allText = norm(i.allText);
  const resolvedBy = !i.resolved ? null : i.communityReplied && i.teamReplied ? "both" : i.communityReplied ? "community" : i.teamReplied ? "team" : null;
  const text = ownerText || allText;
  const v = vote(i.ownerCategories) ?? vote(i.allCategories);
  const out = (category: Category | null, topic: Topic | null, basis: string): Classification => ({ category, topic, resolvedBy, basis });

  // Sugestão é explícita na categoria antiga.
  if (v === "sugestao") return out("comunidade", "sugestao", "categoria antiga");
  // Queda e instabilidade: técnico (instância), mesmo perguntado como dúvida.
  if (text && OUTAGE.test(text)) return out("tecnico", bestTopic("tecnico", text) ?? "instancia", "queda/instabilidade");
  // Plano, cobrança, comissão: comercial.
  if (text && COMMERCIAL.test(text) && (v === "duvida" || v === "reclamacao" || !v)) return out("comercial", bestTopic("comercial", text), "palavras de comercial");
  if (v === "duvida") return out("duvida", bestTopic("duvida", text), "categoria antiga");
  if (v === "reclamacao") return out("tecnico", bestTopic("tecnico", text), "reclamação");
  // Pergunta com termo do produto vale mais que "paralelo/elogio" da categoria antiga (marcada por mensagem).
  const asked = /\?/.test(i.ownerText) ? bestTopic("duvida", ownerText) : null;
  if ((v === "offtopic" || v === "elogio") && asked) return out("duvida", asked, "pergunta sobre o produto");
  if (v === "elogio") return out("comunidade", "elogio", "categoria antiga");
  if (v === "offtopic") return out("comunidade", "offtopic", "categoria antiga");

  // Sem categoria antiga: palavras-chave; "assunto paralelo" sem sinal é off-topic.
  const duvida = text ? bestTopic("duvida", text) : null;
  if (duvida) return out("duvida", duvida, "palavras-chave");
  const tecnico = text ? bestTopic("tecnico", text) : null;
  if (tecnico) return out("tecnico", tecnico, "palavras-chave");
  if (i.finishedReason === "parallel") return out("comunidade", "offtopic", "assunto paralelo");
  return out(null, null, text ? "sem sinal" : "sem texto");
}

/**
 * Uma mensagem fora de atendimento. "Respostas" e "Contexto" (categoria antiga)
 * dizem o papel na conversa, não o assunto: herdam o da mensagem citada ou da
 * conversa ("inherit"). Sem sinal, null.
 */
export function classifyMessage(oldCategory: string | null, text: string): { category: Category; topic: Topic | null } | "inherit" | null {
  const old = norm(oldCategory);
  if (old === "respostas" || old === "contexto") return "inherit";
  const c = classify({
    finishedReason: null,
    ownerCategories: [oldCategory],
    allCategories: [],
    ownerText: text,
    allText: "",
    communityReplied: false,
    teamReplied: false,
    resolved: false,
  });
  return c.category ? { category: c.category, topic: c.topic } : null;
}
