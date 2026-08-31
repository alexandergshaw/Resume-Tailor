// Per-user Google OAuth for the Drive connection. Deliberately NOT built on
// lib/gmail/gmailClient.js -- that module is the in-repo precedent for "an
// OAuth2 client for a Google product", but three of its choices must not be
// copied here (each verified against the installed google-auth-library
// 10.6.2 / DRIVE-API-FACTS.md, and re-stated at the function that avoids it):
//
//   1. `createOAuth2Client` builds `new google.auth.OAuth2(id, secret, uri)`
//      -- the DEPRECATED positional constructor
//      (`oauth2client.d.ts:427-441`: "Passing an `clientId` directly is
//      @DEPRECATED"). This module always uses the options-object form.
//   2. `GMAIL_SCOPES` is a private constant `getAuthUrl` closes over, with no
//      scope parameter. Importing gmailClient's helpers here would silently
//      request Gmail scopes for a Drive connection. This module imports
//      DRIVE_SCOPES from ./driveMime instead (lib/drive/driveMime.js, the
//      single source of truth for every Drive literal -- MAJ-8) and never
//      imports anything from lib/gmail/.
//   3. `deleteTokens` is a hand-rolled Upstash `fetch` that ignores the
//      response status, so a failed disconnect reports success. revokeToken
//      below returns whether the network call actually succeeded instead of
//      swallowing the answer.
//
// What this module does NOT do, on purpose: it never reads or writes
// drive_connections. Storage (lib/supabase/driveConnections.js), the
// read-after-write "connected" guard (AC-C17), and the merge-persisting
// `tokens` event subscriber (AC-C18/AC-C25, ARCH.md §9.7) all belong to
// lib/drive/driveTokens.js and the routes that call it -- see ARCH.md §2.1
// row 10 / row 12. Keeping this module to "build a client, get a URL,
// exchange a code, revoke a token" is what lets driveTokens.js attach its
// own `tokens` listener onto whatever createDriveOAuthClient returns without
// this module having opinions about persistence.

import { google } from "googleapis";
import { DRIVE_SCOPES } from "./driveMime";

// AC-C22: read the Google credentials directly from process.env, never
// through getServerEnv() (lib/config/env.js) -- that helper throws when the
// unrelated Gemini key is missing (REQUIRED_SERVER_KEYS = ["Gemini_LLM_API_Key"]),
// which would turn a deploy with no Gemini key into a 500 naming an
// unrelated env var instead of routeSupport.js's clean 503
// `drive_unconfigured`. Same pattern as env.js's own getDeepgramApiKey() /
// getElevenLabsApiKey(): read directly, return a value, never throw.
export function driveConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || null;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || null;
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

// AC-R9 (ARCH.md §12's numbering) / DRIVE-API-FACTS.md F1: the current,
// non-deprecated constructor form. `redirectUri` is optional -- revokeToken
// below needs a client but never a redirect (revocation has no callback) --
// so only driveAuthUrl/exchangeCode, which do need one, pass it.
export function createDriveOAuthClient(redirectUri) {
  const { clientId, clientSecret, configured } = driveConfig();
  if (!configured) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to use the Drive integration.",
    );
  }
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
}

// Builds the Google consent URL. AC-C7/AC-C8/AC-C9a: scope is EXACTLY
// DRIVE_SCOPES (drive.file + userinfo.email) -- never Gmail's scope list, so
// a Google password change that invalidates a Gmail-scoped grant cannot take
// Drive down with it (DRIVE-API-FACTS.md §5, item 3). AC-C9b:
// access_type=offline (to receive a refresh_token at all) + prompt=consent
// (to force one on every grant, since a refresh_token is otherwise only
// issued on the very first authorization for a given user+client pair).
export function driveAuthUrl(redirectUri, state) {
  const client = createDriveOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: DRIVE_SCOPES,
    prompt: "consent",
    state,
  });
}

// Exchanges an authorization code for tokens. Returns the raw Credentials
// object (access_token, refresh_token?, expiry_date, scope, token_type) --
// nothing here decides whether the result is "connected"; that is the
// caller's job (the oauth2callback route + driveTokens.js), because it
// requires writing to drive_connections and then reading the record back
// (AC-C17), which this module deliberately does not own.
export async function exchangeCode(redirectUri, code) {
  const client = createDriveOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  return tokens;
}

// Revokes a token at Google (DELETE /api/drive/disconnect's first step,
// AC-C19a). Unlike gmailClient.js's deleteTokens -- a raw fetch whose
// response status is never inspected, so a failed delete still reports
// success -- this resolves the network outcome explicitly rather than
// letting a caller assume success from a non-throwing call. AC-C19b: the
// disconnect route must still delete the local record when this reports
// `revoked: false`; that decision belongs to the route, not here.
export async function revokeToken(token) {
  const client = createDriveOAuthClient();
  try {
    await client.revokeToken(token);
    return { revoked: true, error: null };
  } catch (err) {
    return { revoked: false, error: err?.message || "Could not revoke the Drive token." };
  }
}
