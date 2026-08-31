import { getAuth, unauthorized, storageUnavailable, driveJson } from "@/lib/drive/routeSupport";
import { driveConfig } from "@/lib/drive/driveOAuth";
import { loadDriveTokens, authorizedDriveClient } from "@/lib/drive/driveTokens";

export const runtime = "nodejs";

/**
 * GET /api/drive/status[?verify=1]
 *
 * AC-C21's DELIBERATE EXCEPTION. Every other Drive route 503s
 * `drive_unconfigured` when the Google client credentials are unset
 * (`configGate()`, in lib/drive/routeSupport.js). This route must NOT call
 * `configGate()` — it is the probe the settings control and the modal use to
 * decide whether the feature exists at all, so an unconfigured deploy has to
 * come back as a normal, successful 200 `{ connected: false, configured:
 * false }` rather than treating its own probe condition as an error. Reading
 * `driveConfig()` directly (never `configGate()`) is what keeps that promise
 * — a route that called `configGate()` here would 503 instead of rendering
 * "Connect Drive" at all, silently hiding the feature on every unconfigured
 * deploy.
 *
 * Two read paths, matching AC-C2/AC-C3:
 *   - plain GET: a pure store read (`loadDriveTokens`, no Google network
 *     call at all — AC-C2's transport stub would fail the test if this
 *     reached the network).
 *   - `?verify=1`: refreshes proactively via `authorizedDriveClient`, which
 *     is what a failed refresh (`invalid_grant`) actually surfaces as
 *     `{ connected: false }` for (AC-C3).
 *
 * AC-C4 / §9.5: a genuine store failure (`42P01` from an unapplied
 * migration included) is never reported as "not connected" — it is 503
 * `drive_storage_unavailable`, in both paths.
 */
export async function GET(request) {
  const { userId } = await getAuth();
  if (!userId) return unauthorized();

  const { configured } = driveConfig();
  if (!configured) {
    return driveJson({ connected: false, configured: false }, { status: 200 });
  }

  const { searchParams, origin } = new URL(request.url);
  const verify = searchParams.get("verify") === "1";

  if (!verify) {
    const { connection, error } = await loadDriveTokens(userId);
    if (error) return storageUnavailable();
    if (!connection) {
      return driveJson({ connected: false, configured: true }, { status: 200 });
    }
    return driveJson(
      { connected: true, configured: true, email: connection.google_email || undefined },
      { status: 200 },
    );
  }

  const redirectUri = `${origin}/api/drive/oauth2callback`;
  const result = await authorizedDriveClient(userId, redirectUri);

  if (!result.ok) {
    if (result.reason === "storage_unavailable") return storageUnavailable();
    // reason === "not_connected": either no stored row, or a refresh that
    // failed with invalid_grant (classifyDriveError -> RECONNECT) — both
    // report the same disconnected shape here.
    return driveJson({ connected: false, configured: true }, { status: 200 });
  }

  return driveJson(
    { connected: true, configured: true, email: result.connection?.google_email || undefined },
    { status: 200 },
  );
}
