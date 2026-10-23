import { createHash, randomBytes, randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/crypto";

// Somente servidor. Verificação de leads do formulário externo (crazypanel-form):
// sessão (id + token), regras de tentativas e erros com mensagem para a tela.

export const LIMITS = {
  /** Código do WhatsApp: validade. */
  phoneCodeTtlMs: 10 * 60 * 1000,
  /** Espera mínima entre envios (e-mail e WhatsApp). */
  resendCooldownMs: 60 * 1000,
  /** Envios por hora (por verificação e por telefone/e-mail). */
  sendsPerHour: 5,
  /** Erros por código do WhatsApp antes de exigir um novo. */
  attemptsPerCode: 5,
  /** Erros somados (e-mail + telefone) que bloqueiam a verificação. */
  maxFailures: 10,
  lockMs: 30 * 60 * 1000,
  /** Verificações iniciadas por IP por hora. */
  startsPerIpPerHour: 10,
} as const;

export type Admin = ReturnType<typeof createAdminClient>;

export interface Verification {
  id: string;
  secret_hash: string;
  name: string;
  email: string;
  auth_user_id: string | null;
  email_sent_at: string | null;
  email_sends: number;
  email_attempts: number;
  email_verified_at: string | null;
  phone: string | null;
  phone_code_hash: string | null;
  phone_code_expires_at: string | null;
  phone_code_attempts: number;
  phone_sends: number;
  phone_last_sent_at: string | null;
  phone_verified_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  status: "email_pending" | "phone_pending" | "completed";
  join_request_id: string | null;
}

/** Erro mostrado na tela do formulário (código para a interface + texto pronto). */
export class VerifyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const newToken = () => randomBytes(24).toString("base64url");
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const codeHash = (verificationId: string, code: string) => sha256(`${verificationId}:${code}`);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 55 + DDD + número (o formulário é só Brasil). */
export function normalizePhone(v: unknown): string | null {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55") || (d.length !== 12 && d.length !== 13)) return null;
  return d;
}

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** Carrega a sessão do formulário conferindo o token. */
export async function loadVerification(db: Admin, id: unknown, token: unknown): Promise<Verification> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof token !== "string" || !token) {
    throw new VerifyError("invalid_session", "Sessão inválida. Recomece o cadastro.", 401);
  }
  const { data } = await db.from("lead_verifications").select("*").eq("id", id).maybeSingle<Verification>();
  if (!data || !safeEqual(data.secret_hash, sha256(token))) {
    throw new VerifyError("invalid_session", "Sessão inválida. Recomece o cadastro.", 401);
  }
  return data;
}

/** Bloqueio por excesso de tentativas. */
export function assertNotLocked(v: Verification) {
  if (v.locked_until && Date.parse(v.locked_until) > Date.now()) {
    const left = Date.parse(v.locked_until) - Date.now();
    throw new VerifyError("locked", `Muitas tentativas. Tente de novo em ${minutes(left)} min.`, 429, Math.ceil(left / 1000));
  }
}

/** Espera entre envios. */
export function assertCooldown(lastSentAt: string | null) {
  if (!lastSentAt) return;
  const wait = Date.parse(lastSentAt) + LIMITS.resendCooldownMs - Date.now();
  if (wait > 0) {
    throw new VerifyError("cooldown", `Aguarde ${Math.ceil(wait / 1000)} s para pedir outro código.`, 429, Math.ceil(wait / 1000));
  }
}

/** Conta um erro de código; ao passar do limite, bloqueia a verificação. */
export async function registerFailure(db: Admin, v: Verification, patch: Record<string, unknown>): Promise<boolean> {
  const failures = v.failed_attempts + 1;
  const locked = failures >= LIMITS.maxFailures;
  await db
    .from("lead_verifications")
    .update({
      ...patch,
      failed_attempts: locked ? 0 : failures,
      locked_until: locked ? new Date(Date.now() + LIMITS.lockMs).toISOString() : v.locked_until,
    })
    .eq("id", v.id);
  return locked;
}

export const lockedMessage = () => `Muitas tentativas. Tente de novo em ${minutes(LIMITS.lockMs)} min.`;

/** Envios na última hora para o mesmo destino (em todas as verificações). */
export async function sendsLastHour(db: Admin, field: "email" | "phone", value: string, sentField: "email_sent_at" | "phone_last_sent_at") {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const query = db.from("lead_verifications").select(field === "email" ? "email_sends" : "phone_sends").gte(sentField, since);
  const { data } = await (field === "email" ? query.ilike("email", value) : query.eq("phone", value));
  return ((data ?? []) as Record<string, number>[]).reduce((n, r) => n + (r[field === "email" ? "email_sends" : "phone_sends"] ?? 0), 0);
}

/** Formata para o Gleap: +55DDDNUMERO. */
export const e164 = (phone: string) => `+${phone}`;

/** Pedidos que ainda contam como "em andamento" (bloqueiam um novo cadastro igual). */
const OPEN_REQUEST = ["pending", "accepted", "invited"];

/**
 * E-mail já cadastrado: lead existente no painel ou pedido em andamento.
 * O lead só nasce quando um admin aceita a solicitação.
 */
export async function assertEmailAvailable(db: Admin, email: string) {
  // Conta da equipe do painel: o formulário é só para clientes. Sem isto, o código
  // iria para a conta do atendente (e um link no e-mail o colocaria no painel).
  const { count: staff } = await db.from("profiles").select("id", { count: "exact", head: true }).ilike("email", email);
  if (staff) throw new VerifyError("email_staff", "Esse e-mail é de uma conta da equipe DataCrazy. Use o e-mail de cliente com que você acessa o CRM.", 409);
  const { count: leads } = await db.from("contacts").select("id", { count: "exact", head: true }).ilike("email", email);
  if (leads) throw new VerifyError("email_registered", "Esse e-mail já está cadastrado na comunidade.", 409);
  const { count: open } = await db
    .from("join_requests")
    .select("id", { count: "exact", head: true })
    .ilike("email", email)
    .in("status", OPEN_REQUEST);
  if (open) throw new VerifyError("email_pending_request", "Já existe um pedido com esse e-mail em análise. Aguarde o retorno pelo WhatsApp.", 409);
}

/** Telefone já cadastrado: lead existente (com ou sem o 9) ou pedido em andamento. */
export async function assertPhoneAvailable(db: Admin, key: string) {
  const { count: leads } = await db.from("contacts").select("id", { count: "exact", head: true }).eq("phone_key", key);
  if (leads) throw new VerifyError("phone_registered", "Esse número já está cadastrado na comunidade.", 409);
  const { count: open } = await db
    .from("join_requests")
    .select("id", { count: "exact", head: true })
    .eq("phone_key", key)
    .in("status", OPEN_REQUEST);
  if (open) throw new VerifyError("phone_pending_request", "Já existe um pedido com esse número em análise. Aguarde o retorno pelo WhatsApp.", 409);
}
