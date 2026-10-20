import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { mediaUrl, type MediaStore } from "@/lib/media";

// Serve a mídia de uma mensagem: confere a sessão, lê a mensagem com a RLS do
// usuário e redireciona para uma URL assinada de curta duração.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: message } = await supabase
    .from("messages")
    .select("*")
    .eq("id", id)
    .maybeSingle<{ media_path: string | null; media_name: string | null; media_mime: string | null; media_store?: MediaStore }>();

  if (!message?.media_path) return NextResponse.json({ error: "Mídia não encontrada." }, { status: 404 });

  const download = request.nextUrl.searchParams.has("download");
  const url = await mediaUrl(
    { path: message.media_path, store: message.media_store ?? "supabase", mime: message.media_mime },
    600,
    download ? (message.media_name ?? "arquivo") : undefined,
  );

  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "private, max-age=500");
  return res;
}
