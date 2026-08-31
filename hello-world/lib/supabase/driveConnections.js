// Data access for the Google Drive OAuth credential (public.drive_connections
// — see supabase/migrations/20260901000000_drive.sql). SERVICE-ROLE ONLY.
//
// This is the ONLY module in the repo permitted to name the
// "drive_connections" table — enforced by the `[src]` sweep in
// driveMigrationShape.test.js (ADJUDICATION.md §A-1's adopted mitigation).
// Every function here builds its own service-role client via
// createAdminClient() (lib/supabase/admin.js) rather than accepting a
// caller-supplied client: the table has no `authenticated` RLS policy at
// all, so a session client could never read or write it anyway, and
// hard-coding the admin client here is what makes it impossible for a
// caller to accidentally reach this table any other way.
//
// createAdminClient() THROWS when the service-role env vars are unset
// (admin.js:17-21) — deliberately NOT caught here. That is the "loud
// failure" this table was designed to have: an unconfigured store surfaces
// as an exception the caller turns into 503 `drive_unconfigured`, never a
// working Connect button that silently stores nothing (ADJUDICATION.md
// §A-1, reason 3). Only genuine Supabase query errors (a bad connection, a
// missing table) are caught below and returned as a result object.
//
// AC-C4 / ADJUDICATION §A-1: "no rows" and "every other error" must be
// distinguishable, because an unapplied migration surfaces as Postgres
// `42P01` (relation does not exist) — a real error — and must NOT be read as
// "not connected". `.maybeSingle()` makes this distinction for free: zero
// matching rows resolves as `{ data: null, error: null }` (not an error at
// all), while a genuine backend failure — 42P01 included — resolves with a
// non-null `error`. Callers branch on it as:
//   error truthy            -> storage unavailable (503)
//   error null, connection null -> not connected (401 not_connected)
//   connection present       -> connected
//
// Never `select("*")` here (the sweep enforces this too): only the columns
// each function actually needs are selected.

import { createAdminClient } from "@/lib/supabase/admin";

const TABLE = "drive_connections";
const COLUMNS =
  "user_id, refresh_token, access_token, expiry_date, scope, google_email, folder_id, created_at, updated_at";

// The one connection row for `userId`, or null if none exists. Read back
// after a write, before reporting "connected" (ADJUDICATION.md §A-1's
// carried-over Gmail-defect guard).
export async function getDriveConnection(userId) {
  if (!userId) return { connection: null, error: "Missing user id." };

  const supabase = createAdminClient();
  try {
    const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq("user_id", userId).maybeSingle();
    if (error) return { connection: null, error: error.message || "Could not read the Drive connection." };
    return { connection: data || null, error: null };
  } catch (err) {
    return { connection: null, error: err?.message || "Could not read the Drive connection." };
  }
}

// Creates or overwrites the one connection row for `userId` — a credential
// is a "latest known" fact per user, never a history, so this is always an
// upsert on the primary key, never `.insert(`. `fields` is whatever of
// refreshToken/accessToken/expiryDate/scope/googleEmail/folderId the caller
// has; anything omitted is left out of the row entirely rather than written
// as null, so a partial call — e.g. persisting a silently-refreshed access
// token via the OAuth library's `tokens` event — MERGES onto the existing
// row instead of overwriting it. This is what keeps a token refresh (whose
// response carries no `refresh_token`) from wiping out the stored grant
// (ADJUDICATION.md §A-1, "merge rather than replace").
//
// `refreshToken` is required on the FIRST write for a user (drive_file_id-
// style NOT NULL at the schema level), but is optional on a merge update
// once the row already exists.
export async function saveDriveConnection(userId, fields = {}) {
  if (!userId) return { connection: null, error: "Missing user id." };

  const supabase = createAdminClient();
  try {
    const row = { user_id: userId, updated_at: new Date().toISOString() };
    if (typeof fields.refreshToken === "string" && fields.refreshToken) row.refresh_token = fields.refreshToken;
    if (typeof fields.accessToken === "string" || fields.accessToken === null) row.access_token = fields.accessToken;
    if (typeof fields.expiryDate === "number" || fields.expiryDate === null) row.expiry_date = fields.expiryDate;
    if (typeof fields.scope === "string" || fields.scope === null) row.scope = fields.scope;
    if (typeof fields.googleEmail === "string" || fields.googleEmail === null) row.google_email = fields.googleEmail;
    if (typeof fields.folderId === "string" || fields.folderId === null) row.folder_id = fields.folderId;

    const { data, error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: "user_id" })
      .select(COLUMNS)
      .maybeSingle();
    if (error) return { connection: null, error: error.message || "Could not save the Drive connection." };
    return { connection: data || null, error: null };
  } catch (err) {
    return { connection: null, error: err?.message || "Could not save the Drive connection." };
  }
}

// Deletes the connection row for `userId`. Returns `deleted: true` only when
// the delete itself is confirmed (no Supabase error) — never reporting
// success over a surviving record, unlike lib/gmail/gmailClient.js's
// fire-and-forget `deleteTokens` (AC-C19c / AC-C20d). Deleting an
// already-absent row is still success: disconnecting twice is not a failure.
export async function deleteDriveConnection(userId) {
  if (!userId) return { deleted: false, error: "Missing user id." };

  const supabase = createAdminClient();
  try {
    const { error } = await supabase.from(TABLE).delete().eq("user_id", userId).select("user_id");
    if (error) return { deleted: false, error: error.message || "Could not delete the Drive connection." };
    return { deleted: true, error: null };
  } catch (err) {
    return { deleted: false, error: err?.message || "Could not delete the Drive connection." };
  }
}
