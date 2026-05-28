import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUrl } from "@/lib/gmail/gmailClient";

/**
 * GET /api/gmail/connect
 *
 * Generates a Google OAuth2 authorization URL and redirects the user to it.
 * The user must be signed in via Supabase auth first.
 */
export async function GET(request) {
  // Verify the user is authenticated
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Build the redirect URI — matches what you registered in Google Cloud Console
  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/gmail/oauth2callback`;

  // Encode the user ID in state so the callback can look them up
  const state = Buffer.from(JSON.stringify({ userId: user.id })).toString("base64url");

  const authUrl = getAuthUrl(redirectUri, state);

  return NextResponse.redirect(authUrl);
}
