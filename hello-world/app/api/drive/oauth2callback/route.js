import { NextResponse } from "next/server";
import { getAuth, configGate } from "@/lib/drive/routeSupport";
import { exchangeCode } from "@/lib/drive/driveOAuth";
import { stateCookieName, verifyDriveOAuthState } from "@/lib/drive/oauthState";
import { saveDriveTokens } from "@/lib/drive/driveTokens";

export const runtime = "nodejs";

// Manually-built Set-Cookie value that expires `drive_oauth_state`
// immediately. Built once, applied to EVERY response this route returns —
// success, every rejection branch, and the config-gate 503 alike — via
// `clearStateCookie` below, appended with `headers.append` rather than
// `NextResponse#cookies.delete()` so it works uniformly whether the response
// came from `new NextResponse(...)` here or from `configGate()`'s plain
// `Response.json(...)` (a bare Response has no `.cookies` helper at all).
//
// THIS IS THE OBLIGATION `lib/drive/oauthState.js` DELIBERATELY LEAVES OPEN:
// `verifyDriveOAuthState` never clears the cookie itself (see that module's
// header) — Drive's entire single-use replay protection rests on this route
// clearing it unconditionally, on every exit path, so a replayed callback
// request finds no nonce left to match regardless of whether THIS request
// succeeded or was rejected. No module-level test can catch its omission
// here; only a route-level test that inspects the outgoing Set-Cookie header
// on both a success and a failure response can.
const CLEAR_STATE_COOKIE = `${stateCookieName}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;

function clearStateCookie(response) {
  response.headers.append("Set-Cookie", CLEAR_STATE_COOKIE);
  return response;
}

/**
 * The same-origin HTML page AC-C12 requires instead of a redirect (the exact
 * thing the Gmail precedent does, and the exact thing NOT to copy here — a
 * full-page redirect would navigate the modal away and, per ARCH.md AM-6,
 * destroy the in-memory `tailoringMap` a redirect-based flow can't avoid).
 * It postMessages `{ source: "drive-oauth", ok, reason }` to `window.opener`
 * targeted at THIS request's own exact origin (never "*") and then closes
 * itself. The 50ms fallback redirect to "/" is for the no-popup path (popup
 * blocked ⇒ same-tab navigation, ARCH.md §7.1): there is no opener to
 * message and nothing to close, so the tab must not be left stranded on a
 * bare HTML page.
 */
function callbackHtml(origin, ok, reason) {
  const message = JSON.stringify({ source: "drive-oauth", ok: Boolean(ok), reason: reason ?? null });
  const targetOrigin = JSON.stringify(origin);
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Google Drive</title></head>
<body>
<script>
(function () {
  var message = ${message};
  try {
    if (window.opener) {
      window.opener.postMessage(message, ${targetOrigin});
    }
  } catch (e) {}
  try {
    window.close();
  } catch (e) {}
  setTimeout(function () {
    try {
      window.location.replace("/");
    } catch (e) {}
  }, 50);
})();
</script>
</body>
</html>`;
}

function respondHtml(origin, ok, reason) {
  return new NextResponse(callbackHtml(origin, ok, reason), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * GET /api/drive/oauth2callback
 *
 * THE SECURITY SHAPE (ARCH.md, "do not inherit Gmail's old one"). The Gmail
 * flow shipped a CSRF/token-binding flaw: an unsigned base64url `{userId}`
 * in `state`, trusted outright, which let an attacker mint a state naming
 * their own id, send a victim a GENUINE consent link, and have the victim's
 * tokens stored under the attacker's account. This route never repeats that:
 *
 *   - `userId` below comes ONLY from `getAuth()` — the caller's Supabase
 *     session, riding Google's cross-site top-level GET redirect because
 *     `@supabase/ssr` hardcodes `sameSite: "lax"`. It is NEVER read out of
 *     `state`; `verifyDriveOAuthState`'s successful return value doesn't
 *     even carry a userId field, so there is nothing to accidentally trust.
 *   - `state` proves only that this request matches one THIS app minted for
 *     THIS session — verified BEFORE the code exchange, and a rejection
 *     never logs the state, the code, or any token.
 *   - `replayChecked` (the shared helper's Redis-backed replay layer) is
 *     never read here — Drive relies solely on its own cookie nonce, cleared
 *     unconditionally below, per lib/drive/oauthState.js's header.
 */
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const errorParam = searchParams.get("error");
  const cookieValue = request.cookies.get(stateCookieName)?.value;

  // User denied consent at Google — nothing else to evaluate, and (matching
  // the Gmail precedent) this must not depend on there being a live session.
  if (errorParam) {
    // "consent-refused", not "denied" -- lib/drive/driveMessages.js's
    // ERROR_CODE_TO_KEY (the settled, UX.md-sourced copy table) keys this
    // outcome "consent-refused" -> consentRefused. Emitting anything else
    // here is a silent third contract-with-no-counterparty (WAVE4-SEAMS.md
    // MAJOR-3) -- see the reason-vocabulary membership test in
    // route.test.js, which enumerates every string this route can emit and
    // asserts each resolves through driveErrorMessage().
    console.warn("Drive OAuth callback rejected: reason=consent-refused");
    return clearStateCookie(respondHtml(origin, false, "consent-refused"));
  }

  const gate = configGate();
  if (gate) return clearStateCookie(gate);

  const { supabase, userId } = await getAuth();
  if (!userId) {
    console.warn("Drive OAuth callback rejected: reason=no-session");
    return clearStateCookie(respondHtml(origin, false, "no-session"));
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

  // Verify BEFORE the code exchange (ARCH.md). `userId`/`sessionId` here are
  // this request's own binding — never anything decoded from `stateParam`.
  const verified = await verifyDriveOAuthState(stateParam, { userId, sessionId, cookieValue });
  if (!verified.ok) {
    console.warn(`Drive OAuth callback rejected: reason=${verified.reason}`);
    return clearStateCookie(respondHtml(origin, false, verified.reason));
  }

  if (!code) {
    console.warn("Drive OAuth callback rejected: reason=missing-code");
    return clearStateCookie(respondHtml(origin, false, "missing-code"));
  }

  const redirectUri = `${origin}/api/drive/oauth2callback`;

  let tokens;
  try {
    tokens = await exchangeCode(redirectUri, code);
  } catch {
    // "token-unreadable", not "token-exchange-failed" -- the settled key
    // (see the consent-refused comment above for why this alignment
    // matters).
    console.warn("Drive OAuth callback rejected: reason=token-unreadable");
    return clearStateCookie(respondHtml(origin, false, "token-unreadable"));
  }

  // Best-effort only: the granting account's email is purely a display
  // value (AC-C10 renders it "when present"), never an authorization
  // decision (AM-5), so a failure here must not fail the connection itself.
  const googleEmail = await fetchGoogleEmail(tokens?.access_token);

  // saveDriveTokens READS THE RECORD BACK after writing (AC-C17) and only
  // ever returns a non-null `connection` once that readback actually shows
  // a persisted refresh_token — this is the guard that would have caught
  // the existing Gmail defect where a completed consent flow can land on
  // "not connected" with nothing logged.
  const { connection, error } = await saveDriveTokens(
    userId,
    tokens,
    googleEmail ? { googleEmail } : {},
  );

  if (error || !connection) {
    // "drive_storage_unavailable", not "storage" -- the settled key.
    console.warn("Drive OAuth callback rejected: reason=drive_storage_unavailable");
    return clearStateCookie(respondHtml(origin, false, "drive_storage_unavailable"));
  }

  return clearStateCookie(respondHtml(origin, true, null));
}

/** GET https://www.googleapis.com/oauth2/v3/userinfo with the fresh access
 * token — the `userinfo.email` scope (ARCH.md AM-5 / DRIVE_SCOPES) grants
 * exactly this, and it is the one Google endpoint that returns the granting
 * account's email without a second OAuth round trip. Never throws; a
 * network failure or a non-2xx response simply means no email is stored. */
async function fetchGoogleEmail(accessToken) {
  if (typeof accessToken !== "string" || !accessToken) return null;
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.email === "string" && data.email ? data.email : null;
  } catch {
    return null;
  }
}
