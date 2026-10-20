import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEDIA_BUCKET } from "@/lib/media";
import { r2Get, r2Key } from "@/lib/r2";
import { previewReport } from "@/lib/reports/issue";

export const maxDuration = 120;

// PDF do relatório: ?dias=7|30|90 gera a prévia (sem número); ?id=N baixa um relatório emitido (só admin).
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (id) {
    const db = createAdminClient();
    const { data: row } = await db.from("reports").select("*").eq("id", id).maybeSingle();
    const path = row?.file_path as string | undefined;
    if (!path) return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
    const name = path.split("/").pop()!;
    if (row?.file_store === "r2") {
      const res = await r2Get(r2Key(path)).catch(() => null);
      if (!res) return NextResponse.json({ error: "PDF indisponível." }, { status: 404 });
      return pdfResponse(await res.arrayBuffer(), name);
    }
    const { data, error } = await db.storage.from(MEDIA_BUCKET).download(path);
    if (error || !data) return NextResponse.json({ error: "PDF indisponível." }, { status: 404 });
    return pdfResponse(await data.arrayBuffer(), name);
  }

  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("dias")) || 7));
  try {
    const { pdf, fileName } = await previewReport(days);
    return pdfResponse(pdf, fileName);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Não foi possível gerar o PDF." }, { status: 500 });
  }
}

function pdfResponse(body: ArrayBuffer, fileName: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
