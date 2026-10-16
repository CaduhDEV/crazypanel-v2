"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { requestPasswordReset } from "@/lib/auth/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/validation";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";

export default function EsqueciSenhaPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Recuperar senha</h1>
        <p className="text-sm text-muted-foreground">
          Informe seu e-mail. Enviaremos um link para você criar uma nova senha.
        </p>
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
        <FormMessage error={state?.error} success={state?.success} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Enviar link
        </Button>
      </form>

      <Link href="/login" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Voltar para o login
      </Link>
    </div>
  );
}
