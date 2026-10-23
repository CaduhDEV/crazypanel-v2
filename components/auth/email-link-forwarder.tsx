"use client";

import { useEffect } from "react";

/**
 * Se o Supabase mandar o link do e-mail para a página inicial (Redirect URL não
 * cadastrada em Authentication → URL Configuration), o acesso chega depois do #
 * e o painel cai no login. Aqui ele segue para /auth/callback, que abre a sessão.
 */
export function EmailLinkForwarder() {
  useEffect(() => {
    const { hash, pathname } = window.location;
    if (pathname === "/auth/callback") return;
    if (/(^|[#&])(access_token|error_code)=/.test(hash)) window.location.replace(`/auth/callback${hash}`);
  }, []);
  return null;
}
