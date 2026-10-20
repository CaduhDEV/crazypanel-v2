import { jsPDF } from "jspdf";
import { categoryLabel, type Taxonomy } from "@/lib/taxonomy";
import { indicators, pct, type CommunityReport, type ReportSummary } from "@/lib/reports/data";

// Somente servidor. Relatório oficial das comunidades em PDF (A4, vetorial).

type RGB = [number, number, number];

const C = {
  navy: [19, 40, 74] as RGB,
  brand: [47, 98, 168] as RGB,
  brandSoft: [232, 239, 250] as RGB,
  ink: [28, 37, 51] as RGB,
  text: [55, 65, 81] as RGB,
  muted: [107, 114, 128] as RGB,
  line: [226, 231, 238] as RGB,
  zebra: [247, 249, 252] as RGB,
  good: [21, 128, 61] as RGB,
  bad: [185, 28, 28] as RGB,
  warn: [180, 83, 9] as RGB,
  white: [255, 255, 255] as RGB,
};

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16; // margem
const CONTENT_W = PAGE_W - 2 * M;
const BOTTOM = PAGE_H - 20; // acima do rodapé
const TZ = "America/Sao_Paulo";

// Logo DataCrazy (contorno do símbolo do app/icon.svg, caixa de 296 × 296).
const LOGO: [number, number][] = [
  [95.5657, 295.294], [81.3239, 266.381], [83.6986, 253.77], [216.273, 203.763], [29.6997, 163.986], [29.6997, 129.706],
  [37.5589, 119.97], [219.3, 63.0427], [0.647095, 42.1422], [0.647095, 9.22756], [8.53698, 0], [289.531, 33.3945],
  [295.941, 44.3661], [295.941, 73.7989], [91.0102, 142.341], [266.719, 178.411], [273.376, 188.488], [273.376, 215.648],
];

/** As fontes padrão do PDF só têm Latin-1: troca tipografia comum e tira emoji. */
function clean(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtPct = (v: number | null) => (v === null ? "-" : `${nf1.format(v)}%`);
const fmtMin = (v: number | null) => (v === null ? "-" : v >= 120 ? `${nf1.format(v / 60)} h` : `${nf1.format(v)} min`);
const fmtInt = (v: number) => nf0.format(v);
const threadsLabel = (n: number) => `${nf0.format(n)} ${n === 1 ? "thread" : "threads"}`;
const fmtDate = (iso: string, withTime = false) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(iso));


export interface ReportPdfOptions {
  /** Número oficial (ex.: "0007"); null = prévia. */
  number: string | null;
  /** Código impresso no rodapé para conferir a autenticidade. */
  verification: string;
  /** Nomes das categorias e subcategorias. */
  taxonomy: Taxonomy;
}

export function buildReportPdf(report: CommunityReport, opts: ReportPdfOptions): ArrayBuffer {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({
    title: `Relatório das Comunidades${opts.number ? ` nº ${opts.number}` : " (prévia)"}`,
    subject: "Métricas das comunidades DataCrazy no WhatsApp",
    author: "CrazyPanel - DataCrazy",
    creator: "CrazyPanel",
  });

  const period = `${fmtDate(report.inicio)} a ${fmtDate(new Date(new Date(report.fim).getTime() - 1).toISOString())}`;
  const days = Math.round((Date.parse(report.fim) - Date.parse(report.inicio)) / 86_400_000);
  let y = 0;

  // --- primitivas -------------------------------------------------------------
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, style: "normal" | "bold" = "normal", c: RGB = C.text) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    color(c);
  };
  const text = (s: string, x: number, yy: number, o?: { align?: "left" | "right" | "center"; maxWidth?: number }) =>
    doc.text(clean(s), x, yy, { baseline: "alphabetic", ...o });
  const fit = (s: string, w: number) => {
    let out = clean(s);
    if (doc.getTextWidth(out) <= w) return out;
    while (out.length > 1 && doc.getTextWidth(`${out}...`) > w) out = out.slice(0, -1);
    return `${out.trimEnd()}...`;
  };

  const logo = (x: number, yy: number, size: number, box: RGB, mark: RGB) => {
    fill(box);
    doc.roundedRect(x, yy, size, size, size * 0.25, size * 0.25, "F");
    const s = (size * 0.52) / 296;
    const ox = x + size * 0.24;
    const oy = yy + size * 0.24;
    const deltas = LOGO.slice(1).map((p, i) => [(p[0] - LOGO[i][0]) * s, (p[1] - LOGO[i][1]) * s]);
    fill(mark);
    doc.lines(deltas, ox + LOGO[0][0] * s, oy + LOGO[0][1] * s, [1, 1], "F", true);
  };

  const footer = () => {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      stroke(C.line);
      doc.setLineWidth(0.3);
      doc.line(M, PAGE_H - 13, PAGE_W - M, PAGE_H - 13);
      font(7.5, "normal", C.muted);
      text(`CrazyPanel · Relatório das Comunidades ${opts.number ? `nº ${opts.number}` : "(prévia)"}`, M, PAGE_H - 8.5);
      text(`Código de verificação ${opts.verification}`, PAGE_W / 2, PAGE_H - 8.5, { align: "center" });
      text(`Página ${i} de ${pages}`, PAGE_W - M, PAGE_H - 8.5, { align: "right" });
    }
  };

  const runningHeader = () => {
    fill(C.navy);
    doc.rect(0, 0, PAGE_W, 14, "F");
    fill(C.brand);
    doc.rect(0, 14, PAGE_W, 0.8, "F");
    logo(M, 3.5, 7, C.brand, C.white);
    font(9, "bold", C.white);
    text("Relatório das Comunidades", M + 10, 8.6);
    font(8, "normal", [200, 212, 232]);
    text(`${opts.number ? `Nº ${opts.number} · ` : ""}${period}`, PAGE_W - M, 8.6, { align: "right" });
    y = 24;
  };

  const ensure = (h: number) => {
    if (y + h <= BOTTOM) return;
    doc.addPage();
    runningHeader();
  };

  const section = (title: string, subtitle?: string) => {
    ensure(subtitle ? 22 : 16);
    fill(C.brand);
    doc.rect(M, y - 4.2, 1.2, 5.4, "F");
    font(12.5, "bold", C.ink);
    text(title, M + 4, y);
    y += 5;
    if (subtitle) {
      font(8.5, "normal", C.muted);
      const lines = doc.splitTextToSize(clean(subtitle), CONTENT_W - 4) as string[];
      doc.text(lines, M + 4, y);
      y += lines.length * 3.8;
    }
    y += 3;
  };

  interface Col {
    title: string;
    w: number;
    align?: "left" | "right" | "center";
  }
  const table = (cols: Col[], rows: string[][], empty = "Sem dados no período.") => {
    const rowH = 7;
    const header = () => {
      fill(C.brandSoft);
      doc.rect(M, y, CONTENT_W, rowH, "F");
      let x = M;
      for (const c of cols) {
        const tx = c.align === "right" ? x + c.w - 2.5 : c.align === "center" ? x + c.w / 2 : x + 2.5;
        let size = 7.6;
        font(size, "bold", C.navy);
        while (size > 5.8 && doc.getTextWidth(clean(c.title.toUpperCase())) > c.w - 4) font((size -= 0.2), "bold", C.navy);
        text(fit(c.title.toUpperCase(), c.w - 4), tx, y + 4.6, { align: c.align ?? "left" });
        x += c.w;
      }
      y += rowH;
    };
    ensure(rowH * 2 + 2);
    header();
    if (!rows.length) {
      font(8.5, "normal", C.muted);
      text(empty, M + 2.5, y + 5);
      y += rowH + 4;
      return;
    }
    rows.forEach((r, i) => {
      if (y + rowH > BOTTOM) {
        doc.addPage();
        runningHeader();
        header();
      }
      if (i % 2 === 1) {
        fill(C.zebra);
        doc.rect(M, y, CONTENT_W, rowH, "F");
      }
      font(8.4, "normal", C.text);
      let x = M;
      cols.forEach((c, j) => {
        const v = fit(r[j] ?? "", c.w - 5);
        const tx = c.align === "right" ? x + c.w - 2.5 : c.align === "center" ? x + c.w / 2 : x + 2.5;
        if (j === 0) doc.setFont("helvetica", "bold");
        text(v, tx, y + 4.7, { align: c.align ?? "left" });
        if (j === 0) doc.setFont("helvetica", "normal");
        x += c.w;
      });
      y += rowH;
    });
    stroke(C.line);
    doc.setLineWidth(0.3);
    doc.line(M, y, PAGE_W - M, y);
    y += 6;
  };

  const paragraph = (s: string, size = 9.2, c: RGB = C.text) => {
    font(size, "normal", c);
    const lines = doc.splitTextToSize(clean(s), CONTENT_W) as string[];
    ensure(lines.length * size * 0.45 + 2);
    doc.text(lines, M, y);
    y += lines.length * size * 0.45 + 1.5;
  };

  // --- capa -------------------------------------------------------------------
  const now = report.gerado_em;
  fill(C.navy);
  doc.rect(0, 0, PAGE_W, 62, "F");
  fill(C.brand);
  doc.rect(0, 62, PAGE_W, 1.4, "F");
  logo(M, 13, 13, C.brand, C.white);
  font(13, "bold", C.white);
  text("DataCrazy", M + 16, 18.4);
  font(8, "normal", [190, 204, 228]);
  text("Comunidades no WhatsApp · CrazyPanel", M + 16, 23.2);

  font(7.5, "bold", [170, 190, 222]);
  text(opts.number ? "DOCUMENTO OFICIAL" : "PRÉVIA · SEM VALIDADE OFICIAL", PAGE_W - M, 16.5, { align: "right" });
  font(opts.number ? 20 : 13, "bold", C.white);
  text(opts.number ? `Nº ${opts.number}` : "Prévia", PAGE_W - M, 25, { align: "right" });

  font(23, "bold", C.white);
  text("Relatório das Comunidades", M, 43);
  font(10.5, "normal", [214, 224, 240]);
  text(`Período de ${period} (${days} ${days === 1 ? "dia" : "dias"})`, M, 51);

  // Linha de dados da emissão.
  y = 72;
  const meta: [string, string][] = [
    ["Emitido em", fmtDate(now, true)],
    ["Comunidades", fmtInt(report.grupos.length)],
    ["Threads no período", fmtInt(report.resumo.threads)],
    ["Membros nos grupos", fmtInt(report.grupos.reduce((a, g) => a + g.membros, 0))],
  ];
  const mw = CONTENT_W / meta.length;
  meta.forEach(([k, v], i) => {
    const x = M + i * mw;
    font(7.2, "bold", C.muted);
    text(k.toUpperCase(), x, y);
    font(11, "bold", C.ink);
    text(v, x, y + 5.5);
  });
  y += 11;
  stroke(C.line);
  doc.setLineWidth(0.3);
  doc.line(M, y, PAGE_W - M, y);
  y += 9;

  // --- resumo executivo ---------------------------------------------------------
  const s = report.resumo;
  const p = report.anterior;
  const ind = indicators(s);
  const prev = indicators(p);

  section("Resumo executivo");
  const bullets: string[] = [];
  if (!s.threads) bullets.push("Nenhuma dúvida foi registrada nas comunidades neste período.");
  else {
    if (s.respondidas)
      bullets.push(`A comunidade resolveu ${fmtPct(ind.comunidade)} das dúvidas respondidas sem precisar da equipe (${fmtInt(s.comunidade)} de ${fmtInt(s.respondidas)}).`);
    bullets.push(
      `${fmtPct(ind.semResposta)} das threads (${fmtInt(s.sem_resposta)} de ${fmtInt(s.threads)}) não tiveram nenhuma resposta${s.abertas_sem_resposta ? `; ${fmtInt(s.abertas_sem_resposta)} seguem abertas sem resposta` : ""}.`,
    );
    if (s.com_tecnico)
      bullets.push(
        `A equipe entrou em ${fmtPct(ind.comTecnico)} das threads, com primeira resposta em mediana de ${fmtMin(s.mediana_tecnico_min)} e ${fmtPct(ind.sla)} dentro do SLA de ${fmtInt(s.sla_min)} min.`,
      );
    const k = report.concentracao;
    if (k.ajudantes)
      bullets.push(
        `${fmtInt(k.ajudantes)} ${k.ajudantes === 1 ? "pessoa ajudou" : "pessoas ajudaram"} outros membros; os 5 mais ativos deram ${fmtPct(k.pct_top5)} das respostas.`,
      );
    if ((ind.ruido ?? 0) >= 10)
      bullets.push(`${fmtPct(ind.ruido)} das threads parecem respostas sem citação que viraram atendimento separado: os números de ajuda entre membros estão subestimados.`);
  }
  for (const b of bullets) {
    font(9.4, "normal", C.text);
    const lines = doc.splitTextToSize(clean(b), CONTENT_W - 6) as string[];
    ensure(lines.length * 4.4 + 2);
    fill(C.brand);
    doc.circle(M + 1.2, y - 1.1, 0.8, "F");
    doc.text(lines, M + 5, y);
    y += lines.length * 4.4 + 1.8;
  }
  y += 4;

  // --- indicadores --------------------------------------------------------------
  section("Indicadores principais", "Comparação com o período anterior de mesma duração. Verde é melhora, vermelho é piora.");
  type Card = { label: string; value: string; foot: string; cur: number | null; prev: number | null; better: "up" | "down"; unit: "pp" | "min" };
  const cards: Card[] = [
    { label: "Resolvido pela comunidade", value: fmtPct(ind.comunidade), foot: `${fmtInt(s.comunidade)} de ${fmtInt(s.respondidas)} respondidas`, cur: ind.comunidade, prev: prev.comunidade, better: "up", unit: "pp" },
    { label: "Threads sem resposta", value: fmtPct(ind.semResposta), foot: `${fmtInt(s.sem_resposta)} de ${fmtInt(s.threads)} threads`, cur: ind.semResposta, prev: prev.semResposta, better: "down", unit: "pp" },
    { label: "Threads com técnico", value: fmtPct(ind.comTecnico), foot: `${fmtInt(s.com_tecnico)} de ${fmtInt(s.threads)} threads`, cur: ind.comTecnico, prev: prev.comTecnico, better: "down", unit: "pp" },
    { label: "1ª resposta da equipe", value: fmtMin(s.mediana_tecnico_min), foot: `mediana · p90 ${fmtMin(s.p90_tecnico_min)}`, cur: s.mediana_tecnico_min, prev: p.mediana_tecnico_min, better: "down", unit: "min" },
    { label: "Dentro do SLA", value: fmtPct(ind.sla), foot: `SLA de ${fmtInt(s.sla_min)} min`, cur: ind.sla, prev: prev.sla, better: "up", unit: "pp" },
    { label: "1ª resposta de membro", value: fmtMin(s.mediana_membro_min), foot: "mediana", cur: s.mediana_membro_min, prev: p.mediana_membro_min, better: "down", unit: "min" },
  ];
  const gap = 4;
  const cw = (CONTENT_W - 2 * gap) / 3;
  const ch = 27;
  ensure(ch * 2 + gap + 4);
  cards.forEach((card, i) => {
    const x = M + (i % 3) * (cw + gap);
    const top = y + Math.floor(i / 3) * (ch + gap);
    fill(C.white);
    stroke(C.line);
    doc.setLineWidth(0.35);
    doc.roundedRect(x, top, cw, ch, 2, 2, "FD");
    fill(C.brand);
    doc.rect(x, top + 3, 0.9, ch - 6, "F");
    font(7.4, "bold", C.muted);
    text(card.label.toUpperCase(), x + 4, top + 6.2);
    font(17, "bold", C.ink);
    text(card.value, x + 4, top + 15.2);
    font(7.6, "normal", C.muted);
    text(card.foot, x + 4, top + 20.2, { maxWidth: cw - 6 });
    // Variação
    let delta = "sem base anterior";
    let dc: RGB = C.muted;
    if (card.cur !== null && card.prev !== null) {
      const d = Math.round((card.cur - card.prev) * 10) / 10;
      if (d === 0) delta = "estável";
      else {
        const good = card.better === "up" ? d > 0 : d < 0;
        dc = good ? C.good : C.bad;
        delta = `${d > 0 ? "+" : "-"}${nf1.format(Math.abs(d))} ${card.unit === "pp" ? "p.p." : "min"} vs. anterior`;
      }
    }
    font(7.4, "bold", dc);
    text(delta, x + 4, top + 24.3);
  });
  y += ch * 2 + gap + 9;

  // --- por comunidade -------------------------------------------------------------
  section("Por comunidade", "Membros ativos: quem escreveu no grupo no período. Resolvido pela comunidade: sobre as threads respondidas.");
  table(
    [
      { title: "Comunidade", w: 52 },
      { title: "Membros", w: 18, align: "right" },
      { title: "Ativos", w: 16, align: "right" },
      { title: "Threads", w: 17, align: "right" },
      { title: "Pela comunidade", w: 27, align: "right" },
      { title: "Sem resposta", w: 24, align: "right" },
      { title: "Com técnico", w: 24, align: "right" },
    ],
    report.grupos.map((g) => {
      const gi = indicators(g.resumo);
      return [g.nome ?? g.jid, fmtInt(g.membros), fmtInt(g.ativos), fmtInt(g.resumo.threads), fmtPct(gi.comunidade), fmtPct(gi.semResposta), fmtPct(gi.comTecnico)];
    }),
  );

  // --- ajuda entre membros ----------------------------------------------------------
  section(
    "Quem mais ajuda",
    "Respostas em dúvidas de outras pessoas. Resolvidas: a resposta recebeu reação do autor da dúvida ou foi marcada como a que resolveu.",
  );
  table(
    [
      { title: "#", w: 9, align: "center" },
      { title: "Membro", w: 50 },
      { title: "Empresa", w: 46 },
      { title: "Perfil", w: 20 },
      { title: "Threads", w: 17, align: "right" },
      { title: "Respostas", w: 18, align: "right" },
      { title: "Resolvidas", w: 18, align: "right" },
    ],
    report.ajudantes.map((a, i) => [
      String(i + 1),
      a.nome ?? "Sem nome",
      a.empresa ?? "-",
      a.tipo === "partner" ? "Parceiro" : "Membro",
      fmtInt(a.threads),
      fmtInt(a.respostas),
      fmtInt(a.resolvidas),
    ]),
    "Nenhum membro respondeu dúvidas de outras pessoas no período.",
  );
  const k = report.concentracao;
  if (k.ajudantes) {
    const level = (k.hhi ?? 0) >= 2500 ? "alta" : (k.hhi ?? 0) >= 1500 ? "moderada" : "baixa";
    font(8.4, "normal", C.text);
    const lines = doc.splitTextToSize(
      clean(`Os 5 que mais respondem deram ${fmtPct(k.pct_top5)} das ${fmtInt(k.respostas)} respostas (índice HHI ${fmtInt(k.hhi ?? 0)} de 10.000). Quanto maior, mais a comunidade depende de poucas pessoas.`),
      CONTENT_W - 8,
    ) as string[];
    const boxH = 9 + lines.length * 3.9;
    ensure(boxH + 6);
    fill(C.brandSoft);
    doc.roundedRect(M, y - 2, CONTENT_W, boxH, 1.5, 1.5, "F");
    font(8.6, "bold", C.navy);
    text(`Concentração ${level}`, M + 4, y + 3);
    font(8.4, "normal", C.text);
    doc.text(lines, M + 4, y + 7.6);
    y += boxH + 7;
  }

  // --- equipe -------------------------------------------------------------------------
  section("Atuação da equipe", "Somente o trabalho feito pelo CrazyPanel. Finalizadas: resolvidas + assuntos paralelos.");
  table(
    [
      { title: "Técnico", w: 50 },
      { title: "Assumidas", w: 20, align: "right" },
      { title: "Mensagens", w: 21, align: "right" },
      { title: "Finalizadas", w: 22, align: "right" },
      { title: "Resolvidas", w: 21, align: "right" },
      { title: "Em aberto", w: 22, align: "right" },
      { title: "1ª resposta", w: 22, align: "right" },
    ],
    report.tecnicos.map((t) => [t.nome, fmtInt(t.assumidas), fmtInt(t.mensagens), fmtInt(t.fechadas), fmtInt(t.resolvidas), fmtInt(t.abertas_agora), fmtMin(t.mediana_min)]),
  );

  // --- empresas -----------------------------------------------------------------------
  section("Empresas com mais dúvidas", "Empresa principal de quem abriu a thread. Muitas dúvidas da mesma empresa indicam falha de implantação ou risco de cancelamento.");
  table(
    [
      { title: "Empresa", w: 82 },
      { title: "Threads", w: 24, align: "right" },
      { title: "Pessoas", w: 24, align: "right" },
      { title: "Com técnico", w: 24, align: "right" },
      { title: "Por pessoa", w: 24, align: "right" },
    ],
    report.empresas.map((e) => [e.nome, fmtInt(e.threads), fmtInt(e.pessoas), fmtInt(e.com_tecnico), nf1.format(e.threads / Math.max(1, e.pessoas))]),
    "Nenhuma thread de empresa vinculada no período.",
  );

  // --- temas --------------------------------------------------------------------------
  section("Temas", "Categoria e assunto informados ao finalizar. Temas recorrentes viram tutorial, mensagem fixada ou correção no produto.");
  const themes = new Map<string, number>();
  for (const t of report.temas) {
    const label = t.subtema
      ? (opts.taxonomy.topics.find((x) => x.key === t.subtema)?.label ?? t.subtema)
      : t.categoria
        ? (categoryLabel(opts.taxonomy, t.categoria) ?? t.categoria)
        : "Sem categoria";
    themes.set(label, (themes.get(label) ?? 0) + t.threads);
  }
  const themeRows = [...themes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!themeRows.length) {
    paragraph("Nenhuma thread finalizada com categoria no período.", 8.6, C.muted);
    y += 5;
  } else {
    const max = themeRows[0][1];
    const total = themeRows.reduce((a, [, n]) => a + n, 0);
    const labelW = 52;
    const barMax = CONTENT_W - labelW - 26;
    for (const [label, n] of themeRows) {
      ensure(7);
      font(8.4, "normal", C.text);
      text(fit(label, labelW - 3), M, y + 3.6);
      fill(C.brandSoft);
      doc.roundedRect(M + labelW, y, barMax, 4.6, 1, 1, "F");
      fill(C.brand);
      doc.roundedRect(M + labelW, y, Math.max(1.5, (barMax * n) / max), 4.6, 1, 1, "F");
      font(8.2, "bold", C.ink);
      text(`${fmtInt(n)} · ${fmtPct(pct(n, total))}`, PAGE_W - M, y + 3.6, { align: "right" });
      y += 7;
    }
    y += 5;
  }

  // --- horários -----------------------------------------------------------------------
  section("Horários de pico", "Mensagens de membros por dia da semana e hora (horário de Brasília). Ajuda a montar a escala da equipe.");
  const grid = new Map(report.picos.map((p) => [`${p.dia}-${p.hora}`, p.mensagens]));
  const maxCell = Math.max(1, ...report.picos.map((p) => p.mensagens));
  const labelW = 12;
  const cell = (CONTENT_W - labelW) / 24;
  ensure(7 * 5 + 12);
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  dias.forEach((d, i) => {
    const top = y + i * 5;
    font(7.4, "normal", C.muted);
    text(d, M, top + 3.6);
    for (let h = 0; h < 24; h++) {
      const v = grid.get(`${i + 1}-${h}`) ?? 0;
      const t = v ? 0.15 + 0.85 * (v / maxCell) : 0;
      const c: RGB = v ? [Math.round(232 + (47 - 232) * t), Math.round(239 + (98 - 239) * t), Math.round(250 + (168 - 250) * t)] : [246, 247, 249];
      fill(c);
      doc.rect(M + labelW + h * cell + 0.25, top, cell - 0.5, 4.4, "F");
    }
  });
  y += 7 * 5 + 1;
  font(6.8, "normal", C.muted);
  for (let h = 0; h < 24; h += 3) text(`${String(h).padStart(2, "0")}h`, M + labelW + h * cell + cell / 2, y + 2.6, { align: "center" });
  y += 9;
  const peak = [...report.picos].sort((a, b) => b.mensagens - a.mensagens)[0];
  if (peak) paragraph(`Pico: ${dias[peak.dia - 1]} às ${peak.hora}h, com ${fmtInt(peak.mensagens)} mensagens.`, 8.4, C.muted);
  y += 3;

  // --- movimento ----------------------------------------------------------------------
  section("Entradas e saídas", "Eventos dos grupos registrados pelo CrazyPanel.");
  const mv = report.movimento;
  const mvItems: [string, string][] = [
    ["Entradas", fmtInt(mv.entradas)],
    ["Pelo link", fmtInt(mv.pelo_link)],
    ["Adicionados", fmtInt(mv.adicionados)],
    ["Por convite", fmtInt(mv.convidados)],
    ["Saídas", fmtInt(mv.saidas)],
    ["Saldo", `${mv.entradas - mv.saidas >= 0 ? "+" : ""}${fmtInt(mv.entradas - mv.saidas)}`],
  ];
  ensure(14);
  const iw = CONTENT_W / mvItems.length;
  mvItems.forEach(([kk, v], i) => {
    font(7, "bold", C.muted);
    text(kk.toUpperCase(), M + i * iw, y);
    font(12, "bold", C.ink);
    text(v, M + i * iw, y + 5.8);
  });
  y += 14;

  // --- qualidade dos dados ------------------------------------------------------------
  section("Qualidade dos dados", "O quanto os números acima são confiáveis. Metas: abaixo de 5% em cada item.");
  const quality: [string, number | null, string][] = [
    ["Respostas sem citação que viraram thread", ind.ruido, threadsLabel(s.ruido)],
    ["Finalizadas sem categoria", ind.semCategoria, threadsLabel(s.sem_categoria)],
    ["Threads de quem não tem empresa vinculada", ind.semEmpresa, threadsLabel(s.sem_empresa)],
    ["Fechadas pela limpeza da fila (sem análise)", pct(s.limpas, s.fechadas), threadsLabel(s.limpas)],
    ["Threads reabertas", ind.reabertas, threadsLabel(s.reabertas)],
  ];
  for (const [label, v, foot] of quality) {
    ensure(7);
    const c = v === null ? C.muted : v < 5 ? C.good : v < 20 ? C.warn : C.bad;
    fill(c);
    doc.circle(M + 1.3, y + 1.9, 1.1, "F");
    font(8.6, "normal", C.text);
    text(label, M + 5, y + 3);
    font(8.6, "bold", c);
    text(fmtPct(v), PAGE_W - M - 26, y + 3, { align: "right" });
    font(8, "normal", C.muted);
    text(foot, PAGE_W - M, y + 3, { align: "right" });
    y += 6.5;
  }
  y += 5;

  // --- definições ---------------------------------------------------------------------
  section("Definições");
  const defs: [string, string][] = [
    ["Comunidade", "Grupos escutados pelo CrazyPanel, sem os grupos de parceiros e de teste."],
    ["Thread", "Dúvida aberta por um membro no grupo (atendimento). Threads mescladas não contam."],
    ["Resposta", "Mensagem na thread de alguém que não é o autor da dúvida: comunidade (membros e parceiros) ou equipe."],
    ["Resolvido pela comunidade", "Informado ao finalizar; sem essa informação, threads respondidas só pela comunidade."],
    ["Sem resposta", "Ninguém além do autor respondeu na thread."],
    ["1ª resposta da equipe", "Tempo entre a abertura da thread e a primeira resposta da equipe (mediana e percentil 90)."],
  ];
  for (const [term, def] of defs) {
    font(8.3, "normal", C.text);
    const lines = doc.splitTextToSize(clean(def), CONTENT_W - 46) as string[];
    ensure(lines.length * 3.9 + 2);
    font(8.3, "bold", C.ink);
    text(term, M, y);
    font(8.3, "normal", C.text);
    doc.text(lines, M + 46, y);
    y += lines.length * 3.9 + 2;
  }

  // --- encerramento -------------------------------------------------------------------
  ensure(26);
  y += 6;
  stroke(C.line);
  doc.line(M, y, PAGE_W - M, y);
  y += 7;
  logo(M, y - 4.5, 9, C.navy, C.white);
  font(9, "bold", C.ink);
  text("Equipe de Comunidades DataCrazy", M + 12, y);
  font(7.8, "normal", C.muted);
  text(
    `Documento gerado automaticamente pelo CrazyPanel em ${fmtDate(now, true)}. Código de verificação ${opts.verification}.`,
    M + 12,
    y + 4.5,
  );

  footer();
  return doc.output("arraybuffer");
}

export function summaryLine(s: ReportSummary): string {
  const i = indicators(s);
  return `${fmtInt(s.threads)} threads · ${fmtPct(i.comunidade)} resolvido pela comunidade · ${fmtPct(i.semResposta)} sem resposta`;
}
