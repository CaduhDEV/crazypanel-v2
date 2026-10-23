"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ResetRequestForm } from "@/components/auth/reset-request-form";

type EmailLink = { access: string | null; refresh: string | null; error: string | null };

// O endereço só existe no navegador (o acesso vem depois do #). No servidor: null.
const subscribe = () => () => {};
const readLink = () => {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  return JSON.stringify({
    access: hash.get("access_token"),
    refresh: hash.get("refresh_token"),
    error: hash.get("error_code") ?? hash.get("error") ?? query.get("erro"),
  } satisfies EmailLink);
};

/**
 * Recebe o link do e-mail: abre a sessão e leva para criar a senha. Se o link
 * venceu, já foi usado ou é de outro navegador, mostra o motivo e deixa pedir
 * outro na hora.
 */
export function AuthCallback() {
  const raw = useSyncExternalStore(subscribe, readLink, () => null);
  const link = raw ? (JSON.parse(raw) as EmailLink) : null;
  const [failed, setFailed] = useState(false);
  const hasSession = !!link?.access && !!link.refresh;

  useEffect(() => {
    if (!link?.access || !link.refresh) return;
    createClient()
      .auth.setSession({ access_token: link.access, refresh_token: link.refresh })
      .then(({ error }) => {
        if (error) return setFailed(true);
        // Recarrega a página para o servidor já ver a sessão nova (e tira o acesso do endereço).
        window.location.replace("/definir-senha");
      });
  }, [link?.access, link?.refresh]);

  if (!link || (hasSession && !failed)) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        Abrindo seu acesso…
      </div>
    );
  }

  const reason =
    link.error === "otp_expired"
      ? "Este link venceu ou já foi usado. Cada link vale uma vez só e por pouco tempo."
      : link.error === "outro-navegador"
        ? "Este link foi aberto num navegador diferente do que pediu. Peça um novo abaixo: ele funciona em qualquer navegador."
        : "Não conseguimos abrir este link. Ele pode estar incompleto ou já ter sido usado.";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Link expirado</h1>
        <p className="text-sm text-muted-foreground">{reason}</p>
        <p className="text-sm text-muted-foreground">Informe seu e-mail para receber um link novo e criar sua senha.</p>
      </div>

      <ResetRequestForm submitLabel="Enviar novo link" />

      <Link href="/login" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Voltar para o login
      </Link>
    </div>
  );
}
