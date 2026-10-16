"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { setPassword } from "@/lib/auth/actions";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";

export function SetPasswordForm({ firstName, email }: { firstName?: string; email: string }) {
  const [state, action, pending] = useActionState(setPassword, undefined);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {firstName ? `Olá, ${firstName}. Defina sua senha` : "Defina sua senha"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Você vai entrar com <span className="font-medium text-foreground">{email}</span> e esta senha.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-5">
        <FormField
          name="password"
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          hint="Mínimo de 8 caracteres, com letra e número."
          errors={state?.fieldErrors?.password}
          required
          autoFocus
        />
        <FormField
          name="confirmPassword"
          label="Confirmar senha"
          type="password"
          autoComplete="new-password"
          errors={state?.fieldErrors?.confirmPassword}
          required
        />
        <FormMessage error={state?.error} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Salvar e entrar
        </Button>
      </form>
    </div>
  );
}
