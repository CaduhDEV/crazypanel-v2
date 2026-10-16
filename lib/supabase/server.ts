import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Client para Server Components, Server Actions e Route Handlers (sessão do usuário, respeita RLS). */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Chamado de um Server Component (cookies somente leitura): o proxy renova a sessão.
          }
        },
      },
    },
  );
}
