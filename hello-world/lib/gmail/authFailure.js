/**
 * The COARSE, client-facing cause. Closed set. Safe to serialize into a
 * response body, the activity log, or the DOM.
 * @typedef {"not_connected" | "reauth_required" | "temporarily_unavailable"} GmailAuthCause
 */

/**
 * The FINE, server-only discriminant. Closed set. NEVER serialized to a
 * response body, the client, or the activity log — operator-log only.
 * @typedef {"no_tokens" | "invalid_grant" | "invalid_client" | "network" | "unrecognized"} GmailAuthLogCode
 */

export const GMAIL_AUTH_CAUSES = ["not_connected", "reauth_required", "temporarily_unavailable"];

/**
 * classifyAuthFailure(input) -> { cause, logCode }
 *
 * PURE. No I/O. Total: never throws, for any input, and always returns a
 * value from the closed vocabularies above.
 *
 * Maps a "no stored tokens" state or a refresh-failure error to a coarse
 * client cause and a fine, server-only logCode. Discriminant rules, per
 * research R-1/R-2 (installed google-auth-library@10.6.2 / gaxios@7.1.4) —
 * do NOT re-derive:
 *   - provider rejection  <=>  Boolean(err.response) is truthy
 *       (google-auth-library's own convention, oauth2client.js:377 — NOT
 *        `err.code`, which is the numeric HTTP status, not the OAuth code)
 *   - OAuth code           =   err.response.data.error  (a STRING)
 *       NEVER err.code and NEVER err.message (google-auth-library rewrites
 *       err.message to a JSON blob for the /ReAuth/i case — research R-4)
 *   - network failure      <=>  err.response is falsy
 *
 * @param {{ kind: "no-tokens" } | { kind: "refresh-error", error: unknown }} input
 * @returns {{ cause: GmailAuthCause, logCode: GmailAuthLogCode }}
 */
export function classifyAuthFailure(input) {
  if (input && typeof input === "object" && input.kind === "no-tokens") {
    return { cause: "not_connected", logCode: "no_tokens" };
  }

  const err = input && typeof input === "object" ? input.error : undefined;

  // A thrown value that is NOT an object carries no positive evidence of
  // anything (not a provider rejection, not a network error) — it is
  // UNRECOGNISED, not transient. Defaulting an unrecognised failure into
  // "temporarily_unavailable" would keep polling silently and recreate the
  // exact swallow this classifier exists to remove, so it falls to the same
  // fail-toward-a-visible-remedy default as any other unrecognised failure.
  if (!err || typeof err !== "object") {
    return { cause: "reauth_required", logCode: "unrecognized" };
  }

  // No HTTP response at all is the one stable, vendor-precedented signal of a
  // network-level failure (research R-2). It is transient: no remedy, keep
  // polling.
  if (!err.response) {
    return { cause: "temporarily_unavailable", logCode: "network" };
  }

  const code = err.response.data && err.response.data.error;

  if (code === "invalid_grant") {
    return { cause: "reauth_required", logCode: "invalid_grant" };
  }

  if (code === "invalid_client") {
    // The one place the two axes diverge (F-2): a rotated client secret is an
    // operator/config failure the user's reconnect cannot fix, so the user
    // sees temporarily_unavailable (no remedy offered), but the logCode stays
    // invalid_client so the operator can find and fix it (AC-4).
    return { cause: "temporarily_unavailable", logCode: "invalid_client" };
  }

  // A provider rejection whose code we don't recognise (e.g. Google's
  // admin_policy_enforced, or any future code). Fails toward a visible
  // remedy rather than silence — the dominant harm this chunk exists to
  // prevent is a genuinely broken connection rendered as "no job email"
  // (AC-3 iv).
  return { cause: "reauth_required", logCode: "unrecognized" };
}
