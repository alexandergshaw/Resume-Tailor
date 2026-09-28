// U2 (plan §4) — getAuthenticatedClient, the SEAM (M1). Binds AC-1 / AC-4 / AC-11.
//
// On HEAD getAuthenticatedClient returns `null` on BOTH the no-tokens path
// (gmailClient.js:80) and the refresh-failure path (:91-93, `catch { return null }`),
// and the refresh catch logs NOTHING. So the function has exactly one failure
// output today and the discriminating information is discarded — the information
// loss this chunk exists to end. Every assertion below therefore fails RED on HEAD:
// a returned `null` is neither `{ok:false, cause}` nor `{ok:true, client}`, and no
// console.error carries a logCode.
//
// THE S-3 TRAP, and why every refresh fixture sets a near-expiry token:
// getAuthenticatedClient calls refreshAccessToken() ONLY inside the near-expiry
// guard `tokens.expiry_date - Date.now() < 5 * 60 * 1000` (gmailClient.js:86). A
// fixture with a far-future expiry never enters the try/catch at all — it returns
// the client without ever exercising the classifier, so the test would pass
// vacuously. Every refresh fixture here sets expiry_date to now + 60s so the guard
// fires and the refresh path is actually reached.
//
// This is a UNIT test of the real production module (not a mock of it): we mock
// gmailClient's three dependencies (googleapis, the token cache, the env) and drive
// the real getAuthenticatedClient. Driving the real function is the point — a test
// that imported a private helper would be testing an entry point no route reaches.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Sentinels that MUST NOT appear in any server log line (AC-11). If the operator
// log interpolates err.message / the token / a stack, these strings surface.
const ACCESS_TOKEN = "ya29.SENTINEL-ACCESS-TOKEN-must-never-be-logged";
const REFRESH_TOKEN = "1//SENTINEL-REFRESH-TOKEN-must-never-be-logged";
const RAW_ERROR_MESSAGE = "SENTINEL raw provider message must never reach a log or the client";

const box = vi.hoisted(() => ({ refreshImpl: null }));

// Mock googleapis: a constructor whose refreshAccessToken defers to the per-test box.
vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        async refreshAccessToken() {
          return box.refreshImpl();
        }
      },
    },
    gmail: vi.fn(),
  },
}));

// Mock the token cache. getCached returns whatever a test stored; setCached is a noop.
const cacheBox = vi.hoisted(() => ({ raw: null }));
vi.mock("../cache/jobCache", () => ({
  getCached: vi.fn(async () => cacheBox.raw),
  setCached: vi.fn(async () => {}),
}));

// Mock the env so createOAuth2Client has credentials.
vi.mock("../config/env", () => ({
  getServerEnv: vi.fn(() => ({ googleClientId: "client-id", googleClientSecret: "client-secret" })),
}));

import { getAuthenticatedClient } from "./gmailClient.js";

const REDIRECT = "http://localhost:3000/api/gmail/oauth2callback";

// A stored token that is WITHIN the 5-minute near-expiry window (S-3), so the
// refresh path is actually entered.
function nearExpiryTokens() {
  return {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    expiry_date: Date.now() + 60 * 1000,
  };
}

// Provider-rejection error per research R-1: response defined, string OAuth code.
function providerRejection(oauthCode) {
  const err = new Error(RAW_ERROR_MESSAGE);
  err.response = { status: 400, data: { error: oauthCode, error_description: "no longer valid" } };
  err.code = 400;
  return err;
}

// Network error per research R-2: response undefined.
function networkFailure() {
  const err = new Error(RAW_ERROR_MESSAGE);
  err.response = undefined;
  err.code = "ECONNREFUSED";
  return err;
}

let errorSpy;

beforeEach(() => {
  cacheBox.raw = null;
  box.refreshImpl = null;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedText() {
  return errorSpy.mock.calls
    .map((args) =>
      args
        .map((a) => {
          if (typeof a === "string") return a;
          if (a instanceof Error) return `${a.name} ${a.message} ${a.stack ?? ""}`;
          try {
            return `${String(a)} ${JSON.stringify(a) ?? ""}`;
          } catch {
            return String(a);
          }
        })
        .join(" "),
    )
    .join("\n");
}

describe("getAuthenticatedClient — preserves the refusal cause instead of collapsing to null (AC-1)", () => {
  it("no stored tokens -> {ok:false, cause:'not_connected'} (an ordinary state, not logged)", async () => {
    cacheBox.raw = null; // loadTokens() -> null
    const result = await getAuthenticatedClient("user-1", REDIRECT);
    expect(result).toEqual({ ok: false, cause: "not_connected" });
    // No-tokens is a normal disconnected state, not an operator alert (design §3.1).
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("a revoked grant (invalid_grant) -> {ok:false, cause:'reauth_required'}", async () => {
    cacheBox.raw = JSON.stringify(nearExpiryTokens());
    box.refreshImpl = () => Promise.reject(providerRejection("invalid_grant"));
    const result = await getAuthenticatedClient("user-1", REDIRECT);
    expect(result).toEqual({ ok: false, cause: "reauth_required" });
  });

  it("a network failure -> {ok:false, cause:'temporarily_unavailable'}", async () => {
    cacheBox.raw = JSON.stringify(nearExpiryTokens());
    box.refreshImpl = () => Promise.reject(networkFailure());
    const result = await getAuthenticatedClient("user-1", REDIRECT);
    expect(result).toEqual({ ok: false, cause: "temporarily_unavailable" });
  });

  it("a revoked grant and a network blip produce DIFFERENT causes, never an identical null (AC-1 core)", async () => {
    // This is the whole point of the chunk: the two failure classes must be
    // distinguishable out of the function. On HEAD both are `null`.
    cacheBox.raw = JSON.stringify(nearExpiryTokens());

    box.refreshImpl = () => Promise.reject(providerRejection("invalid_grant"));
    const revoked = await getAuthenticatedClient("user-1", REDIRECT);

    box.refreshImpl = () => Promise.reject(networkFailure());
    const blip = await getAuthenticatedClient("user-1", REDIRECT);

    expect(revoked.cause).not.toBe(blip.cause);
    expect(revoked).not.toBeNull();
    expect(blip).not.toBeNull();
  });

  it("a successful proactive refresh -> {ok:true, client} (positive control)", async () => {
    // Control: proves the function does not just always report failure. A build
    // hardwired to {ok:false} fails here.
    cacheBox.raw = JSON.stringify(nearExpiryTokens());
    box.refreshImpl = () =>
      Promise.resolve({ credentials: { access_token: "fresh", refresh_token: REFRESH_TOKEN } });
    const result = await getAuthenticatedClient("user-1", REDIRECT);
    expect(result.ok).toBe(true);
    expect(result.client).toBeTruthy();
  });
});

describe("getAuthenticatedClient — the operator log (AC-4 / AC-11)", () => {
  it("logs a fine discriminant that separates invalid_client (config) from a network blip", async () => {
    cacheBox.raw = JSON.stringify(nearExpiryTokens());

    box.refreshImpl = () => Promise.reject(providerRejection("invalid_client"));
    await getAuthenticatedClient("user-1", REDIRECT);
    const configLog = loggedText();

    errorSpy.mockClear();

    box.refreshImpl = () => Promise.reject(networkFailure());
    await getAuthenticatedClient("user-1", REDIRECT);
    const networkLog = loggedText();

    // invalid_client is the ONLY place a rotated-secret failure is distinguished
    // (F-2 / AC-4). The two log lines must carry different discriminants.
    expect(configLog).toMatch(/invalid_client/);
    expect(networkLog).toMatch(/network/);
    expect(configLog).not.toEqual(networkLog);
  });

  it("NEVER leaks token material, the raw provider message, or a stack into the log (AC-11)", async () => {
    cacheBox.raw = JSON.stringify(nearExpiryTokens());
    box.refreshImpl = () => Promise.reject(providerRejection("invalid_grant"));
    await getAuthenticatedClient("user-1", REDIRECT);

    // POSITIVE CONTROL first, or the not.toContain assertions below are vacuously
    // green against HEAD's `catch { return null }`, which logs nothing at all (an
    // absence assertion is satisfied by a dead feature). The log MUST fire on a
    // refresh failure and MUST carry the fine logCode.
    expect(errorSpy).toHaveBeenCalled();
    const text = loggedText();
    expect(text).toMatch(/invalid_grant/);

    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain(REFRESH_TOKEN);
    expect(text).not.toContain(RAW_ERROR_MESSAGE);
  });
});
