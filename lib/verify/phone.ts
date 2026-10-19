import { getUazapi } from "@/lib/uazapi/instance";
import { UazapiError } from "@/lib/uazapi/client";
import { phoneKey } from "@/lib/gleap";
import {
  assertCooldown,
  assertPhoneAvailable,
  assertNotLocked,
  codeHash,
  LIMITS,
  lockedMessage,
  newCode,
  normalizePhone,
  registerFailure,
  sendsLastHour,
  VerifyError,
  type Admin,
  type Verification,
} from "@/lib/verify/core";

// Somente servidor. Telefone verificado por um código de 6 dígitos enviado pelo
// WhatsApp (uazapi). O código é guardado só como hash.

function codeMessage(name: string, code: string) {
  const first = name.trim().split(/\s+/)[0] || "Olá";
  return `${first}, seu código de verificação da comunidade DataCrazy é *${code}*.\n\nEle vale por 10 minutos. Não compartilhe com ninguém.`;
}

async function deliver(v: Verification, phone: string, db: Admin) {
  if (v.phone_sends >= LIMITS.sendsPerHour && v.phone === phone) {
    throw new VerifyError("rate_limited", "Limite de reenvios atingido. Tente de novo em 1 hora.", 429, 3600);
  }
  if ((await sendsLastHour(db, "phone", phone, "phone_last_sent_at")) >= LIMITS.sendsPerHour) {
    throw new VerifyError("rate_limited", "Muitos códigos enviados para esse número. Tente de novo em 1 hora.", 429, 3600);
  }

  const code = newCode();
  try {
    await (await getUazapi()).sendText({ number: phone, text: codeMessage(v.name, code) });
  } catch (e) {
    // Número sem WhatsApp costuma voltar 4xx da uazapi; queda da instância, 5xx/0.
    if (e instanceof UazapiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
      throw new VerifyError("no_whatsapp", "Não encontramos WhatsApp nesse número. Confira o DDD e o número.");
    }
    throw new VerifyError("whatsapp_unavailable", "Não conseguimos enviar o código agora. Tente de novo em alguns minutos.", 503);
  }

  const now = new Date();
  await db
    .from("lead_verifications")
    .update({
      phone,
      phone_code_hash: codeHash(v.id, code),
      phone_code_expires_at: new Date(now.getTime() + LIMITS.phoneCodeTtlMs).toISOString(),
      phone_code_attempts: 0,
      phone_sends: v.phone === phone ? v.phone_sends + 1 : 1,
      phone_last_sent_at: now.toISOString(),
      phone_verified_at: null,
    })
    .eq("id", v.id);
  return { phone, resendInSeconds: Math.ceil(LIMITS.resendCooldownMs / 1000) };
}

/** Etapa do telefone: recebe o número e manda o código. Trocar o número reinicia. */
export async function startPhone(db: Admin, v: Verification, rawPhone: unknown) {
  assertNotLocked(v);
  if (!v.email_verified_at) throw new VerifyError("email_first", "Confirme o e-mail antes.");
  if (v.phone_verified_at) throw new VerifyError("already_verified", "Esse telefone já foi confirmado.");
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new VerifyError("invalid_phone", "Confira o DDD e o número do WhatsApp.");
  await assertPhoneAvailable(db, phoneKey(phone));
  if (v.phone === phone) assertCooldown(v.phone_last_sent_at);
  return deliver(v, phone, db);
}

export async function resendPhone(db: Admin, v: Verification) {
  assertNotLocked(v);
  if (!v.phone) throw new VerifyError("phone_first", "Informe o número primeiro.");
  if (v.phone_verified_at) throw new VerifyError("already_verified", "Esse telefone já foi confirmado.");
  assertCooldown(v.phone_last_sent_at);
  return deliver(v, v.phone, db);
}

export async function confirmPhone(db: Admin, v: Verification, code: unknown) {
  assertNotLocked(v);
  if (v.phone_verified_at) return { ok: true };
  if (!v.phone || !v.phone_code_hash) throw new VerifyError("phone_first", "Peça o código primeiro.");
  const digits = String(code ?? "").replace(/\D/g, "");
  if (digits.length !== 6) throw new VerifyError("invalid_code", "Digite os 6 números do código.");

  if (v.phone_code_expires_at && Date.parse(v.phone_code_expires_at) < Date.now()) {
    throw new VerifyError("expired_code", "Esse código expirou. Peça um novo.");
  }
  if (v.phone_code_attempts >= LIMITS.attemptsPerCode) {
    throw new VerifyError("too_many_for_code", "Muitas tentativas com esse código. Peça um novo.");
  }

  if (codeHash(v.id, digits) !== v.phone_code_hash) {
    const attempts = v.phone_code_attempts + 1;
    const locked = await registerFailure(db, v, { phone_code_attempts: attempts });
    if (locked) throw new VerifyError("locked", lockedMessage(), 429, LIMITS.lockMs / 1000);
    const left = LIMITS.attemptsPerCode - attempts;
    throw new VerifyError(
      left > 0 ? "wrong_code" : "too_many_for_code",
      left > 0 ? `Código incorreto. ${left === 1 ? "Resta 1 tentativa" : `Restam ${left} tentativas`} com esse código.` : "Muitas tentativas com esse código. Peça um novo.",
    );
  }

  await db.from("lead_verifications").update({ phone_verified_at: new Date().toISOString(), phone_code_hash: null }).eq("id", v.id);
  return { ok: true };
}
