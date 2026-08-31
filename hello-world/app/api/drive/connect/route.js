import { NextResponse } from "next/server";
import { getAuth, unauthorized, configGate } from "@/lib/drive/routeSupport";
import { driveAuthUrl } from "@/lib/drive/driveOAuth";
import { createDriveOAuthState, stateCookieName, STATE_COOKIE_MAX_AGE_SECONDS } from "@/lib/drive/oauthState";

export const runtime = "nodejs";

/**
 * GET /api/drive/connect
 *
 * Starts the Drive OAuth flow. Mirrors the Gmail precedent's shape (getAuth,
 * mint a state, redirect to Google) but with two deliberate departures — see
 * ARCH.md §6/§7.1 and the security note on the callback route:
 *
 *   1. The state is Drive's OWN composed state (lib/drive/oauthState.js):
 *      a signed, provider:"drive" payload from the Gmail chunk's shared
 *      lib/oauth/state.js PLUS a random nonce that is ALSO set here as an
 *      HttpOnly, single-use cookie. The cookie is the half that makes replay
 *      protection independent of Redis (ARCH.md §6): the callback clears it
 *      unconditionally on use, so a replayed callback finds nothing to match
 *      even when the signed state itself would still verify.
 *   2. Order of checks — getAuth() before configGate() — matches ARCH.md
 *      §7.1's pseudocode and the save route: an unauthenticated caller gets
 *      401 regardless of whether the feature happens to be configured.
 *
 * The user id bound into the state (and later required to match at the
 * callback) comes from THIS request's Supabase session, never from any
 * client-supplied value — the same property the callback re-asserts.
 */
export async function GET(request) {
  const { supabase, userId } = await getAuth();
  if (!userId) return unauthorized();

  const gate = configGate();
  if (gate) return gate;

  // Bind the minted state to the current session id when one is available,
  // exactly like the Gmail connect route: getClaims() falls through to a
  // network call on HS256 projects, so a transient blip legitimately yields
  // no session id, and that must not block a user from connecting.
  let sessionId = null;
  try {
    const { data: claimsData } = await supabase.auth.getClaims();
    if (claimsData?.claims?.session_id) {
      sessionId = claimsData.claims.session_id;
    }
  } catch {
    sessionId = null;
  }

  const { origin } = new URL(request.url);
  const redirectUri = `${origin}/api/drive/oauth2callback`;

  const { state, nonce } = createDriveOAuthState({ userId, sessionId });
  const authUrl = driveAuthUrl(redirectUri, state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(stateCookieName, nonce, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
