import Link from "next/link";
import { AlertTriangle, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TICKET_CATEGORIES, TICKET_TOPICS } from "@/lib/types";
import { indicators, pct, type CommunityReport } from "@/lib/reports/data";
import { Button } from "@/components/ui/button";

const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fPct = (v: number | null) => (v === null ? "—" : `${nf1.format(v)}%`);
const fMin = (v: number | null) => (v === null ? "—" : v >= 120 ? `${nf1.format(v / 60)} h` : `${nf1.format(v)} min`);
const fInt = (v: number) => nf0.format(v);

const CATEGORY = Object.fromEntries(TICKET_CATEGORIES.map((c) => [c.value, c.label])) as Record<string, string>;
const TOPIC = Object.fromEntries(TICKET_TOPICS.map((t) => [t.value, t.label])) as Record<string, string>;
const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export function MetricsView({ report, days, periods, error }: { report: CommunityReport | null; days: number; periods: number[]; error: string | null }) {
  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Período">
          {periods.map((d) => (
            <Link
              key={d}
              href={`/metricas?dias=${d}`}
              role="tab"
              aria-selected={d === days}
              className={cn("rounded px-3 py-1 text-[13px]", d === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
            >
              {d} dias
            </Link>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Comparado com os {days} dias anteriores.</span>
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <a href={`/api/reports/pdf?dias=${days}`} target="_blank" rel="noopener">
            <FileDown /> Baixar PDF
          </a>
        </Button>
      </div>

      {error || !report ? (
        <p className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{error ?? "Sem dados."}</p>
      ) : (
        <Content report={report} />
      )}
    </main>
  );
}

function Content({ report }: { report: CommunityReport }) {
  const s = report.resumo;
  const p = report.anterior;
  const i = indicators(s);
  const pi = indicators(p);
  const k = report.concentracao;

  const kpis: { label: string; value: string; foot: string; cur: number | null; prev: number | null; better: "up" | "down"; unit: "p.p." | "min" }[] = [
    { label: "Resolvido pela comunidade", value: fPct(i.comunidade), foot: `${fInt(s.comunidade)} de ${fInt(s.respondidas)} respondidas`, cur: i.comunidade, prev: pi.comunidade, better: "up", unit: "p.p." },
    { label: "Sem nenhuma resposta", value: fPct(i.semResposta), foot: `${fInt(s.sem_resposta)} de ${fInt(s.threads)} · ${fInt(s.abertas_sem_resposta)} abertas agora`, cur: i.semResposta, prev: pi.semResposta, better: "down", unit: "p.p." },
    { label: "Com técnico", value: fPct(i.comTecnico), foot: `${fInt(s.com_tecnico)} de ${fInt(s.threads)} threads`, cur: i.comTecnico, prev: pi.comTecnico, better: "down", unit: "p.p." },
    { label: "1ª resposta da equipe", value: fMin(s.mediana_tecnico_min), foot: `mediana · p90 ${fMin(s.p90_tecnico_min)}`, cur: s.mediana_tecnico_min, prev: p.mediana_tecnico_min, better: "down", unit: "min" },
    { label: "Dentro do SLA", value: fPct(i.sla), foot: `SLA de ${fInt(s.sla_min)} min`, cur: i.sla, prev: pi.sla, better: "up", unit: "p.p." },
    { label: "1ª resposta de membro", value: fMin(s.mediana_membro_min), foot: "mediana", cur: s.mediana_membro_min, prev: p.mediana_membro_min, better: "down", unit: "min" },
  ];

  const themes = new Map<string, number>();
  for (const t of report.temas) {
    const label = t.subtema ? (TOPIC[t.subtema] ?? t.subtema) : t.categoria ? (CATEGORY[t.categoria] ?? t.categoria) : "Sem categoria";
    themes.set(label, (themes.get(label) ?? 0) + t.threads);
  }
  const themeRows = [...themes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const grid = new Map(report.picos.map((x) => [`${x.dia}-${x.hora}`, x.mensagens]));
  const maxCell = Math.max(1, ...report.picos.map((x) => x.mensagens));

  return (
    <>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((c) => {
          let delta = "sem base anterior";
          let tone = "text-muted-foreground";
          if (c.cur !== null && c.prev !== null) {
            const d = Math.round((c.cur - c.prev) * 10) / 10;
            if (d === 0) delta = "estável";
            else {
              tone = (c.better === "up" ? d > 0 : d < 0) ? "text-success" : "text-destructive";
              delta = `${d > 0 ? "+" : "−"}${nf1.format(Math.abs(d))} ${c.unit} vs. anterior`;
            }
          }
          return (
            <div key={c.label} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</span>
              <span className="text-2xl font-semibold tabular">{c.value}</span>
              <span className="text-xs text-muted-foreground">{c.foot}</span>
              <span className={cn("text-xs font-medium", tone)}>{delta}</span>
            </div>
          );
        })}
      </section>

      <Quality report={report} />

      <Card title="Por comunidade">
        <Table
          head={["Comunidade", "Membros", "Ativos", "Threads", "Pela comunidade", "Sem resposta", "Com técnico"]}
          rows={report.grupos.map((g) => {
            const gi = indicators(g.resumo);
            return [g.nome ?? g.jid, fInt(g.membros), fInt(g.ativos), fInt(g.resumo.threads), fPct(gi.comunidade), fPct(gi.semResposta), fPct(gi.comTecnico)];
          })}
        />
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Quem mais ajuda"
          description={
            k.ajudantes
              ? `${fInt(k.ajudantes)} ${k.ajudantes === 1 ? "pessoa ajudou" : "pessoas ajudaram"}; os 5 mais ativos deram ${fPct(k.pct_top5)} das respostas (HHI ${fInt(k.hhi ?? 0)}).`
              : "Ninguém respondeu dúvidas de outras pessoas no período."
          }
        >
          <Table
            head={["Membro", "Empresa", "Threads", "Respostas", "Resolvidas"]}
            rows={report.ajudantes.map((a) => [`${a.nome ?? "Sem nome"}${a.tipo === "partner" ? " · parceiro" : ""}`, a.empresa ?? "—", fInt(a.threads), fInt(a.respostas), fInt(a.resolvidas)])}
          />
        </Card>
        <Card title="Atuação da equipe" description="Só o que passa pelo CrazyPanel.">
          <Table
            head={["Técnico", "Assumidas", "Mensagens", "Finalizadas", "Em aberto", "1ª resposta"]}
            rows={report.tecnicos.map((t) => [t.nome, fInt(t.assumidas), fInt(t.mensagens), fInt(t.fechadas), fInt(t.abertas_agora), fMin(t.mediana_min)])}
          />
        </Card>
        <Card title="Empresas com mais dúvidas">
          <Table head={["Empresa", "Threads", "Pessoas", "Com técnico"]} rows={report.empresas.map((e) => [e.nome, fInt(e.threads), fInt(e.pessoas), fInt(e.com_tecnico)])} />
        </Card>
        <Card title="Temas" description="Categoria e assunto informados ao finalizar.">
          {themeRows.length ? (
            <ul className="flex flex-col gap-2">
              {themeRows.map(([label, n]) => (
                <li key={label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-[13px]">
                  <span className="truncate">{label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-primary-soft">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${(100 * n) / themeRows[0][1]}%` }} />
                  </span>
                  <span className="text-right tabular text-muted-foreground">{fInt(n)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Nenhuma thread finalizada com categoria no período.</p>
          )}
        </Card>
      </div>

      <Card title="Horários de pico" description="Mensagens de membros por dia e hora (Brasília).">
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[3px] text-[10.5px] text-muted-foreground">
            {DAYS.map((d, di) => (
              <div key={d} className="contents">
                <span className="self-center">{d}</span>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = grid.get(`${di + 1}-${h}`) ?? 0;
                  return (
                    <span
                      key={h}
                      title={`${d} ${h}h: ${v} mensagens`}
                      className={cn("h-5 rounded-sm", !v && "bg-muted")}
                      style={v ? { backgroundColor: "var(--primary)", opacity: 0.18 + 0.82 * (v / maxCell) } : undefined}
                    />
                  );
                })}
              </div>
            ))}
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 3 === 0 ? `${h}h` : ""}
              </span>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}

function Quality({ report }: { report: CommunityReport }) {
  const s = report.resumo;
  const i = indicators(s);
  const items: [string, number | null][] = [
    ["Respostas sem citação que viraram thread", i.ruido],
    ["Threads sem empresa vinculada", i.semEmpresa],
    ["Fechadas pela limpeza da fila", pct(s.limpas, s.fechadas)],
  ];
  const bad = items.filter(([, v]) => (v ?? 0) >= 5);
  if (!bad.length) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        Qualidade dos dados: {bad.map(([label, v]) => `${label.toLowerCase()} ${fPct(v)}`).join(" · ")}. Esses números distorcem as métricas de ajuda entre membros
        (meta: abaixo de 5%).
      </span>
    </div>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">Sem dados no período.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            {head.map((h, j) => (
              <th key={h} className={cn("px-2 py-1.5 font-semibold", j > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-border/60 last:border-0">
              {r.map((c, j) => (
                <td key={j} className={cn("px-2 py-1.5", j === 0 ? "max-w-[16rem] truncate font-medium" : "text-right tabular")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
