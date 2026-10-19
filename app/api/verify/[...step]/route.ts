import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/crypto";
import { loadVerification, VerifyError, type Verification } from "@/lib/verify/core";
import { confirmEmail, resendEmail, startEmail } from "@/lib/verify/email";
import { confirmPhone, resendPhone, startPhone } from "@/lib/verify/phone";
import { completeVerification } from "@/lib/verify/complete";

// API da verificação de leads, chamada SÓ pelo servidor do formulário externo
// (crazypanel-form), com o header x-form-key = FORM_API_KEY. O navegador nunca
// fala com esta rota direto.
//
// POST /api/verify/start          { name, email }        → { id, token }
// POST /api/verify/status         { id, token }          → em que etapa está
// POST /api/verify/email/resend   { id, token }
// POST /api/verify/email/confirm  { id, token, code }
// POST /api/verify/phone/start    { id, token, phone }
// POST /api/verify/phone/resend   { id, token }
// POST /api/verify/phone/confirm  { id, token, code }   → conclui: { status, company }

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const key = process.env.FORM_API_KEY;
  const given = request.headers.get("x-form-key") ?? "";
  return !!key && safeEqual(given, key);
}

const ok = (data: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...data });

function fail(e: unknown) {
  if (e instanceof VerifyError) {
    return NextResponse.json(
      { ok: false, code: e.code, message: e.message, retryAfter: e.retryAfterSeconds ?? null },
      { status: e.httpStatus },
    );
  }
  console.error("[verify]", e);
  return NextResponse.json({ ok: false, code: "unexpected", message: "Algo deu errado. Tente de novo em instantes." }, { status: 500 });
}

/** Etapa atual, para o formulário retomar depois de recarregar a página. */
function stage(v: Verification) {
  return {
    stage: v.status === "completed" ? "done" : !v.email_verified_at ? "email_code" : !v.phone ? "phone" : !v.phone_verified_at ? "phone_code" : "done",
    name: v.name,
    email: v.email,
    phone: v.phone,
    lockedUntil: v.locked_until && Date.parse(v.locked_until) > Date.now() ? v.locked_until : null,
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ step: string[] }> }) {
  if (!authorized(request)) return NextResponse.json({ ok: false, code: "unauthorized", message: "Não autorizado." }, { status: 401 });

  const step = (await params).step.join("/");
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const db = createAdminClient();

  try {
    if (step === "start") {
      const res = await startEmail(db, {
        name: body.name,
        email: body.email,
        ip: request.headers.get("x-client-ip"),
        userAgent: request.headers.get("x-client-user-agent"),
      });
      return ok(res);
    }

    const v = await loadVerification(db, body.id, body.token);
    switch (step) {
      case "status":
        return ok(stage(v));
      case "email/resend":
        return ok(await resendEmail(db, v));
      case "email/confirm":
        return ok(await confirmEmail(db, v, body.code));
      case "phone/start":
        return ok(await startPhone(db, v, body.phone));
      case "phone/resend":
        return ok(await resendPhone(db, v));
      case "phone/confirm": {
        await confirmPhone(db, v, body.code);
        const fresh = await loadVerification(db, body.id, body.token);
        return ok({ ...(await completeVerification(db, fresh)) });
      }
      default:
        return NextResponse.json({ ok: false, code: "not_found", message: "Etapa desconhecida." }, { status: 404 });
    }
  } catch (e) {
    return fail(e);
  }
}
