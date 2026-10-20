import { NextResponse, type NextRequest } from "next/server";
import { isUuid, memberRoute } from "@/lib/api-route";
import { refreshContactCrm } from "@/lib/crm-sync";

export const maxDuration = 30;

// Consulta o lead no CRM DataCrazy (cache de 10 min; ?force=1 ignora o cache).
// Devolve true quando gravou dados novos no contato.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Contato inválido." }, { status: 400 });
  const force = request.nextUrl.searchParams.get("force") === "1";
  return memberRoute(() => refreshContactCrm(id, force));
}
