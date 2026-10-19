import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { loadMetrics } from "@/lib/reports/data";

export const maxDuration = 60;

// Métricas para a página e o telão (atualização periódica e em tempo real).
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("dias")) || 7));
  try {
    return NextResponse.json(await loadMetrics(days), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Não foi possível calcular as métricas." }, { status: 500 });
  }
}
