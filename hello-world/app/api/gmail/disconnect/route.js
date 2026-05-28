import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteTokens } from "@/lib/gmail/gmailClient";

/**
 * DELETE /api/gmail/disconnect
 *
 * Removes stored Gmail tokens for the current user, disconnecting their Gmail account.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await deleteTokens(user.id);

  return NextResponse.json({ disconnected: true });
}
