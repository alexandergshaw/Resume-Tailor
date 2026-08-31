/**
 * Classifies a failure from the Google Drive API into what the app should DO
 * about it. Pure, synchronous, never throws. See `ARCH.md` §8.3 (Wave 2B)
 * and `DRIVE-API-FACTS.md` for the verified shapes this is built against.
 *
 * One deliberate deviation from `ARCH.md` §8.3's literal pseudocode: its
 * `/rateLimitExceeded$/i` transient-403 pattern misses `dailyLimitExceeded`,
 * which `DRIVE-API-FACTS.md` §6 documents (verified against Google's own
 * error-reference docs) as an equally transient reason. Classifying it as
 * `unknown` instead of `transient` would mean a daily-quota blip neither
 * retries nor tells the user to wait. Fixed here per coordinator ruling;
 * see `TRANSIENT_403_REASONS` below for the explicit, readable set this
 * uses instead of a pattern.
 *
 * The googleapis Node client throws a `GaxiosError` (gaxios 7.1.4), never a
 * plain `Error`. Three fields matter here:
 *   - `err.status`                                  — HTTP status (number)
 *   - `err.response?.data?.error?.errors?.[0]?.reason` — machine-readable reason
 *   - `err.code`                                    — may be a STRING system
 *     code (`'ECONNRESET'`) or a number; it is NEVER read as an HTTP status
 *     here, because doing so would silently misclassify network-layer
 *     failures under whatever numeric-looking coercion happened to fall out
 *     of a comparison against a string.
 *
 * Never a message-string match: `google-auth-library`'s `oauth2client.js`
 * rewrites error messages during token refresh (`:261-268`), so matching on
 * `err.message` is unreliable by construction. Every check below reads only
 * `status`, the structured `reason`, and (for the refresh-specific case)
 * `response.data.error`, which for a refresh failure is the literal string
 * `"invalid_grant"` — never a rendered/rewritten message.
 *
 * Two behavioural facts shape why classification (this file) and retry
 * (this feature's own code, elsewhere) must both exist:
 *   - gaxios auto-retries only GET/HEAD/PUT/OPTIONS/DELETE — `files.create`
 *     (POST) and `files.update` (PATCH) reach application code un-retried.
 *   - The client's automatic 401-refresh-and-retry is skipped whenever the
 *     request body is a `Readable` stream, which every upload's body is.
 * Neither fact changes classification itself; they are recorded here
 * because they are the reason this module needs to exist at all.
 */

/** The six outcomes `classifyDriveError` can return. */
export const DRIVE_ERROR_KIND = Object.freeze({
  RECONNECT: "reconnect",
  STORAGE_FULL: "storage-full",
  REFUSED: "refused",
  TRANSIENT: "transient",
  GONE: "gone",
  UNKNOWN: "unknown",
});

// 403 reasons that mean "Drive said no" — the user (or their org) refused,
// not a credential problem and not a quota problem.
const REFUSED_REASONS = new Set([
  "insufficientFilePermissions",
  "domainPolicy",
  "appNotAuthorizedToFile",
]);

// 403 reasons that mean "quota/rate limit, back off and retry" — the exact
// four reasons DRIVE-API-FACTS.md §6 documents (verified against Google's
// own error-reference primary source) as equally transient. Listed
// explicitly rather than matched with a pattern like /rateLimitExceeded/i:
// a pattern happens to catch three of these but silently misses
// "dailyLimitExceeded" (it doesn't contain "rate"), which is exactly the
// gap an earlier revision of this file shipped with. An explicit set makes
// the covered reasons readable at a glance and makes adding a future one a
// deliberate edit here, not a hopeful regex coincidence.
const TRANSIENT_403_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "sharingRateLimitExceeded",
  "dailyLimitExceeded",
]);

/** `err.response?.data?.error?.errors?.[0]?.reason`, or undefined. */
function firstReason(err) {
  const reason = err?.response?.data?.error?.errors?.[0]?.reason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * `err.status` only. Deliberately does NOT fall back to `err.code` — see the
 * file-level comment on why that field must never be treated as a status.
 */
function httpStatus(err) {
  return typeof err?.status === "number" ? err.status : undefined;
}

/**
 * A failed *token refresh* reports its error as the bare string
 * `"invalid_grant"` at `err.response.data.error` (not the `errors[]` array
 * shape a Drive API call uses) — see `DRIVE-API-FACTS.md` §7.
 */
function isInvalidGrantRefresh(err) {
  return err?.response?.data?.error === "invalid_grant";
}

/**
 * Classify a Drive API (or token-refresh) failure.
 *
 * @param {unknown} err - the caught error, expected to look like a
 *   `GaxiosError` but never assumed to (this never throws on a malformed or
 *   missing input).
 * @returns {"reconnect"|"storage-full"|"refused"|"transient"|"gone"|"unknown"}
 */
export function classifyDriveError(err) {
  const status = httpStatus(err);
  const reason = firstReason(err);

  // Reconnect: a 401 on the API call, OR a refresh that failed with
  // invalid_grant. Per AC-E9 this is "401 or invalid_grant only, never a
  // message match" — no `reason` check gates it, on purpose: Google does not
  // reliably populate `errors[].reason` on every 401.
  if (status === 401 || isInvalidGrantRefresh(err)) {
    return DRIVE_ERROR_KIND.RECONNECT;
  }

  if (status === 403 && reason === "storageQuotaExceeded") {
    return DRIVE_ERROR_KIND.STORAGE_FULL;
  }

  if (status === 403 && reason !== undefined && REFUSED_REASONS.has(reason)) {
    return DRIVE_ERROR_KIND.REFUSED;
  }

  if (
    status === 429 ||
    (status === 403 && reason !== undefined && TRANSIENT_403_REASONS.has(reason)) ||
    (typeof status === "number" && status >= 500 && status <= 599)
  ) {
    return DRIVE_ERROR_KIND.TRANSIENT;
  }

  if (status === 404 && reason === "notFound") {
    return DRIVE_ERROR_KIND.GONE;
  }

  return DRIVE_ERROR_KIND.UNKNOWN;
}
