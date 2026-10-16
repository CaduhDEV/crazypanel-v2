import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

const ERRORS: Record<string, string> = {
  "link-invalido": "O link é inválido ou expirou. Peça um novo convite ou recupere a senha.",
  "sem-acesso": "Seu acesso está desativado. Fale com um administrador.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return <LoginForm initialError={erro ? ERRORS[erro] : undefined} />;
}
