import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rotas acessíveis sem sessão. O webhook se autentica pelo segredo na URL.
// "/" é a landing (quem está logado vai direto para o atendimento).
const PUBLIC_ROUTES = ["/", "/login", "/esqueci-senha", "/auth", "/api/webhooks", "/api/cron", "/api/community", "/api/verify", "/api/ai/classificacoes", "/api/ai/moderacao", "/api/ai/cerebro", "/api/cerebro"];
// Rotas que não fazem sentido para quem já está logado.
const GUEST_ONLY_ROUTES = ["/login", "/esqueci-senha"];

const matches = (pathname: string, routes: string[]) =>
  routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));

/** Renova a sessão do Supabase e faz os redirecionamentos otimistas. */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // O webhook não usa sessão: não gasta uma ida ao Auth a cada evento.
  if (pathname.startsWith("/api/webhooks") || pathname.startsWith("/api/cron") || pathname.startsWith("/api/community") || pathname.startsWith("/api/verify") || pathname.startsWith("/api/ai/classificacoes") || pathname.startsWith("/api/ai/moderacao") || pathname.startsWith("/api/ai/cerebro") || pathname.startsWith("/api/cerebro")) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Não coloque código entre createServerClient e getClaims: é aqui que o token é validado/renovado.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = !!data?.claims;

  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = "";
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (!isLoggedIn && !matches(pathname, PUBLIC_ROUTES)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
    }
    return redirect("/login");
  }
  if (isLoggedIn && matches(pathname, GUEST_ONLY_ROUTES)) {
    return redirect("/atendimento");
  }

  return response;
}
