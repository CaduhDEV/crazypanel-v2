import { CircleAlert, CircleCheck } from "lucide-react";
import { Input, Label } from "@/components/ui/input";

type FormFieldProps = React.ComponentProps<typeof Input> & {
  name: string;
  label: string;
  errors?: string[];
  hint?: string;
};

/** Label + input + mensagem de erro do campo (formulários com useActionState). */
export function FormField({ name, label, errors, hint, defaultValue, ...props }: FormFieldProps) {
  const error = errors?.[0];
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        // Recria o campo quando a ação devolve outro valor (ex.: e-mail após senha errada).
        key={String(defaultValue ?? "")}
        id={name}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${name}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        {success}
      </p>
    );
  }
  return null;
}
