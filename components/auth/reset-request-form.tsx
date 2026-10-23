"use client";

import { useActionState } from "react";
import { Loader2, Send } from "lucide-react";
import { requestPasswordReset } from "@/lib/auth/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/validation";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";

/** Pede um link novo para criar a senha (Esqueci a senha e link expirado). */
export function ResetRequestForm({ submitLabel = "Receber Novo Link Seguro" }: { submitLabel?: string }) {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormField
        name="email"
        label="Confirme seu e-mail cadastrado"
        type="email"
        placeholder={`voce@${ALLOWED_EMAIL_DOMAIN}`}
        autoComplete="email"
        defaultValue={state?.values?.email}
        errors={state?.fieldErrors?.email}
        required
        autoFocus
      />
      <FormMessage error={state?.error} success={state?.success} />
      <Button type="submit" size="lg" className="w-full text-sm font-semibold" disabled={pending}>
        {pending ? (
          <Loader2 className="animate-spin mr-2" />
        ) : (
          <Send className="size-4 mr-2" />
        )}
        {pending ? "Enviando link…" : submitLabel}
      </Button>
    </form>
  );
}
