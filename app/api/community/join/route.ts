import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logCommunityEvent, triageJoinRequest, type JoinStatus } from "@/lib/community/core";

// Rota PÚBLICA chamada pelo formulário de entrada na comunidade (middleware).
// Mesmo contrato do painel v1: POST { rawPhone | phone, email, source? } → { ok, status, message }.
// Não exige login, por isso: CORS restrito a COMMUNITY_FORM_ORIGINS (vírgula), se
// definida; limite de tentativas por telefone; nenhum link de grupo volta para o
// navegador. A pessoa só entra depois de um admin aceitar no painel.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_PER_PHONE_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES: Record<JoinStatus | "invalid" | "rate_limited", string> = {
  pending: "Pedido recebido! Nossa equipe vai analisar e liberar sua entrada na comunidade.",
  joined: "Você já faz parte da comunidade no WhatsApp.",
  accepted: "Seu pedido já foi aprovado.",
  invited: "Seu pedido foi aprovado: enviamos o convite no seu WhatsApp.",
  rejected: "Seu pedido de entrada na comunidade não foi aprovado.",
  expired: "Recebemos seu pedido e nossa equipe vai analisar.",
  error: "Recebemos seu pedido e nossa equipe vai concluir sua entrada em breve.",
  invalid: "Confira o telefone e o e-mail informados.",
  rate_limited: "Muitas tentativas com este número. Tente novamente mais tarde.",
};

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  const list = (process.env.COMMUNITY_FORM_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (list.length === 0) return origin ?? "*"; // sem lista → aberto
  return origin && list.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Dígitos com DDI 55 (o formulário é só Brasil). */
function normalizePhone(v: unknown): string | null {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55") || (d.length !== 12 && d.length !== 13)) return null;
  return d;
}

function reply(origin: string | null, status: keyof typeof MESSAGES, httpStatus = 200) {
  const ok = !["rejected", "invalid", "rate_limited"].includes(status);
  return NextResponse.json({ ok, status, message: MESSAGES[status] }, { status: httpStatus, headers: corsHeaders(origin) });
}

export async function OPTIONS(request: Request) {
  const origin = allowedOrigin(request);
  return new NextResponse(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = allowedOrigin(request);
  if (!origin) return NextResponse.json({ error: "Origem não permitida" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const phone = normalizePhone(body?.rawPhone ?? body?.phone);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = body?.name ? String(body.name).trim().slice(0, 120) || null : null;
  if (!phone || !EMAIL_RE.test(email) || email.length > 200) return reply(origin, "invalid", 400);

  const db = createAdminClient();

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("join_requests")
    .select("id", { count: "exact", head: true })
    .eq("source", "form")
    .eq("phone", phone)
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_PHONE_PER_HOUR) return reply(origin, "rate_limited", 429);

  // Pedido do formulário ainda pendente para o mesmo telefone: reaproveita (sem duplicar).
  const { data: open } = await db
    .from("join_requests")
    .select("id")
    .eq("source", "form")
    .eq("phone", phone)
    .eq("status", "pending")
    .maybeSingle();

  let id = open?.id as string | undefined;
  if (id) {
    await db.from("join_requests").update({ email, ...(name ? { name } : {}) }).eq("id", id);
  } else {
    const formSource = body?.source ? String(body.source).slice(0, 100) : "formulario";
    const { data: created, error } = await db
      .from("join_requests")
      .insert({ source: "form", phone, email, name, form_source: formSource })
      .select("id")
      .single();
    if (error || !created) return reply(origin, "error", 500);
    id = created.id as string;
    await logCommunityEvent(db, { type: "request_created", request_id: id, phone, name, data: { source: "form", form_source: formSource, email } });
  }

  const status = await triageJoinRequest(db, id);
  return reply(origin, status);
}
