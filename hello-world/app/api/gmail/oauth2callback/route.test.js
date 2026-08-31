import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/gmail/gmailClient", () => ({
  createOAuth2Client: vi.fn(),
  saveTokens: vi.fn(),
}));
vi.mock("@/lib/cache/redisClient", () => ({ default: vi.fn(() => null) }));

// `verifyOAuthState` runs for real in every test except the two that need to
// force a specific result out of it (T26). The override lives in a hoisted box
// so the mock factory — which is hoisted above every other statement — can
// reach it, and it is cleared in beforeEach so no test inherits another's stub.
const box = vi.hoisted(() => ({ verifyOverride: null }));
vi.mock("@/lib/oauth/state", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyOAuthState: vi.fn((...args) =>
      box.verifyOverride ? box.verifyOverride(...args) : actual.verifyOAuthState(...args),
    ),
  };
});

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { createOAuth2Client, saveTokens } from "@/lib/gmail/gmailClient";
import getRedisClient from "@/lib/cache/redisClient";
import { createOAuthState } from "@/lib/oauth/state";

const SECRET = "callback-route-oauth-state-secret";
const VICTIM = "d41f7a08-53e2-4c6b-9a17-0be82d5f43c1";
const MALLORY = "6b90e2fd-14a7-4d38-8f52-c73a1e06b8d9";
const CODE = "4/0AVictimAuthorizationCodeMustNeverBeLogged";
const CODE_2 = "4/0ASecondAuthorizationCodeMustNeverBeLogged";
const CODE_3 = "4/0AThirdAuthorizationCodeMustNeverBeLogged";
const TOKENS = {
  access_token: "ya29.victim-access-token-must-never-be-logged",
  refresh_token: "1//victim-refresh-token-must-never-be-logged",
  expiry_date: 4102444800000,
};

const ENV_KEYS = ["OAUTH_STATE_SECRET", "GOOGLE_CLIENT_SECRET"];
let savedEnv = {};
let getToken;
let warnSpy;
let errorSpy;

// An in-memory Upstash stand-in honouring SET <key> 1 NX EX <ttl>. `nx` is what
// makes the replay claim atomic, so the fake models exactly that and nothing else.
function makeFakeRedis() {
  const store = new Map();
  return {
    store,
    set: vi.fn(async (key, value, opts) => {
      if (opts && opts.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  };
}

/** The exact shape of the pre-fix state: an unsigned, unbound, forgeable blob. */
function legacyState(userId) {
  return Buffer.from(JSON.stringify({ userId })).toString("base64url");
}

function splitState(state) {
  const i = state.lastIndexOf(".");
  return { payload: state.slice(0, i), mac: state.slice(i + 1) };
}

function mint({ userId = VICTIM, sessionId = "sess-victim", provider = "gmail" } = {}) {
  return createOAuthState({ provider, userId, sessionId });
}

function signedInAs(userId, sessionId = "sess-victim") {
  const opts = userId === null ? { user: null } : { user: { id: userId } };
  if (sessionId !== undefined && sessionId !== null) opts.claims = { session_id: sessionId };
  createClient.mockResolvedValue(makeSupabase({}, opts));
}

function callbackRequest({ code, state, error } = {}) {
  const params = new URLSearchParams();
  if (code !== undefined) params.set("code", code);
  if (state !== undefined) params.set("state", state);
  if (error !== undefined) params.set("error", error);
  return new Request(`http://localhost:3000/api/gmail/oauth2callback?${params.toString()}`);
}

/**
 * "Reject" is defined observably: no token write, and a redirect whose Location
 * carries gmail_status=error. The status number is deliberately not asserted
 * here — NextResponse.redirect defaults to 307 and adding an explicit status
 * argument would be a user-visible behaviour change.
 */
function gmailStatus(res) {
  const location = res.headers.get("location");
  return location ? new URL(location).searchParams.get("gmail_status") : null;
}

// Flatten everything that reached the console into one searchable blob, keeping
// BOTH representations of each argument so a secret cannot hide inside an Error
// message that JSON.stringify would have flattened to "{}".
function describeArg(a) {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name} ${a.message} ${a.stack ?? ""}`;
  let serialised = "";
  try {
    serialised = JSON.stringify(a) ?? "";
  } catch {
    serialised = "";
  }
  return `${String(a)} ${serialised}`;
}

function loggedText() {
  return [...warnSpy.mock.calls, ...errorSpy.mock.calls]
    .map((args) => args.map(describeArg).join(" "))
    .join("\n");
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OAUTH_STATE_SECRET = SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;

  box.verifyOverride = null;

  createClient.mockReset();

  // mockReset, not mockClear: several tests below install a rejecting getToken
  // or a resolved-value saveTokens, and this config sets neither `clearMocks`
  // nor `restoreMocks`.
  saveTokens.mockReset();
  saveTokens.mockResolvedValue(undefined);

  getToken = vi.fn(async () => ({ tokens: TOKENS }));
  createOAuth2Client.mockReset();
  createOAuth2Client.mockReturnValue({ getToken });

  getRedisClient.mockReset();
  getRedisClient.mockReturnValue(makeFakeRedis());

  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("GET /api/gmail/oauth2callback", () => {
  it("T12: never binds the victim's Google tokens to a user id carried in the state", async () => {
    // Variant A. Mallory hand-rolls a state naming herself and sends the victim
    // a genuine Google consent link. The victim clicks Allow; Google delivers
    // the VICTIM's authorization code alongside MALLORY's state.
    signedInAs(VICTIM);

    const res = await GET(callbackRequest({ code: CODE, state: legacyState(MALLORY) }));

    expect(saveTokens.mock.calls).toEqual([]);
    expect(gmailStatus(res)).toBe("error");
  });

  it("T13: never binds tokens to a victim id carried in the state", async () => {
    // Variant B. Mallory completes consent with her own Google account while
    // presenting a state naming the victim, injecting her mailbox into their data.
    signedInAs(MALLORY, "sess-mallory");

    const res = await GET(callbackRequest({ code: CODE, state: legacyState(VICTIM) }));

    expect(saveTokens.mock.calls).toEqual([]);
    expect(gmailStatus(res)).toBe("error");
  });

  it("T14: rejects without exchanging the code when there is no session", async () => {
    signedInAs(null);

    // A validly minted state proves the rejection is caused by the missing
    // session and not by the state...
    const minted = await GET(callbackRequest({ code: CODE, state: mint() }));
    // ...and a legacy state proves the pre-fix path is closed.
    const legacy = await GET(callbackRequest({ code: CODE_2, state: legacyState(VICTIM) }));

    expect(getToken.mock.calls).toEqual([]);
    expect(saveTokens.mock.calls).toEqual([]);
    expect(gmailStatus(minted)).toBe("error");
    expect(gmailStatus(legacy)).toBe("error");
  });

  it("T15: rejects a forged state even though the session is valid", async () => {
    signedInAs(VICTIM);
    const { payload } = splitState(mint());

    // A well-formed payload segment with no MAC segment at all. Note it decodes
    // to JSON naming the session's own user — so a handler that trusts the
    // state's contents accepts it, and one that requires a signature does not.
    const unsigned = await GET(callbackRequest({ code: CODE, state: payload }));
    // A payload segment carrying a 32-byte MAC of the wrong bytes.
    const badMac = await GET(
      callbackRequest({ code: CODE_2, state: `${payload}.${randomBytes(32).toString("base64url")}` }),
    );

    expect(getToken.mock.calls).toEqual([]);
    expect(saveTokens.mock.calls).toEqual([]);
    expect(gmailStatus(unsigned)).toBe("error");
    expect(gmailStatus(badMac)).toBe("error");
  });

  it("T15b: rejects a validly signed state minted for a different binding", async () => {
    signedInAs(VICTIM);

    const otherUser = await GET(callbackRequest({ code: CODE, state: mint({ userId: MALLORY }) }));
    const otherSession = await GET(callbackRequest({ code: CODE_2, state: mint({ sessionId: "sess-other" }) }));
    const otherProvider = await GET(callbackRequest({ code: CODE_3, state: mint({ provider: "not-gmail" }) }));

    expect(getToken.mock.calls).toEqual([]);
    expect(saveTokens.mock.calls).toEqual([]);
    expect(gmailStatus(otherUser)).toBe("error");
    expect(gmailStatus(otherSession)).toBe("error");
    expect(gmailStatus(otherProvider)).toBe("error");
  });

  it("T16: accepts a state once and rejects the second use", async () => {
    signedInAs(VICTIM);
    const state = mint();

    const first = await GET(callbackRequest({ code: CODE, state }));
    const second = await GET(callbackRequest({ code: CODE_2, state }));

    expect(gmailStatus(first)).toBe("connected");
    expect(gmailStatus(second)).toBe("error");
    expect(getToken.mock.calls).toEqual([[CODE]]);
    expect(saveTokens.mock.calls).toEqual([[VICTIM, TOKENS]]);
  });

  it("T16b: a re-encoded MAC segment is the same single use, in both directions", async () => {
    // Node's base64url decoder ignores padding, so `mac` and `mac + "="` are
    // distinct strings that decode to byte-identical MACs. Replaying the
    // identical string would never detect a raw-string replay key; this does.
    signedInAs(VICTIM);

    const first = mint();
    const firstPadded = `${splitState(first).payload}.${splitState(first).mac}=`;
    expect(firstPadded).not.toBe(first);

    const canonicalThenPadded = [
      await GET(callbackRequest({ code: CODE, state: first })),
      await GET(callbackRequest({ code: CODE_2, state: firstPadded })),
    ];

    const second = mint();
    const secondPadded = `${splitState(second).payload}.${splitState(second).mac}=`;

    const paddedThenCanonical = [
      await GET(callbackRequest({ code: CODE_3, state: secondPadded })),
      await GET(callbackRequest({ code: CODE_2, state: second })),
    ];

    expect(canonicalThenPadded.map(gmailStatus)).toEqual(["connected", "error"]);
    expect(paddedThenCanonical.map(gmailStatus)).toEqual(["connected", "error"]);
    expect(getToken.mock.calls).toEqual([[CODE], [CODE_3]]);
    expect(saveTokens.mock.calls).toEqual([
      [VICTIM, TOKENS],
      [VICTIM, TOKENS],
    ]);
  });

  it("T17: the happy path stores tokens against the session's user", async () => {
    signedInAs(VICTIM);

    const res = await GET(callbackRequest({ code: CODE, state: mint() }));

    expect(res.status).toBe(307);
    expect(gmailStatus(res)).toBe("connected");
    expect(getToken.mock.calls).toEqual([[CODE]]);
    expect(saveTokens.mock.calls).toEqual([[VICTIM, TOKENS]]);
  });

  it("T17b: the happy path also works when no session id is available", async () => {
    // getClaims() yields null data on a transient auth-server blip. A state
    // minted without a session id must still complete, or connecting becomes
    // flaky for every legitimate user on an HS256 project.
    createClient.mockResolvedValue(makeSupabase({}, { user: { id: VICTIM } }));

    const res = await GET(callbackRequest({ code: CODE, state: mint({ sessionId: null }) }));

    expect(gmailStatus(res)).toBe("connected");
    expect(saveTokens.mock.calls).toEqual([[VICTIM, TOKENS]]);
  });

  it("T18: a denied consent still redirects with gmail_status=denied", async () => {
    // No session configured: the denial branch must not depend on one.
    signedInAs(null);

    const res = await GET(callbackRequest({ error: "access_denied" }));

    expect(res.status).toBe(307);
    expect(gmailStatus(res)).toBe("denied");
    expect(getToken.mock.calls).toEqual([]);
    expect(saveTokens.mock.calls).toEqual([]);
  });

  it("T19: logs a reason on rejection and never the state, code or tokens", async () => {
    signedInAs(VICTIM);
    const state = legacyState(MALLORY);

    const res = await GET(callbackRequest({ code: CODE, state }));

    expect(gmailStatus(res)).toBe("error");
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    const text = loggedText();
    expect(text).toMatch(
      /missing|malformed|bad-signature|expired|wrong-provider|wrong-user|wrong-session|replayed|no-secret/,
    );
    expect(text).not.toContain(state);
    expect(text).not.toContain(CODE);
    expect(text).not.toContain(TOKENS.access_token);
    expect(text).not.toContain(TOKENS.refresh_token);
  });

  it("T26: rejects when the verifier says so, and proceeds when it says so", async () => {
    // Catches `if (result)` written where `if (result.ok)` was meant: an
    // {ok:false} object is truthy, and so is an un-awaited Promise.
    signedInAs(VICTIM);
    box.verifyOverride = async () => ({ ok: false, reason: "bad-signature" });

    const rejected = await GET(callbackRequest({ code: CODE, state: legacyState(VICTIM) }));

    expect(getToken.mock.calls).toEqual([]);
    expect(saveTokens.mock.calls).toEqual([]);
    expect(gmailStatus(rejected)).toBe("error");

    // Positive control: the route must be reading the verifier's verdict, not
    // rejecting everything and not verifying inline.
    box.verifyOverride = async () => ({ ok: true, replayChecked: false });

    const accepted = await GET(callbackRequest({ code: CODE_2, state: legacyState(VICTIM) }));

    expect(gmailStatus(accepted)).toBe("connected");
    expect(saveTokens.mock.calls).toEqual([[VICTIM, TOKENS]]);
  });

  it("T28: a failed code exchange has already burned the state", async () => {
    // The replay claim runs BEFORE getToken, so two concurrent callbacks can
    // never both reach the exchange. The cost is that a Google-side failure
    // burns the state; the benefit is that the single-use claim is real.
    signedInAs(VICTIM);
    const state = mint();

    getToken.mockReset();
    getToken.mockRejectedValue(new Error("invalid_grant"));

    const first = await GET(callbackRequest({ code: CODE, state }));
    expect(gmailStatus(first)).toBe("error");
    expect(getToken.mock.calls).toEqual([[CODE]]);

    const second = await GET(callbackRequest({ code: CODE_2, state }));
    expect(gmailStatus(second)).toBe("error");
    expect(getToken.mock.calls).toEqual([[CODE]]);
    expect(saveTokens.mock.calls).toEqual([]);
  });

  it("T7-route: an unavailable replay store never turns a bad state into a good one", async () => {
    getRedisClient.mockReset();
    getRedisClient.mockReturnValue(null);
    signedInAs(VICTIM);
    const { payload } = splitState(mint());

    const forged = await GET(callbackRequest({ code: CODE, state: payload }));
    const wrongUser = await GET(callbackRequest({ code: CODE_2, state: mint({ userId: MALLORY }) }));

    expect(saveTokens.mock.calls).toEqual([]);
    expect(getToken.mock.calls).toEqual([]);
    expect(gmailStatus(forged)).toBe("error");
    expect(gmailStatus(wrongUser)).toBe("error");

    // ...and a legitimate callback still completes, degraded to a TTL-bounded
    // window rather than failing.
    const good = await GET(callbackRequest({ code: CODE_3, state: mint() }));
    expect(gmailStatus(good)).toBe("connected");
    expect(saveTokens.mock.calls).toEqual([[VICTIM, TOKENS]]);
  });
});
