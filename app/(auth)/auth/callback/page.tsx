import type { Metadata } from "next";
import { AuthCallback } from "./auth-callback";

export const metadata: Metadata = { title: "Acessar" };

// Destino dos links de convite e de recuperação de senha.
export default function AuthCallbackPage() {
  return <AuthCallback />;
}
