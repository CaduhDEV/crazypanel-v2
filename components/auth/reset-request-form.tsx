"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { requestPasswordReset } from "@/lib/auth/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/auth/validation";
import { FormField, FormMessage } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";

/** Pede um link novo para criar a senha (Esqueci a senha e link expirado). */
export function ResetRequestForm({ submitLabel = "Enviar link" }: { submitLabel?: string }) {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
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
        {submitLabel}
      </Button>
    </form>
  );
}
