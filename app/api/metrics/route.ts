import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { loadMetrics } from "@/lib/reports/data";
import { parsePeriod } from "@/lib/reports/period";

export const maxDuration = 60;

// Métricas para a página e o telão (atualização periódica e em tempo real).
export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Apenas administradores." }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const period = parsePeriod({ dias: sp.get("dias"), de: sp.get("de"), ate: sp.get("ate") }, [1, 7, 30, 90]);
  try {
    return NextResponse.json(await loadMetrics(period), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Não foi possível calcular as métricas." }, { status: 500 });
  }
}
