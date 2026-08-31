import { NextResponse } from "next/server";
import { createOAuth2Client, saveTokens } from "@/lib/gmail/gmailClient";
import { createClient } from "@/lib/supabase/server";
import { verifyOAuthState } from "@/lib/oauth/state";

/**
 * GET /api/gmail/oauth2callback
 *
 * Google redirects here after the user grants (or denies) Gmail access.
 * Exchanges the authorization code for tokens and persists them.
 *
 * The user id that receives the tokens is derived from the CURRENT Supabase
 * session, never from the `state` parameter — `state` only proves the
 * request matches a state this app minted for that same session (see
 * lib/oauth/state.js). This is what closes the OAuth CSRF that previously
 * let an attacker mint a state naming their own user id and have a victim's
 * Gmail tokens saved under it.
 */
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const errorParam = searchParams.get("error");

  // User denied access
  if (errorParam) {
    return NextResponse.redirect(`${origin}/?gmail_status=denied`);
  }

  if (!code || !stateParam) {
    console.warn("Gmail OAuth callback rejected: reason=missing");
    return NextResponse.redirect(`${origin}/?gmail_status=error`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.warn("Gmail OAuth callback rejected: reason=no-session");
    return NextResponse.redirect(`${origin}/?gmail_status=error`);
  }

  let sessionId = null;
  try {
    const { data: claimsData } = await supabase.auth.getClaims();
    if (claimsData?.claims?.session_id) {
      sessionId = claimsData.claims.session_id;
    }
  } catch {
    sessionId = null;
  }

  const result = await verifyOAuthState(stateParam, {
    provider: "gmail",
    userId: user.id,
    sessionId,
  });

  if (!result.ok) {
    console.warn(`Gmail OAuth callback rejected: reason=${result.reason}`);
    return NextResponse.redirect(`${origin}/?gmail_status=error`);
  }

  if (!result.replayChecked) {
    console.warn(
      "Gmail OAuth callback: single-use protection not applied (replay store unavailable)",
    );
  }

  try {
    const redirectUri = `${origin}/api/gmail/oauth2callback`;
    const oauth2Client = createOAuth2Client(redirectUri);

    const { tokens } = await oauth2Client.getToken(code);
    await saveTokens(user.id, tokens);

    return NextResponse.redirect(`${origin}/?gmail_status=connected`);
  } catch (err) {
    console.warn("Gmail OAuth callback rejected: reason=token-exchange-failed", err?.message);
    return NextResponse.redirect(`${origin}/?gmail_status=error`);
  }
}
