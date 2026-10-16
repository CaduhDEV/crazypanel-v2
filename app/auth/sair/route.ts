import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Encerra a sessão quando o layout detecta conta desativada (Server Components
// não podem gravar cookies) e volta ao login com o motivo.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const motivo = request.nextUrl.searchParams.get("motivo");
  const url = new URL("/login", request.url);
  if (motivo) url.searchParams.set("erro", motivo);
  return NextResponse.redirect(url);
}
