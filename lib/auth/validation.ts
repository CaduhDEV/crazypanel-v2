import { z } from "zod";

// O banco também bloqueia (public.allowed_email_domains): isto aqui é só UX.
export const ALLOWED_EMAIL_DOMAIN = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "datacrazy.io").toLowerCase();

export function isAllowedEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Informe um e-mail válido." }))
  .refine(isAllowedEmail, { error: `Use um e-mail @${ALLOWED_EMAIL_DOMAIN}.` });

export const passwordSchema = z
  .string()
  .min(8, { error: "A senha precisa ter ao menos 8 caracteres." })
  .regex(/[a-zA-Z]/, { error: "A senha precisa ter ao menos uma letra." })
  .regex(/[0-9]/, { error: "A senha precisa ter ao menos um número." });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: "Informe sua senha." }),
});

export const resetSchema = z.object({ email: emailSchema });

export const setPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, {
    error: "As senhas não conferem.",
    path: ["confirmPassword"],
  });
