import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ResetRequestForm } from "@/components/auth/reset-request-form";

export const metadata: Metadata = { title: "Segurança da Conta · Recuperação" };

export default function EsqueciSenhaPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="inline-flex w-fit items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-500 dark:text-amber-400">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          <span>Segurança da Conta</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Seu link de acesso expirou</h1>
        <p className="text-sm text-muted-foreground">
          Para proteger as informações da comunidade e sua conta, nossos links de acesso são de uso único e expiram rapidamente.
        </p>
      </div>

      <ResetRequestForm submitLabel="Receber Novo Link Seguro" />

      <div className="text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          Voltar para o login
        </Link>
      </div>
    </div>
  );
}
