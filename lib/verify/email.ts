import { createClient } from "@supabase/supabase-js";
import {
  assertCooldown,
  assertNotLocked,
  EMAIL_RE,
  LIMITS,
  lockedMessage,
  newToken,
  registerFailure,
  sendsLastHour,
  sha256,
  VerifyError,
  type Admin,
  type Verification,
} from "@/lib/verify/core";

// Somente servidor. E-mail verificado pelo Supabase Auth deste projeto: o lead é
// criado pela service role (app_metadata.kind = "lead", sem perfil de atendente)
// e recebe o código de 6 dígitos do template "Magic Link" ({{ .Token }}).

/** Cliente público, sem guardar sessão: só para pedir e conferir o código. */
function authClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Garante o usuário no Auth. Lead novo nasce confirmado: quem prova o e-mail é o código. */
async function ensureAuthUser(db: Admin, email: string, name: string): Promise<string | null> {
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { kind: "lead" },
    // kind também no user_metadata: o app_metadata só é gravado depois do INSERT (triggers do Auth).
    user_metadata: { name, kind: "lead" },
  });
  if (data?.user) return data.user.id;
  // Já existe (lead de outra tentativa, ou alguém da equipe): segue com o mesmo usuário.
  if (error && /already|registered|exists/i.test(error.message)) {
    const { data: found } = await db.from("lead_verifications").select("auth_user_id").ilike("email", email).not("auth_user_id", "is", null).limit(1).maybeSingle();
    return (found?.auth_user_id as string | undefined) ?? null;
  }
  throw new VerifyError("email_failed", "Não foi possível iniciar a verificação do e-mail. Tente de novo.", 500);
}

async function sendEmailCode(email: string) {
  const { error } = await authClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (!error) return;
  if (error.status === 429 || /rate|limit|seconds/i.test(error.message)) {
    throw new VerifyError("cooldown", "Muitos e-mails enviados agora. Aguarde um pouco e tente de novo.", 429, 60);
  }
  throw new VerifyError("email_failed", "Não foi possível enviar o código para esse e-mail.", 502);
}

/** Etapa 1: nome + e-mail → cria a sessão do formulário e manda o código. */
export async function startEmail(db: Admin, input: { name: unknown; email: unknown; ip: string | null; userAgent: string | null }) {
  const name = String(input.name ?? "").trim().slice(0, 120);
  const email = String(input.email ?? "").trim().toLowerCase();
  if (name.length < 2) throw new VerifyError("invalid_name", "Informe seu nome.");
  if (!EMAIL_RE.test(email) || email.length > 200) throw new VerifyError("invalid_email", "Confira o e-mail informado.");

  if (input.ip) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await db.from("lead_verifications").select("id", { count: "exact", head: true }).eq("ip", input.ip).gte("created_at", since);
    if ((count ?? 0) >= LIMITS.startsPerIpPerHour) throw new VerifyError("rate_limited", "Muitas tentativas a partir desta rede. Tente mais tarde.", 429, 3600);
  }
  if ((await sendsLastHour(db, "email", email, "email_sent_at")) >= LIMITS.sendsPerHour) {
    throw new VerifyError("rate_limited", "Muitos códigos enviados para esse e-mail. Tente de novo em 1 hora.", 429, 3600);
  }

  const authUserId = await ensureAuthUser(db, email, name);
  await sendEmailCode(email);

  const token = newToken();
  const { data, error } = await db
    .from("lead_verifications")
    .insert({
      secret_hash: sha256(token),
      name,
      email,
      auth_user_id: authUserId,
      email_sent_at: new Date().toISOString(),
      email_sends: 1,
      ip: input.ip,
      user_agent: input.userAgent?.slice(0, 300) ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new VerifyError("email_failed", "Não foi possível iniciar a verificação. Tente de novo.", 500);
  return { id: data.id as string, token, email };
}

export async function resendEmail(db: Admin, v: Verification) {
  assertNotLocked(v);
  if (v.email_verified_at) throw new VerifyError("already_verified", "Esse e-mail já foi confirmado.");
  assertCooldown(v.email_sent_at);
  if (v.email_sends >= LIMITS.sendsPerHour) throw new VerifyError("rate_limited", "Limite de reenvios atingido. Tente de novo em 1 hora.", 429, 3600);
  await sendEmailCode(v.email);
  await db.from("lead_verifications").update({ email_sent_at: new Date().toISOString(), email_sends: v.email_sends + 1 }).eq("id", v.id);
  return { resendInSeconds: Math.ceil(LIMITS.resendCooldownMs / 1000) };
}

export async function confirmEmail(db: Admin, v: Verification, code: unknown) {
  assertNotLocked(v);
  if (v.email_verified_at) return { ok: true };
  const token = String(code ?? "").replace(/\D/g, "");
  if (token.length !== 6) throw new VerifyError("invalid_code", "Digite os 6 números do código.");

  const { error } = await authClient().auth.verifyOtp({ email: v.email, token, type: "email" });
  if (error) {
    const locked = await registerFailure(db, v, { email_attempts: v.email_attempts + 1 });
    if (locked) throw new VerifyError("locked", lockedMessage(), 429, LIMITS.lockMs / 1000);
    const expired = /expired/i.test(error.message);
    throw new VerifyError(expired ? "expired_code" : "wrong_code", expired ? "Esse código expirou. Peça um novo." : "Código incorreto. Confira e tente de novo.");
  }
  await db.from("lead_verifications").update({ email_verified_at: new Date().toISOString(), status: "phone_pending" }).eq("id", v.id);
  return { ok: true };
}
