// The read/write lifecycle of a user's Google Drive OAuth credential.
//
// `lib/drive/driveOAuth.js` deliberately stayed a bare client factory (build
// a client, get a URL, exchange a code, revoke a token) and never touches
// `drive_connections` -- see that file's own header. THIS module is the only
// one that reads or writes the connection record: it loads the stored row,
// builds an authenticated client from it, refreshes the access token when
// needed, persists whatever the refresh hands back, and revokes on
// disconnect.
//
// THE DEFECT THIS MODULE EXISTS TO PREVENT (verified in the Gmail
// precedent). `lib/gmail/gmailClient.js:78-90` builds an OAuth2 client,
// refreshes it manually and ONCE (only when `getAuthenticatedClient` itself
// is called, and only if the stored `expiry_date` already looks stale), and
// subscribes to nothing. But google-auth-library refreshes an access token
// transparently in more places than that one manual check -- on an
// automatic 401-retry, and inside `getAccessToken()`/`refreshAccessToken()`
// -- and every one of those refreshes emits a `'tokens'` event
// (`oauth2client.js:211`, `:276`, `:505` in the installed
// google-auth-library). A repo-wide `grep -rn "\.on("` finds zero
// listeners anywhere. Any token google refreshes outside gmailClient's one
// manual check is silently discarded. `authorizedDriveClient` below
// subscribes to that event before anything else happens.
//
// MERGE, NEVER REPLACE. A refresh response never carries a `refresh_token`
// (the library re-attaches the prior one internally so the *caller* still
// has to be trusted with it -- see `driveOAuth.js`'s own header). Writing a
// refresh response over the stored record would wipe the long-lived
// refresh_token and silently convert a working connection into one that
// dies at the next access-token expiry. `saveDriveTokens` below only ever
// sends `lib/supabase/driveConnections.js` the fields it actually has
// (never an explicit `undefined`/placeholder for a field it doesn't), and
// `saveDriveConnection` itself only writes columns present in that object
// -- so a field this module never learned about is never touched in the
// row. See that module's own header for why that is safe at the SQL level
// too (a partial upsert, never an insert-shaped overwrite).
//
// READ BACK AFTER WRITE, BEFORE REPORTING SUCCESS. This is the guard that
// would have caught the existing Gmail defect where a completed consent
// flow can land the user on "not connected" with nothing logged (the write
// path there is fire-and-forget). Every `saveDriveTokens` call re-reads the
// row -- a SEPARATE read from the upsert's own `.select()` -- and only
// reports success once that re-read actually shows a connection with a
// `refresh_token` on it.
//
// FAIL LOUDLY, NEVER SILENTLY. `driveConnections.js` already distinguishes
// "no rows" (`connection: null, error: null`) from every other store error
// (`connection: null, error: <message>`) -- an unapplied migration surfaces
// as a real Postgres error (42P01), and reading that as "not connected"
// would send a user who did nothing wrong into an infinite reconnect loop.
// `authorizedDriveClient` preserves that distinction as `reason:
// "not_connected"` vs. `reason: "storage_unavailable"`; nothing here ever
// collapses the second into the first.
//
// RECONNECT CLASSIFICATION. A stored refresh_token can stop working --
// documented conditions include six months of inactivity and, notably,
// **while the OAuth consent screen is in "Testing" mode, seven days** --
// so the reconnect path is not a rare edge case during development. Per
// `lib/drive/driveErrors.js`, "needs reconnect" is `401` on an API call OR
// a refresh that failed with `invalid_grant` -- never a string match against
// `err.message`, which `oauth2client.js:261-268` rewrites. This module
// reuses that classifier rather than re-deriving one.

import { google } from "googleapis";
import { getDriveConnection, saveDriveConnection, deleteDriveConnection } from "@/lib/supabase/driveConnections";
import { createDriveOAuthClient, revokeToken } from "./driveOAuth";
import { classifyDriveError, DRIVE_ERROR_KIND } from "./driveErrors";

/**
 * Picks out of a raw google-auth-library `Credentials` object (whatever
 * `exchangeCode()` returns, or whatever a `'tokens'` event hands back) only
 * the keys `saveDriveConnection` understands, and ONLY when that key is
 * actually present on `tokens`. This is the merge boundary: a refresh
 * response has no `refresh_token` key at all, so `fields.refreshToken` is
 * never set for it, so `saveDriveConnection`'s own partial-upsert never
 * touches `refresh_token` in the row. A key that IS present but empty
 * (`access_token: null` after some hypothetical revocation) is still
 * forwarded -- that is a real, deliberate value, not an absence.
 */
function tokenFieldsPresent(tokens) {
  const source = tokens && typeof tokens === "object" ? tokens : {};
  const fields = {};

  // refresh_token gets its own, stricter guard: only a genuine non-empty
  // string counts, so a refresh payload's absent/undefined/null
  // refresh_token can never become an accidental overwrite.
  if (typeof source.refresh_token === "string" && source.refresh_token) {
    fields.refreshToken = source.refresh_token;
  }

  if (Object.prototype.hasOwnProperty.call(source, "access_token")) {
    fields.accessToken = typeof source.access_token === "string" ? source.access_token : null;
  }
  if (Object.prototype.hasOwnProperty.call(source, "expiry_date")) {
    fields.expiryDate = typeof source.expiry_date === "number" ? source.expiry_date : null;
  }
  if (Object.prototype.hasOwnProperty.call(source, "scope")) {
    fields.scope = typeof source.scope === "string" ? source.scope : null;
  }

  return fields;
}

/** The stored row -> the `Credentials` shape `OAuth2Client#setCredentials` expects. */
function toCredentials(connection) {
  const credentials = { token_type: "Bearer" };
  if (connection.access_token) credentials.access_token = connection.access_token;
  if (connection.refresh_token) credentials.refresh_token = connection.refresh_token;
  if (typeof connection.expiry_date === "number") credentials.expiry_date = connection.expiry_date;
  if (connection.scope) credentials.scope = connection.scope;
  return credentials;
}

/** The one connection row for `userId`, or null if none exists. Thin, named wrapper over
 * `driveConnections.js` so every other module in this feature reaches storage through
 * `driveTokens.js` rather than importing the data-access module directly. */
export async function loadDriveTokens(userId) {
  return getDriveConnection(userId);
}

/**
 * Merges `tokens` (a raw google-auth-library `Credentials` object -- what
 * `exchangeCode()` returns on first connect, or what a `'tokens'` event
 * hands back on a silent refresh) and `extra` (non-token fields this
 * feature also persists on the row: `googleEmail`, `folderId`) onto the
 * stored connection, writes it, and reads it back before reporting success
 * (AC-C17). Returns `{ connection, error }` -- `connection` is only ever
 * non-null when the write is CONFIRMED persisted, never merely accepted.
 *
 * `tokens` may be omitted (`undefined`) for a save that only carries
 * `extra` -- e.g. writing `folder_id` back onto the row after a
 * get-or-create, which touches no token field at all.
 */
export async function saveDriveTokens(userId, tokens, extra = {}) {
  if (!userId) return { connection: null, error: "Missing user id." };

  const fields = { ...tokenFieldsPresent(tokens), ...extra };

  const { error: writeError } = await saveDriveConnection(userId, fields);
  if (writeError) return { connection: null, error: writeError };

  // AC-C17 / the Gmail read-back guard: a SEPARATE read, independent of the
  // upsert's own `.select()`, before ever reporting success. `refresh_token`
  // is `not null` at the schema level, so any genuinely persisted row --
  // first connect or a later merge alike -- carries one; its absence here
  // means the write did not really land.
  const { connection, error: readError } = await getDriveConnection(userId);
  if (readError) return { connection: null, error: readError };
  if (!connection || !connection.refresh_token) {
    return { connection: null, error: "The Drive connection did not persist." };
  }

  return { connection, error: null };
}

/** Deletes the stored connection row. Thin, named wrapper over `driveConnections.js`,
 * for the same reason `loadDriveTokens` is: this module is the one write surface. */
export async function deleteDriveTokens(userId) {
  return deleteDriveConnection(userId);
}

/**
 * Revokes the stored token at Google and deletes the local record --
 * `DELETE /api/drive/disconnect`'s whole job (AC-C19a/b/c). A revocation
 * failure (network error, already-revoked token, anything) does NOT stop
 * the local delete: an unreachable Google endpoint must never leave a
 * connection the app still thinks is live. The reverse direction matters
 * too and is preserved by simply not swallowing `deleteDriveConnection`'s
 * result: storage being unavailable must never be reported as
 * `disconnected: true` over a record that is still sitting there
 * (`lib/gmail/gmailClient.js:64-71`'s exact defect -- a delete whose
 * response status nothing inspects).
 */
export async function disconnectDrive(userId) {
  if (!userId) return { deleted: false, revoked: false, error: "Missing user id." };

  const { connection } = await getDriveConnection(userId);
  const token = connection ? connection.refresh_token || connection.access_token : null;

  const revokeResult = token ? await revokeToken(token) : { revoked: false, error: null };

  const { deleted, error } = await deleteDriveConnection(userId);

  return { deleted, error, revoked: revokeResult.revoked };
}

/**
 * Loads the stored connection, builds an authenticated OAuth2 client from
 * it, subscribes to `'tokens'` (AC-C18) BEFORE anything can trigger a
 * refresh, refreshes proactively (AC-E6 -- an upload's body is a
 * `Readable`, which skips the library's own automatic 401-retry, so this
 * module cannot rely on that), and returns a ready-to-use `drive` v3
 * client.
 *
 * Returns one of:
 *   `{ ok: true, drive, auth, connection }`
 *   `{ ok: false, reason: "not_connected", error: null }`        -- no stored row, or a
 *                                                                    refresh that failed
 *                                                                    with invalid_grant
 *   `{ ok: false, reason: "storage_unavailable", error }`         -- any OTHER storage
 *                                                                    error (a real Supabase
 *                                                                    failure, 42P01 included)
 *
 * Never collapses the second case into the first -- see this file's header.
 */
export async function authorizedDriveClient(userId, redirectUri) {
  const { connection, error } = await getDriveConnection(userId);
  if (error) return { ok: false, reason: "storage_unavailable", error };
  if (!connection) return { ok: false, reason: "not_connected", error: null };

  const auth = createDriveOAuthClient(redirectUri);
  auth.setCredentials(toCredentials(connection));

  // Subscribed BEFORE the proactive refresh below (and before this `drive`
  // instance is ever handed to a caller that might trigger the library's
  // OWN internal refresh) -- so no refresh, proactive or transparent, is
  // ever discarded. `saveDriveTokens` merges: see this file's header.
  auth.on("tokens", (refreshed) => {
    void saveDriveTokens(userId, refreshed);
  });

  // AC-E6: refresh proactively, once, before the caller ever reaches
  // `drive.files.*`. `getAccessToken()` is the library's own no-throw,
  // no-op-when-still-valid way to do this -- it only refreshes (and only
  // then emits `'tokens'`) when the current token is missing or expiring.
  try {
    await auth.getAccessToken();
  } catch (err) {
    if (classifyDriveError(err) === DRIVE_ERROR_KIND.RECONNECT) {
      return { ok: false, reason: "not_connected", error: null };
    }
    throw err;
  }

  const drive = google.drive({ version: "v3", auth });
  return { ok: true, drive, auth, connection };
}
