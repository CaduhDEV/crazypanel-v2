import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { getUazapi } from "@/lib/uazapi/instance";
import { mediaUrl, storeFile } from "@/lib/media";
import { loadCommunityReport, reportPeriod, type CommunityReport } from "@/lib/reports/data";
import { periodRange, type MetricsPeriod } from "@/lib/reports/period";
import { buildReportPdf, summaryLine } from "@/lib/reports/pdf";

// Somente servidor. Emissão do relatório oficial: numera, gera o PDF, guarda no
// R2 e envia pelo WhatsApp (uazapi) para os atendentes escolhidos.

export interface Delivery {
  profile_id: string;
  name: string;
  whatsapp: string | null;
  ok: boolean;
  error?: string;
}

export interface IssuedReport {
  id: number;
  number: string;
  deliveries: Delivery[];
}

const TZ = "America/Sao_Paulo";

export const reportNumber = (id: number) => String(id).padStart(4, "0");

/** Código curto impresso no PDF (confere com reports.checksum). */
function verification(report: CommunityReport, number: string | null) {
  const hash = createHash("sha256").update(JSON.stringify({ number, report })).digest("hex");
  return { hash, code: `${hash.slice(0, 4)}-${hash.slice(4, 8)}`.toUpperCase() };
}

export function reportFileName(number: string | null, fim: Date) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(fim);
  return `Relatorio-Comunidades-${number ? `n${number}-` : "previa-"}${day}.pdf`;
}

/** PDF sem número (prévia: não envia, não numera). */
export async function previewReport(period: MetricsPeriod) {
  const { inicio, fim } = periodRange(period);
  const report = await loadCommunityReport(inicio, fim);
  const { code } = verification(report, null);
  return { pdf: buildReportPdf(report, { number: null, verification: code }), fileName: reportFileName(null, fim) };
}

export async function issueReport(opts: { trigger: "schedule" | "manual"; requestedBy?: string | null }): Promise<IssuedReport> {
  const db = createAdminClient();
  const settings = await getSettings();
  const { inicio, fim } = reportPeriod(settings.report_period_days);

  const { data: recipients } = settings.report_recipients.length
    ? await db.from("profiles").select("id, name, whatsapp, active").in("id", settings.report_recipients)
    : { data: [] };
  const people = ((recipients ?? []) as { id: string; name: string; whatsapp: string | null; active: boolean }[]).filter((p) => p.active);
  if (!people.length) throw new Error("Nenhum atendente escolhido para receber o relatório.");

  const report = await loadCommunityReport(inicio, fim);

  // A numeração oficial vem da linha do relatório.
  const { data: row, error } = await db
    .from("reports")
    .insert({ period_start: inicio.toISOString(), period_end: fim.toISOString(), trigger: opts.trigger, requested_by: opts.requestedBy ?? null })
    .select("id")
    .single();
  if (error || !row) throw new Error(`Não foi possível numerar o relatório: ${error?.message}`);
  const id = row.id as number;
  const number = reportNumber(id);

  const { hash, code } = verification(report, number);
  const pdf = buildReportPdf(report, { number, verification: code });
  const fileName = reportFileName(number, fim);
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(fim).replace("-", "/");
  const path = `reports/${month}/${fileName}`;

  const store = await storeFile(path, pdf, "application/pdf").catch((e: unknown) => {
    throw new Error(`Não foi possível guardar o PDF: ${e instanceof Error ? e.message : e}`);
  });
  await db.from("reports").update({ file_path: path, file_store: store, checksum: hash }).eq("id", id);

  const url = await mediaUrl({ path, store, mime: "application/pdf" }, 6 * 3600, fileName);
  const caption = [
    `*Relatório das Comunidades nº ${number}*`,
    `Período: ${new Intl.DateTimeFormat("pt-BR", { timeZone: TZ }).format(inicio)} a ${new Intl.DateTimeFormat("pt-BR", { timeZone: TZ }).format(new Date(fim.getTime() - 1))}`,
    summaryLine(report.resumo),
    `Código de verificação: ${code}`,
  ].join("\n");

  const uaz = await getUazapi();
  const deliveries: Delivery[] = [];
  for (const p of people) {
    if (!p.whatsapp) {
      deliveries.push({ profile_id: p.id, name: p.name, whatsapp: null, ok: false, error: "sem WhatsApp cadastrado" });
      continue;
    }
    try {
      await uaz.sendMedia({ number: p.whatsapp, type: "document", file: url, docName: fileName, mimetype: "application/pdf", text: caption });
      deliveries.push({ profile_id: p.id, name: p.name, whatsapp: p.whatsapp, ok: true });
    } catch (e) {
      deliveries.push({ profile_id: p.id, name: p.name, whatsapp: p.whatsapp, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  await db.from("reports").update({ deliveries }).eq("id", id);
  if (deliveries.some((d) => d.ok)) await db.from("app_settings").update({ report_last_sent_at: new Date().toISOString() }).eq("id", 1);
  return { id, number, deliveries };
}

/** Rotina de hora em hora: emite no dia e hora configurados (horário de Brasília), uma vez por semana. */
export async function issueScheduledReport(now = new Date()): Promise<{ sent: boolean; reason?: string; report?: IssuedReport }> {
  const s = await getSettings();
  if (!s.report_enabled) return { sent: false, reason: "desligado" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const hour = Number(parts.hour);
  if (weekday !== s.report_weekday || hour !== s.report_hour) return { sent: false, reason: "fora do horário" };
  if (s.report_last_sent_at && now.getTime() - Date.parse(s.report_last_sent_at) < 20 * 3600 * 1000) return { sent: false, reason: "já enviado" };
  return { sent: true, report: await issueReport({ trigger: "schedule" }) };
}
