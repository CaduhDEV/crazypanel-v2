"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2, Lock } from "lucide-react";
import { login } from "@/lib/auth/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/validation";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  const error = state ? state.error : initialError;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="inline-flex w-fit items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <Lock className="size-3.5" aria-hidden="true" />
          <span>Acesso exclusivo para membros cadastrados</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Acessar sua conta</h1>
        <p className="text-sm text-muted-foreground">
          Este ambiente é restrito aos colaboradores da empresa. Entre com suas credenciais para acessar o painel.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-5">
        <FormField
          name="email"
          label="E-mail Corporativo"
          type="email"
          placeholder={`voce@${ALLOWED_EMAIL_DOMAIN}`}
          autoComplete="email"
          defaultValue={state?.values?.email}
          errors={state?.fieldErrors?.email}
          required
          autoFocus
        />
        <div className="flex flex-col gap-2">
          <div className="relative">
            <FormField
              name="password"
              label="Senha"
              type="password"
              autoComplete="current-password"
              errors={state?.fieldErrors?.password}
              required
            />
            <Link
              href="/esqueci-senha"
              className="absolute right-0 top-0 text-xs font-medium text-primary hover:underline"
            >
              Esqueceu a senha?
            </Link>
          </div>
        </div>
        <FormMessage error={error} />
        <Button type="submit" size="lg" className="w-full text-sm font-semibold" disabled={pending}>
          {pending && <Loader2 className="animate-spin mr-2" />}
          {pending ? "Autenticando…" : "Iniciar Turno no Painel"}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Primeiro acesso à comunidade?{" "}
        <Link href="/esqueci-senha" className="font-semibold text-primary hover:underline">
          Solicitar link de ativação
        </Link>
      </p>
    </div>
  );
}
