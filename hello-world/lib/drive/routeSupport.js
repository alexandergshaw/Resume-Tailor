// Shared support for the Drive API routes (app/api/drive/**). ARCH.md §10 /
// ADJUDICATION.md §A-3: `lib/experience/apiAuth.js` already exports
// getAuth/unauthorized/badRequest/notFound and is imported by 11 routes
// across 4 feature areas (experience, meeting, techwatch,
// application-digest) -- it is not feature-scoped in practice, whatever its
// original name suggests. This module IMPORTS those rather than
// hand-rolling a fourth copy of the same five-line auth block, and adds
// only what is genuinely Drive-specific: a config gate, a not-connected
// response, a storage-unavailable response, the JSON shape that strips
// credentials, and the one shared classifier that decides between the
// second and third of those (see requireDriveConnection below).

import { getAuth, unauthorized, badRequest, notFound } from "@/lib/experience/apiAuth";
import { driveConfig } from "./driveOAuth";
import { getDriveConnection } from "@/lib/supabase/driveConnections";

export { getAuth, unauthorized, badRequest, notFound };

// AC-C21: every Drive route except GET /api/drive/status returns 503
// `drive_unconfigured` when GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is
// unset. `/status` is the DELIBERATE exception (AC-C21's own carve-out): it
// is the probe the modal uses to decide whether the feature exists at all,
// so it must return 200 `{ connected: false, configured: false }` instead of
// treating its own probe condition as an error -- it does NOT call this
// function, and builds that body itself.
//
// Reads driveConfig() (AC-C22: process.env directly, not getServerEnv) once
// per call so a route that flips the env between requests -- exactly what
// this feature's own tests do -- is never handed a stale answer.
export function configGate() {
  const { configured } = driveConfig();
  if (configured) return null;
  return Response.json({ error: "drive_unconfigured", configured: false }, { status: 503 });
}

// AC-E4a: no drive_connections row for this user. 401, not 404 -- the route
// itself is fine, the caller just hasn't connected Drive yet.
export function notConnected() {
  return Response.json({ error: "not_connected" }, { status: 401 });
}

// AC-C20d / AC-C4 / §9.5: the credential store itself is unreachable or
// erroring (including `42P01`, an unapplied migration) -- this must NEVER be
// reported as `not_connected`, or a user who just finished Google's consent
// screen is told, silently, that nothing happened. 503, matching
// configGate()'s status so a client can treat "not configured" and
// "misconfigured/unreachable" the same way if it chooses to.
export function storageUnavailable() {
  return Response.json({ error: "drive_storage_unavailable" }, { status: 503 });
}

// AC-C4 / ADJUDICATION.md §A-1: lib/supabase/driveConnections.js's
// getDriveConnection returns `{ connection, error }`, where `error` is
// non-null for a genuine store failure (a bad connection, `42P01` from an
// unapplied migration) and null with `connection: null` for the ordinary
// "no rows yet" case -- `.maybeSingle()` makes that distinction for free.
// This is the ONE place that turns that result into the correct HTTP
// outcome, so every route that needs "is this user connected" (status,
// disconnect, and the save/export/documents routes ahead of driveTokens.js's
// heavier authorizedDriveClient) shares one branch instead of each
// hand-rolling its own copy of the `42P01` check -- exactly the class of
// duplication ARCH.md's MAJ-8 sweep exists to prevent elsewhere in this
// feature.
//
//   error truthy        -> { ok: false, response: storageUnavailable() }
//   error null, no row   -> { ok: false, response: notConnected() }
//   connection present   -> { ok: true, connection }
export async function requireDriveConnection(userId) {
  const { connection, error } = await getDriveConnection(userId);
  if (error) return { ok: false, response: storageUnavailable() };
  if (!connection) return { ok: false, response: notConnected() };
  return { ok: true, connection };
}

// AC-C4 / class-4 (credential and machine-code leakage): the ONE serializer
// every Drive route response goes through. No token, refresh token, id
// token, or client secret may ever appear in a response body -- this strips
// them even if a caller accidentally spreads a raw drive_connections row (or
// a raw google-auth-library Credentials object) into the body, rather than
// relying on every call site to remember not to. Nested objects are checked
// too (e.g. a future `{ connection: {...} }` shape), arrays are walked
// element-wise, and the strip is by KEY NAME so it survives a field being
// renamed away from the obvious "token" substring as long as it keeps one of
// these exact names.
const SECRET_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "accessToken",
  "refreshToken",
  "idToken",
  "client_secret",
  "clientSecret",
  "secret",
]);

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SECRET_KEYS.has(key)) continue;
      out[key] = stripSecrets(val);
    }
    return out;
  }
  return value;
}

export function driveJson(body, init) {
  return Response.json(stripSecrets(body), init);
}
