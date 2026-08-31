import { describe, it, expect } from "vitest";
import { classifyDriveError, DRIVE_ERROR_KIND } from "./driveErrors.js";

// Fixtures shaped like the REAL `GaxiosError` (gaxios 7.1.4), per
// DRIVE-API-FACTS.md §5-7 — not a simplified `{status}` stub. `name` is set
// to `GaxiosError` for realism even though classifyDriveError never checks
// it (duck-typed on purpose, so it also works against a plain mock).
function apiError({ status, reason, message = "Request failed" } = {}) {
  const err = new Error(message);
  err.name = "GaxiosError";
  if (status !== undefined) err.status = status;
  if (reason !== undefined) {
    err.response = { data: { error: { errors: [{ domain: "usageLimits", reason, message }] } } };
  }
  return err;
}

// The refresh-failure shape is DIFFERENT from the API-call shape: the error
// is the bare string "invalid_grant" at response.data.error, not an
// errors[] array (DRIVE-API-FACTS.md §7). The message is deliberately
// something that does NOT contain "invalid_grant", proving the classifier
// isn't string-matching err.message (oauth2client.js rewrites messages).
function invalidGrantRefreshError() {
  const err = new Error("Bad Request");
  err.name = "GaxiosError";
  err.status = 400;
  err.response = {
    data: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
  };
  return err;
}

describe("classifyDriveError", () => {
  it("classifies a 401 as reconnect, with no reason field present at all", () => {
    // Google does not reliably populate errors[].reason on every 401
    // (AC-E9: "401 ... never a message match" — no reason gate either).
    expect(classifyDriveError(apiError({ status: 401 }))).toBe(DRIVE_ERROR_KIND.RECONNECT);
  });

  it("classifies a 401 with reason=authError as reconnect (positive control for the above)", () => {
    expect(classifyDriveError(apiError({ status: 401, reason: "authError" }))).toBe(
      DRIVE_ERROR_KIND.RECONNECT,
    );
  });

  it("classifies a token-refresh invalid_grant failure as reconnect, without matching err.message", () => {
    expect(classifyDriveError(invalidGrantRefreshError())).toBe(DRIVE_ERROR_KIND.RECONNECT);
  });

  it("does NOT classify a 400 as reconnect merely because it is 400 (only invalid_grant refresh failures do)", () => {
    const err = new Error("Bad Request");
    err.name = "GaxiosError";
    err.status = 400;
    err.response = { data: { error: "some_other_oauth_error" } };
    expect(classifyDriveError(err)).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("does NOT classify by err.message even when it contains the literal text 'invalid_grant'", () => {
    // Guards against a naive `err.message.includes('invalid_grant')`
    // implementation — the spec is explicit that message rewriting by
    // google-auth-library makes message matching unsafe.
    const err = apiError({ status: 500, message: "invalid_grant somewhere in a rewritten message" });
    expect(classifyDriveError(err)).toBe(DRIVE_ERROR_KIND.TRANSIENT); // classified by status, not message
  });

  it("classifies a 403 storageQuotaExceeded as storage-full", () => {
    expect(classifyDriveError(apiError({ status: 403, reason: "storageQuotaExceeded" }))).toBe(
      DRIVE_ERROR_KIND.STORAGE_FULL,
    );
  });

  it("positive control: 403 storageQuotaExceeded is NOT reconnect (AC-C28)", () => {
    const kind = classifyDriveError(apiError({ status: 403, reason: "storageQuotaExceeded" }));
    expect(kind).not.toBe(DRIVE_ERROR_KIND.RECONNECT);
    expect(kind).toBe(DRIVE_ERROR_KIND.STORAGE_FULL);
  });

  it("classifies a 403 insufficientFilePermissions as refused", () => {
    expect(
      classifyDriveError(apiError({ status: 403, reason: "insufficientFilePermissions" })),
    ).toBe(DRIVE_ERROR_KIND.REFUSED);
  });

  it("classifies a 403 domainPolicy as refused", () => {
    expect(classifyDriveError(apiError({ status: 403, reason: "domainPolicy" }))).toBe(
      DRIVE_ERROR_KIND.REFUSED,
    );
  });

  it("classifies a 403 appNotAuthorizedToFile as refused", () => {
    expect(classifyDriveError(apiError({ status: 403, reason: "appNotAuthorizedToFile" }))).toBe(
      DRIVE_ERROR_KIND.REFUSED,
    );
  });

  it("positive control: refused and storage-full render as different kinds (AC-E10 depends on this)", () => {
    const refused = classifyDriveError(apiError({ status: 403, reason: "domainPolicy" }));
    const full = classifyDriveError(apiError({ status: 403, reason: "storageQuotaExceeded" }));
    expect(refused).not.toBe(full);
  });

  it("classifies a bare 429 as transient", () => {
    expect(classifyDriveError(apiError({ status: 429 }))).toBe(DRIVE_ERROR_KIND.TRANSIENT);
  });

  it("classifies a 403 userRateLimitExceeded as transient", () => {
    expect(classifyDriveError(apiError({ status: 403, reason: "userRateLimitExceeded" }))).toBe(
      DRIVE_ERROR_KIND.TRANSIENT,
    );
  });

  it("classifies a 403 rateLimitExceeded (unprefixed) as transient", () => {
    expect(classifyDriveError(apiError({ status: 403, reason: "rateLimitExceeded" }))).toBe(
      DRIVE_ERROR_KIND.TRANSIENT,
    );
  });

  it("classifies a 403 sharingRateLimitExceeded as transient", () => {
    expect(classifyDriveError(apiError({ status: 403, reason: "sharingRateLimitExceeded" }))).toBe(
      DRIVE_ERROR_KIND.TRANSIENT,
    );
  });

  it("classifies a 403 dailyLimitExceeded as transient (coordinator ruling: ARCH.md §8.3's literal pattern was wrong)", () => {
    // DRIVE-API-FACTS.md §6 documents dailyLimitExceeded alongside the
    // other *RateLimitExceeded reasons as equally transient, even though it
    // doesn't contain "rate" and so was missed by an earlier, pattern-based
    // implementation. Explicitly listed in TRANSIENT_403_REASONS now.
    expect(classifyDriveError(apiError({ status: 403, reason: "dailyLimitExceeded" }))).toBe(
      DRIVE_ERROR_KIND.TRANSIENT,
    );
  });

  it("paired negative control: a genuinely non-transient 403 reason still classifies as refused, not transient", () => {
    // Guards against the widened matcher degenerating into "every 403 is
    // transient" — insufficientFilePermissions must still take the refused
    // path even though it shares the 403 status with every transient case
    // above.
    expect(
      classifyDriveError(apiError({ status: 403, reason: "insufficientFilePermissions" })),
    ).toBe(DRIVE_ERROR_KIND.REFUSED);
  });

  it("all four documented transient 403 reasons classify as transient (DRIVE-API-FACTS.md §6)", () => {
    for (const reason of [
      "rateLimitExceeded",
      "userRateLimitExceeded",
      "sharingRateLimitExceeded",
      "dailyLimitExceeded",
    ]) {
      expect(classifyDriveError(apiError({ status: 403, reason }))).toBe(DRIVE_ERROR_KIND.TRANSIENT);
    }
  });

  it("classifies a 500 as transient", () => {
    expect(classifyDriveError(apiError({ status: 500 }))).toBe(DRIVE_ERROR_KIND.TRANSIENT);
  });

  it("classifies a 503 as transient", () => {
    expect(classifyDriveError(apiError({ status: 503 }))).toBe(DRIVE_ERROR_KIND.TRANSIENT);
  });

  it("does not classify a 600 (out of the 5xx range) as transient", () => {
    expect(classifyDriveError(apiError({ status: 600 }))).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("classifies a 404 notFound as gone", () => {
    expect(classifyDriveError(apiError({ status: 404, reason: "notFound" }))).toBe(
      DRIVE_ERROR_KIND.GONE,
    );
  });

  it("does not classify a 404 with a different reason as gone (positive control)", () => {
    expect(classifyDriveError(apiError({ status: 404, reason: "somethingElse" }))).toBe(
      DRIVE_ERROR_KIND.UNKNOWN,
    );
  });

  it("classifies a 404 with no reason at all as unknown, not gone", () => {
    expect(classifyDriveError(apiError({ status: 404 }))).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("classifies an unrecognised 403 reason as unknown, not refused or transient", () => {
    // Real Google reason not in our lists (e.g. teamDriveMembershipRequired).
    const kind = classifyDriveError(apiError({ status: 403, reason: "teamDriveMembershipRequired" }));
    expect(kind).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("does not treat err.code as an HTTP status: a network-layer ECONNRESET (no err.status) is unknown", () => {
    // The real shape: a connection-reset error has no HTTP response at all,
    // so err.status is undefined and err.code is the STRING 'ECONNRESET'.
    const err = new Error("socket hang up");
    err.name = "GaxiosError";
    err.code = "ECONNRESET";
    expect(classifyDriveError(err)).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("does not throw and returns unknown for a numeric err.code that looks like a 5xx status", () => {
    // Guards the exact trap named in the task: err.code may be a NUMBER
    // that happens to look like a status, but it must never be substituted
    // for err.status.
    const err = new Error("weird");
    err.code = 503;
    expect(classifyDriveError(err)).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("returns unknown, without throwing, for undefined input", () => {
    expect(() => classifyDriveError(undefined)).not.toThrow();
    expect(classifyDriveError(undefined)).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("returns unknown, without throwing, for null input", () => {
    expect(classifyDriveError(null)).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("returns unknown, without throwing, for a plain object with no recognisable fields", () => {
    expect(classifyDriveError({})).toBe(DRIVE_ERROR_KIND.UNKNOWN);
  });

  it("exposes exactly the six documented kinds as a frozen constant map", () => {
    expect(DRIVE_ERROR_KIND).toEqual({
      RECONNECT: "reconnect",
      STORAGE_FULL: "storage-full",
      REFUSED: "refused",
      TRANSIENT: "transient",
      GONE: "gone",
      UNKNOWN: "unknown",
    });
    expect(Object.isFrozen(DRIVE_ERROR_KIND)).toBe(true);
  });
});
