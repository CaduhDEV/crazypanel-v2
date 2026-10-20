import { createAdminClient } from "@/lib/supabase/admin";
import { periodDays, periodRange, type MetricsPeriod } from "@/lib/reports/period";

// Somente servidor. Dados do relatório das comunidades: calculados no banco
// (public.community_report), com as definições de docs/metricas/relatorio.md.

export interface ReportSummary {
  threads: number;
  respondidas: number;
  comunidade: number;
  equipe: number;
  ambos: number;
  declaradas: number;
  sem_resposta: number;
  sem_resposta_2h: number;
  abertas_sem_resposta: number;
  com_tecnico: number;
  sla_min: number;
  dentro_sla: number;
  mediana_membro_min: number | null;
  mediana_tecnico_min: number | null;
  p90_tecnico_min: number | null;
  fechadas: number;
  limpas: number;
  sem_categoria: number;
  sem_empresa: number;
  reabertas: number;
  ruido: number;
}

export interface CommunityReport {
  inicio: string;
  fim: string;
  gerado_em: string;
  resumo: ReportSummary;
  anterior: ReportSummary;
  grupos: { jid: string; nome: string | null; membros: number; ativos: number; resumo: ReportSummary }[];
  ajudantes: { nome: string | null; empresa: string | null; tipo: string; threads: number; respostas: number; resolvidas: number }[];
  concentracao: { ajudantes: number; respostas: number; pct_top5: number | null; hhi: number | null };
  tecnicos: { nome: string; assumidas: number; mensagens: number; fechadas: number; resolvidas: number; abertas_agora: number; mediana_min: number | null }[];
  empresas: { nome: string; tenant: string | null; threads: number; pessoas: number; com_tecnico: number }[];
  temas: { categoria: string | null; subtema: string | null; threads: number }[];
  /** dia: 1 = segunda … 7 = domingo; hora 0–23 (Brasília). */
  picos: { dia: number; hora: number; mensagens: number }[];
  movimento: { entradas: number; pelo_link: number; adicionados: number; convidados: number; saidas: number };
}

/** Período que termina agora (hora cheia) e volta `days` dias. */
export function reportPeriod(days: number, end = new Date()): { inicio: Date; fim: Date } {
  const fim = new Date(end);
  fim.setMinutes(0, 0, 0);
  return { inicio: new Date(fim.getTime() - days * 86_400_000), fim };
}

export async function loadCommunityReport(inicio: Date, fim: Date): Promise<CommunityReport> {
  const { data, error } = await createAdminClient().rpc("community_report", {
    p_inicio: inicio.toISOString(),
    p_fim: fim.toISOString(),
  });
  if (error) throw new Error(`Não foi possível calcular o relatório: ${error.message}`);
  return data as CommunityReport;
}

// --- Indicadores derivados (mesma conta no painel e no PDF) --------------------

export const pct = (part: number, total: number): number | null => (total > 0 ? Math.round((1000 * part) / total) / 10 : null);

export function indicators(s: ReportSummary) {
  return {
    comunidade: pct(s.comunidade, s.respondidas),
    comTecnico: pct(s.com_tecnico, s.threads),
    semResposta: pct(s.sem_resposta, s.threads),
    sla: pct(s.dentro_sla, s.com_tecnico),
    ruido: pct(s.ruido, s.threads),
    semCategoria: pct(s.sem_categoria, s.fechadas - s.limpas),
    semEmpresa: pct(s.sem_empresa, s.threads),
    reabertas: pct(s.reabertas, s.fechadas),
  };
}

// --- Ao vivo (página /metricas e telão) ----------------------------------------

export interface LiveReport {
  serie: { dia: string; threads: number; comunidade: number; equipe: number; sem_resposta: number; mediana_tecnico_min: number | null }[];
  hoje: { hora: number; threads: number; mensagens: number }[];
  fila: { abertas: number; aguardando: number; sem_responsavel: number; estouradas: number; espera_max_min: number | null };
  top_comunidade: { id: string; nome: string | null; avatar_url: string | null; empresa: string | null; tipo: string; threads: number; respostas: number; resolvidas: number }[];
  top_equipe: { id: string; nome: string; avatar_url: string | null; assumidas: number; resolvidas: number; respondidas: number; dentro_sla: number; mediana_min: number | null }[];
  resolucao: { comunidade: number; equipe: number; ambos: number; sem_resposta: number };
  categorias: { categoria: string; subcategoria: string | null; threads: number }[];
}

export interface MetricsPayload {
  /** Quantos dias o período cobre. */
  days: number;
  period: MetricsPeriod;
  report: CommunityReport;
  live: LiveReport;
}

export async function loadMetrics(period: MetricsPeriod): Promise<MetricsPayload> {
  const { inicio, fim } = periodRange(period);
  const days = periodDays(period);
  const db = createAdminClient();
  const [report, live] = await Promise.all([
    loadCommunityReport(inicio, fim),
    db.rpc("community_report_live", { p_inicio: inicio.toISOString(), p_fim: fim.toISOString() }).then(({ data, error }) => {
      if (error) throw new Error(`Não foi possível calcular as métricas ao vivo: ${error.message}`);
      return data as LiveReport;
    }),
  ]);
  return { days, period, report, live };
}
