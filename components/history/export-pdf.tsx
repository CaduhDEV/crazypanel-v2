"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app/app-context";
import { PDF_PAGE_HEIGHT, PrintableTranscript } from "@/components/history/transcript-view";
import type { Transcript } from "@/components/history/use-transcript";

const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 52; // espaço do rodapé
const USABLE = PDF_PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
// Imagem que falhar (mídia expirada, por exemplo) vira um pixel transparente em vez de quebrar a captura.
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/** Espera as imagens do nó carregarem (ou falharem), com limite de tempo. */
function waitImages(node: HTMLElement, timeoutMs = 8000) {
  const imgs = [...node.querySelectorAll("img")];
  return Promise.race([
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => ((img.onload = () => r()), (img.onerror = () => r())))))),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

/**
 * Pontos de corte entre páginas: o fim do último bloco (mensagem) que cabe na
 * página. Um bloco maior que a página inteira é cortado onde for preciso.
 */
function pageCuts(node: HTMLElement): [number, number][] {
  const total = node.scrollHeight;
  const bottoms = [...node.querySelectorAll<HTMLElement>("[data-pdf-block]")].map((b) => b.offsetTop + b.offsetHeight).sort((a, b) => a - b);
  const cuts: [number, number][] = [];
  let start = 0;
  while (start < total - 1) {
    const limit = start + USABLE;
    let end = total;
    if (limit < total) {
      const fit = bottoms.filter((b) => b > start + 40 && b <= limit);
      end = fit.length ? fit[fit.length - 1] : limit;
    }
    cuts.push([start, end]);
    start = end;
  }
  return cuts;
}

async function buildPdf(node: HTMLElement, fileName: string, footer: string) {
  await document.fonts?.ready;
  await waitImages(node);
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);

  const canvas = await toCanvas(node, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true, imagePlaceholder: BLANK });
  const scale = canvas.width / node.offsetWidth;
  const cuts = pageCuts(node);

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const page = document.createElement("canvas");
  page.width = canvas.width;
  page.height = Math.round(PDF_PAGE_HEIGHT * scale);
  const ctx = page.getContext("2d")!;

  cuts.forEach(([start, end], i) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, page.width, page.height);
    const sy = Math.round(start * scale);
    const sh = Math.round((end - start) * scale);
    ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, Math.round(MARGIN_TOP * scale), canvas.width, sh);
    if (i > 0) pdf.addPage();
    pdf.addImage(page.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    pdf.setFontSize(8);
    pdf.setTextColor(120, 130, 145);
    pdf.text(`${footer}  ·  Página ${i + 1} de ${cuts.length}`, 105, 289, { align: "center" });
  });

  pdf.save(fileName);
}

/** Botão que gera o PDF do atendimento: renderiza a versão A4 fora da tela e captura. */
export function ExportPdfButton({ transcript }: { transcript: Transcript | null }) {
  const { memberById, profile } = useApp();
  const [exporting, setExporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exporting || !transcript) return;
    let cancelled = false;
    // Um quadro para o React pintar a versão de impressão antes de medir.
    const frame = requestAnimationFrame(async () => {
      try {
        if (!ref.current) throw new Error("render");
        const generated = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
        await buildPdf(ref.current, `atendimento-${transcript.ticket.number}.pdf`, `Atendimento #${transcript.ticket.number} · gerado em ${generated}`);
        if (!cancelled) toast.success("PDF gerado.");
      } catch (e) {
        console.error("[pdf]", e);
        if (!cancelled) toast.error("Não foi possível gerar o PDF.");
      } finally {
        if (!cancelled) setExporting(false);
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [exporting, transcript]);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setExporting(true)} disabled={!transcript || exporting}>
        {exporting ? <Loader2 className="animate-spin" /> : <FileDown />} {exporting ? "Gerando PDF…" : "Exportar PDF"}
      </Button>
      {exporting &&
        transcript &&
        createPortal(
          <div aria-hidden style={{ position: "fixed", left: -10_000, top: 0, pointerEvents: "none" }}>
            <div style={{ position: "relative" }}>
              <PrintableTranscript ref={ref} transcript={transcript} memberById={memberById} generatedBy={profile.name} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
