// Cria (ou promove) o primeiro administrador.
// Uso: npm run create-admin -- email@datacrazy.io "Nome Completo"
// Envia o convite por e-mail; a pessoa define a senha pelo link.

import { createClient } from "@supabase/supabase-js";

const [email, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ").trim();

if (!email || !name) {
  console.error('Uso: npm run create-admin -- email@datacrazy.io "Nome Completo"');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
if (!url || !key) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY no .env.local.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const normalized = email.trim().toLowerCase();

const { data: existing } = await db.from("profiles").select("id").eq("email", normalized).maybeSingle();

let userId = existing?.id;
if (!userId) {
  const { data, error } = await db.auth.admin.inviteUserByEmail(normalized, {
    data: { name },
    redirectTo: `${site}/auth/confirm?next=/definir-senha`,
  });
  if (error) {
    console.error("Falha ao convidar:", error.message);
    process.exit(1);
  }
  userId = data.user.id;
  console.log(`Convite enviado para ${normalized}.`);
}

const { error } = await db.from("profiles").update({ role: "admin", active: true, name }).eq("id", userId);
if (error) {
  console.error("Falha ao promover a admin:", error.message);
  process.exit(1);
}
console.log(`${name} agora é administrador.`);
