import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for server-side jobs (cron, etc.) that need
 * to bypass RLS. NEVER expose this client to the browser. Only import it
 * from API routes / server-only code, never from anything that ships to the
 * client bundle.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
let cached = null;

export function createAdminClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
    );
  }
  cached = createSupabaseJsClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
