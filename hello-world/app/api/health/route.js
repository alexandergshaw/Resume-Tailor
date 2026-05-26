import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const checks = {
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseUrlValue: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    supabaseAnonKeyPrefix: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.slice(0, 20) + "..."
      : null,
    dbReachable: false,
    dbError: null,
  };

  try {
    const supabase = await createClient();
    // Ping auth service instead of a table (no RLS concerns)
    const { error } = await supabase.auth.getSession();
    if (error) {
      checks.dbError = error.message;
    } else {
      checks.dbReachable = true;
    }
  } catch (e) {
    checks.dbError = e.message;
  }

  return Response.json(checks);
}
