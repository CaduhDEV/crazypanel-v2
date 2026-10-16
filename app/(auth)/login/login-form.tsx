"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { login } from "@/lib/auth/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/validation";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  const error = state ? state.error : initialError;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Bom dia, Tiger!</h1>
        {/* <p className="text-sm text-muted-foreground">Acesso restrito a contas @{ALLOWED_EMAIL_DOMAIN}.</p> */}
      </div>

      <form action={action} className="flex flex-col gap-5">
        <FormField
          name="email"
          label="E-mail"
          type="email"
          placeholder={`voce@${ALLOWED_EMAIL_DOMAIN}`}
          autoComplete="email"
          defaultValue={state?.values?.email}
          errors={state?.fieldErrors?.email}
          required
          autoFocus
        />
        <div className="flex flex-col gap-2">
          <FormField
            name="password"
            label="Senha"
            type="password"
            autoComplete="current-password"
            errors={state?.fieldErrors?.password}
            required
          />
          <Link href="/esqueci-senha" className="self-end text-xs text-muted-foreground hover:text-foreground">
            Esqueci minha senha
          </Link>
        </div>
        <FormMessage error={error} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
