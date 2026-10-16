import { createAdminClient } from "@/lib/supabase/admin";
import { toSettings, type AppSettings } from "@/lib/types";

export async function getSettings(): Promise<AppSettings> {
  // "*": colunas novas entram sem quebrar quando a migration ainda não subiu.
  const { data } = await createAdminClient().from("app_settings").select("*").eq("id", 1).maybeSingle();
  return toSettings(data);
}
