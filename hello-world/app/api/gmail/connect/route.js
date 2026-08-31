import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUrl } from "@/lib/gmail/gmailClient";
import { createOAuthState } from "@/lib/oauth/state";

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

  // Bind the minted state to the current session id when one is available, so
  // a state minted here cannot be replayed against a different session for the
  // same user. getClaims() falls through to a network call on HS256 projects,
  // so a transient blip legitimately yields no session id — in that case we
  // still mint an (unbound) state rather than block the user from connecting.
  let sessionId = null;
  try {
    const { data: claimsData } = await supabase.auth.getClaims();
    if (claimsData?.claims?.session_id) {
      sessionId = claimsData.claims.session_id;
    } else {
      console.warn("Gmail OAuth connect: no session id available; minting an unbound state");
    }
  } catch {
    console.warn("Gmail OAuth connect: getClaims() failed; minting an unbound state");
  }

  // Build the redirect URI — matches what you registered in Google Cloud Console
  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/gmail/oauth2callback`;

  // Signed, bound, expiring state — see lib/oauth/state.js. Replaces the old
  // unsigned base64url({userId}) blob, which let an attacker mint a state
  // naming their own user id and have a victim's tokens saved under it.
  const state = createOAuthState({ provider: "gmail", userId: user.id, sessionId });

  const authUrl = getAuthUrl(redirectUri, state);

  return NextResponse.redirect(authUrl);
}
