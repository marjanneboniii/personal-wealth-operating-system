import { createClient } from "@supabase/supabase-js";
import { publicSupabaseConfig } from "@/lib/supabase/config";

export function createAdminClient() {
  const { url } = publicSupabaseConfig();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured");
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
