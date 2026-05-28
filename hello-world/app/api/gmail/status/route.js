import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadTokens } from "@/lib/gmail/gmailClient";

/**
 * GET /api/gmail/status
 *
 * Returns whether the current user has connected their Gmail account.
 * Response: { connected: boolean, email?: string }
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = await loadTokens(user.id);

  return NextResponse.json({ connected: tokens !== null });
}
