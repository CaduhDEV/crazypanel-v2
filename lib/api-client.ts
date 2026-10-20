import type { ActionResult } from "@/lib/action";

/**
 * Chama uma rota da API do painel e devolve no formato das Server Actions.
 *
 * Use para leituras e consultas externas em segundo plano (CRM, Gleap): o
 * navegador roda as Server Actions uma por vez, e uma consulta lenta seguraria
 * o envio de mensagens, o "Finalizar" e o "Assumir" do atendente.
 */
export async function callApi<T>(url: string, init?: RequestInit): Promise<ActionResult<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) return { ok: false, error: body?.error ?? "Não foi possível concluir. Tente novamente." };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "Sem conexão com o painel. Confira a internet." };
  }
}
