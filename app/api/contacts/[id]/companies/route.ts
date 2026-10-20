import { NextResponse } from "next/server";
import { isUuid, memberRoute } from "@/lib/api-route";
import { loadCompanyChoices } from "@/lib/leads/company-choices";

// Empresas em que o lead aparece (para escolher a principal).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Contato inválido." }, { status: 400 });
  return memberRoute(() => loadCompanyChoices(id));
}
