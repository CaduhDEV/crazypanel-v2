import { z } from "zod";

/** Retorno padrão das Server Actions: nunca lança para o client. */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: string): ActionResult<never> => ({ ok: false, error });

/** Erro de regra de negócio: a mensagem vai para a tela como está. */
export class ActionError extends Error {}

/**
 * Valida a entrada com Zod, executa e converte erros em ActionResult.
 * Erros inesperados são registrados e viram uma mensagem genérica.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }
  try {
    return ok(await fn(parsed.data));
  } catch (e) {
    if (e instanceof ActionError) return fail(e.message);
    console.error("[action]", e);
    return fail("Não foi possível concluir a ação. Tente novamente.");
  }
}
