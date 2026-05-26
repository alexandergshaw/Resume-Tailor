import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  const checks = {
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrlValue: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    supabaseAnonKeyPrefix: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.slice(0, 20) + "..."
      : null,
    supabaseServiceKeyPrefix: process.env.SUPABASE_SERVICE_ROLE_KEY
      ? process.env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 20) + "..."
      : null,
    authReachable: false,
    authError: null,
    adminDbReachable: false,
    adminDbError: null,
  };

  // Test regular client (auth)
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.getSession();
    if (error) checks.authError = error.message;
    else checks.authReachable = true;
  } catch (e) {
    checks.authError = e.message;
  }

  // Test admin client (DB with service role key)
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await admin.from("applied_jobs").select("id").limit(1);
    if (error) checks.adminDbError = error.message;
    else checks.adminDbReachable = true;
  } catch (e) {
    checks.adminDbError = e.message;
  }

  return Response.json(checks);
}
