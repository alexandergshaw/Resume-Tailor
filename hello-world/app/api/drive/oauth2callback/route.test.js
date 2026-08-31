import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/drive/driveOAuth", () => ({
  driveConfig: vi.fn(),
  exchangeCode: vi.fn(),
}));
vi.mock("@/lib/drive/driveTokens", () => ({
  saveDriveTokens: vi.fn(),
}));
vi.mock("@/lib/cache/redisClient", () => ({ default: vi.fn(() => null) }));

// verifyDriveOAuthState runs FOR REAL against the shared signer in every test
// except the ones that need a forced verdict (T-verifier-trust below) — same
// hoisted-override idiom the Gmail callback test uses, and for the same
// reason: it proves the route reads the verifier's actual verdict rather
// than hand-rolling a second check or short-circuiting to always-accept.
const box = vi.hoisted(() => ({ verifyOverride: null }));
vi.mock("@/lib/drive/oauthState", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyDriveOAuthState: vi.fn((...args) =>
      box.verifyOverride ? box.verifyOverride(...args) : actual.verifyDriveOAuthState(...args),
    ),
  };
});

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { driveConfig, exchangeCode } from "@/lib/drive/driveOAuth";
import { saveDriveTokens } from "@/lib/drive/driveTokens";
import getRedisClient from "@/lib/cache/redisClient";
import { createDriveOAuthState, stateCookieName } from "@/lib/drive/oauthState";

const SECRET = "drive-callback-route-oauth-state-secret";
const VICTIM = "d41f7a08-53e2-4c6b-9a17-0be82d5f43c1";
const MALLORY = "6b90e2fd-14a7-4d38-8f52-c73a1e06b8d9";
const CODE = "4/0ADriveAuthorizationCodeMustNeverBeLogged";
const TOKENS = { access_token: "ya29.drive-access-token-must-never-be-logged", refresh_token: "1//drive-refresh-token-must-never-be-logged" };
const CONNECTION = { user_id: VICTIM, refresh_token: TOKENS.refresh_token, google_email: null };

const ENV_KEYS = ["OAUTH_STATE_SECRET", "GOOGLE_CLIENT_SECRET"];
let savedEnv = {};
let warnSpy;
let fetchSpy;

function makeFakeRedis() {
  const store = new Map();
  return {
    set: vi.fn(async (key, value, opts) => {
      if (opts && opts.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
  };
}

function signedInAs(userId, sessionId = "sess-victim") {
  const opts = userId === null ? { user: null } : { user: { id: userId } };
  if (sessionId !== undefined && sessionId !== null) opts.claims = { session_id: sessionId };
  createClient.mockResolvedValue(makeSupabase({}, opts));
}

/** Mints Drive's own composed state AND returns the matching cookie nonce —
 * the double-submit pair a genuine connect() call would have produced. */
function mint({ userId = VICTIM, sessionId = "sess-victim" } = {}) {
  return createDriveOAuthState({ userId, sessionId });
}

function callbackRequest({ code, state, error, cookie } = {}) {
  const params = new URLSearchParams();
  if (code !== undefined) params.set("code", code);
  if (state !== undefined) params.set("state", state);
  if (error !== undefined) params.set("error", error);
  const headers = {};
  if (cookie !== undefined) headers.cookie = `${stateCookieName}=${cookie}`;
  return new NextRequest(`http://localhost:3000/api/drive/oauth2callback?${params.toString()}`, { headers });
}

/** The response is HTML, not JSON — read the embedded postMessage payload
 * back out of the body rather than asserting on opaque status codes. */
async function readMessage(res) {
  const body = await res.text();
  const match = body.match(/var message = (\{.*\});/);
  expect(match).toBeTruthy();
  return JSON.parse(match[1]);
}

function setCookieHeader(res) {
  return res.headers.get("set-cookie") || "";
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OAUTH_STATE_SECRET = SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;

  box.verifyOverride = null;

  createClient.mockReset();

  driveConfig.mockReset();
  driveConfig.mockReturnValue({ clientId: "id", clientSecret: "secret", configured: true });

  exchangeCode.mockReset();
  exchangeCode.mockResolvedValue(TOKENS);

  saveDriveTokens.mockReset();
  saveDriveTokens.mockResolvedValue({ connection: CONNECTION, error: null });

  getRedisClient.mockReset();
  getRedisClient.mockReturnValue(makeFakeRedis());

  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ email: "person@example.com" }),
  });
});

afterEach(() => {
  warnSpy.mockRestore();
  fetchSpy.mockRestore();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("GET /api/drive/oauth2callback", () => {
  describe("the state cookie is cleared unconditionally (obligation #1 — no module-level test catches its omission)", () => {
    it("clears the cookie on a SUCCESSFUL callback", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint();

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      const msg = await readMessage(res);
      expect(msg.ok).toBe(true);
      const setCookie = setCookieHeader(res);
      expect(setCookie).toContain(`${stateCookieName}=;`);
      expect(setCookie.toLowerCase()).toContain("max-age=0");
    });

    it("clears the cookie on a REJECTED callback (bad state)", async () => {
      signedInAs(VICTIM);

      const res = await GET(callbackRequest({ code: CODE, state: "garbage", cookie: "whatever" }));

      const msg = await readMessage(res);
      expect(msg.ok).toBe(false);
      const setCookie = setCookieHeader(res);
      expect(setCookie).toContain(`${stateCookieName}=;`);
      expect(setCookie.toLowerCase()).toContain("max-age=0");
    });

    it("clears the cookie even on the config-gate 503", async () => {
      signedInAs(VICTIM);
      driveConfig.mockReturnValue({ clientId: null, clientSecret: null, configured: false });

      const res = await GET(callbackRequest({ code: CODE, state: "irrelevant" }));

      expect(res.status).toBe(503);
      const setCookie = setCookieHeader(res);
      expect(setCookie).toContain(`${stateCookieName}=;`);
    });

    it("clears the cookie on a denied-consent callback", async () => {
      signedInAs(null);

      const res = await GET(callbackRequest({ error: "access_denied" }));

      const msg = await readMessage(res);
      expect(msg.ok).toBe(false);
      expect(msg.reason).toBe("consent-refused");
      expect(setCookieHeader(res)).toContain(`${stateCookieName}=;`);
    });
  });

  describe("the user id comes from the Supabase session, never from state (ARCH.md security shape)", () => {
    it("rejects a state minted for a DIFFERENT user even though the session and cookie both check out for THAT state", async () => {
      // Mallory can never make her own cookie land in the victim's browser
      // (HttpOnly + SameSite=Lax, set only by this app's own /connect
      // response), so the realistic attack surface is narrower than Gmail's
      // was — but the binding check must still be the thing that rejects
      // this, not an accident of the cookie not matching.
      const { state, nonce } = mint({ userId: MALLORY, sessionId: "sess-victim" });
      signedInAs(VICTIM, "sess-victim");

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      const msg = await readMessage(res);
      expect(msg.ok).toBe(false);
      expect(msg.reason).toBe("wrong-user");
      expect(saveDriveTokens).not.toHaveBeenCalled();
      expect(exchangeCode).not.toHaveBeenCalled();
    });

    it("saves tokens under the SESSION's user id, never a value read out of the state payload", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint({ userId: VICTIM });

      await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      expect(saveDriveTokens).toHaveBeenCalledTimes(1);
      expect(saveDriveTokens.mock.calls[0][0]).toBe(VICTIM);
    });

    it("a state minted under one session does not verify under a different one", async () => {
      const { state, nonce } = mint({ sessionId: "sess-1" });
      signedInAs(VICTIM, "sess-2");

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      expect((await readMessage(res)).reason).toBe("wrong-session");
      expect(saveDriveTokens).not.toHaveBeenCalled();
    });
  });

  it("rejects when there is no session, without exchanging the code", async () => {
    signedInAs(null);
    const { state, nonce } = mint();

    const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

    expect((await readMessage(res)).reason).toBe("no-session");
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(saveDriveTokens).not.toHaveBeenCalled();
  });

  it("rejects a well-formed but cookie-mismatched state (the double-submit nonce doesn't match)", async () => {
    signedInAs(VICTIM);
    const { state } = mint();

    const res = await GET(callbackRequest({ code: CODE, state, cookie: "not-the-real-nonce" }));

    expect((await readMessage(res)).reason).toBe("nonce-mismatch");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects with NO cookie present at all (e.g. a replayed link after the cookie was already cleared)", async () => {
    signedInAs(VICTIM);
    const { state } = mint();

    const res = await GET(callbackRequest({ code: CODE, state }));

    expect((await readMessage(res)).reason).toBe("nonce-mismatch");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects a Gmail-provider state even with a matching user/session/cookie", async () => {
    const { createOAuthState } = await import("@/lib/oauth/state");
    signedInAs(VICTIM);
    // Hand-build a gmail-provider state with Drive's nonce embedded, so the
    // ONLY thing that can reject it is the provider check.
    const nonce = "shared-nonce-value";
    const gmailState = createOAuthState({ provider: "gmail", userId: VICTIM, sessionId: "sess-victim", nonce });

    const res = await GET(callbackRequest({ code: CODE, state: gmailState, cookie: nonce }));

    expect((await readMessage(res)).reason).toBe("wrong-provider");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("verifies state BEFORE exchanging the code: a rejected state never reaches exchangeCode", async () => {
    signedInAs(VICTIM);

    await GET(callbackRequest({ code: CODE, state: "not-even-well-formed" }));

    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects when the state verifies but no authorization code was supplied", async () => {
    signedInAs(VICTIM);
    const { state, nonce } = mint();

    const res = await GET(callbackRequest({ state, cookie: nonce }));

    expect((await readMessage(res)).reason).toBe("missing-code");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("a denied consent rejects as 'consent-refused' even without a session, and never calls exchangeCode", async () => {
    signedInAs(null);

    const res = await GET(callbackRequest({ error: "access_denied" }));

    expect((await readMessage(res)).reason).toBe("consent-refused");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("returns 503 drive_unconfigured, as JSON, when Google credentials are unset", async () => {
    signedInAs(VICTIM);
    driveConfig.mockReturnValue({ clientId: null, clientSecret: null, configured: false });

    const res = await GET(callbackRequest({ code: CODE, state: "irrelevant" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "drive_unconfigured", configured: false });
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects when the code exchange throws, without ever calling saveDriveTokens", async () => {
    signedInAs(VICTIM);
    const { state, nonce } = mint();
    exchangeCode.mockRejectedValue(new Error("invalid_grant"));

    const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

    expect((await readMessage(res)).reason).toBe("token-unreadable");
    expect(saveDriveTokens).not.toHaveBeenCalled();
  });

  describe("AC-C17 / the Gmail read-back guard: a persistence failure is reported, never silently 'connected'", () => {
    it("reports failure when saveDriveTokens' read-back finds no connection, even with no error message attached", async () => {
      // Deliberately {connection:null, error:null} rather than pairing the
      // miss with an error string — the real saveDriveTokens always sets one
      // together with a null connection, so a route that branches ONLY on
      // `error` (dropping the `!connection` half) would pass every other
      // test in this file yet still silently report "connected" over a
      // write that never actually landed. This is the one case that isolates
      // that half of the guard.
      signedInAs(VICTIM);
      const { state, nonce } = mint();
      saveDriveTokens.mockResolvedValue({ connection: null, error: null });

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      const msg = await readMessage(res);
      expect(msg.ok).toBe(false);
      expect(msg.reason).toBe("drive_storage_unavailable");
    });

    it("reports failure when saveDriveTokens' underlying write errors (e.g. 42P01)", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint();
      saveDriveTokens.mockResolvedValue({ connection: null, error: "relation \"drive_connections\" does not exist" });

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      expect((await readMessage(res)).ok).toBe(false);
    });

    it("positive control: a confirmed write reports ok:true", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint();

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      const msg = await readMessage(res);
      expect(msg.ok).toBe(true);
      expect(msg.source).toBe("drive-oauth");
    });
  });

  describe("the postMessage target origin is exact, never '*'", () => {
    it("embeds this request's own origin as the postMessage target and never a wildcard", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint();

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));
      const body = await res.text();

      expect(body).toContain('postMessage(message, "http://localhost:3000")');
      expect(body).not.toContain('postMessage(message, "*")');
    });
  });

  it("never returns an HTTP redirect (3xx) on the primary success/reject paths — AC-C12", async () => {
    signedInAs(VICTIM);
    const { state, nonce } = mint();

    const success = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));
    const rejected = await GET(callbackRequest({ code: CODE, state: "garbage" }));

    expect(success.status).toBe(200);
    expect(rejected.status).toBe(200);
  });

  it("logs a reason on rejection and never the state, code, or tokens", async () => {
    signedInAs(VICTIM);
    const { state } = mint({ userId: MALLORY });

    await GET(callbackRequest({ code: CODE, state, cookie: "some-nonce" }));

    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const logged = warnSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toMatch(/wrong-user|nonce-mismatch/);
    expect(logged).not.toContain(state);
    expect(logged).not.toContain(CODE);
    expect(logged).not.toContain(TOKENS.access_token);
    expect(logged).not.toContain(TOKENS.refresh_token);
  });

  describe("the verifier's verdict is actually read, not hand-rolled or short-circuited", () => {
    it("rejects when the verifier says so, even for an otherwise well-formed state", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint();
      box.verifyOverride = async () => ({ ok: false, reason: "expired" });

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      expect((await readMessage(res)).reason).toBe("expired");
      expect(exchangeCode).not.toHaveBeenCalled();
    });

    it("positive control: proceeds when the verifier says ok:true", async () => {
      signedInAs(VICTIM);
      box.verifyOverride = async () => ({ ok: true });

      const res = await GET(callbackRequest({ code: CODE, state: "anything-the-real-verifier-would-reject" }));

      expect((await readMessage(res)).ok).toBe(true);
      expect(exchangeCode).toHaveBeenCalledTimes(1);
    });
  });

  describe("saveDriveTokens' extra fields (email) never overwrite the merge with a bad value", () => {
    it("passes googleEmail through as extra fields when the userinfo lookup succeeds", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint();

      await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      expect(saveDriveTokens).toHaveBeenCalledWith(VICTIM, TOKENS, { googleEmail: "person@example.com" });
    });

    it("omits the googleEmail key entirely (never null) when the userinfo lookup fails, so a merge never wipes a stored email", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint();
      fetchSpy.mockResolvedValue({ ok: false, json: async () => ({}) });

      await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      expect(saveDriveTokens).toHaveBeenCalledWith(VICTIM, TOKENS, {});
    });

    it("a network failure fetching the email does not fail the connection itself", async () => {
      signedInAs(VICTIM);
      const { state, nonce } = mint();
      fetchSpy.mockRejectedValue(new Error("network down"));

      const res = await GET(callbackRequest({ code: CODE, state, cookie: nonce }));

      expect((await readMessage(res)).ok).toBe(true);
    });
  });
});

// WAVE4-SEAMS.md MAJOR-3: this route's `reason` vocabulary is a THIRD
// contract-with-no-counterparty in this feature (after `google_email` vs
// `email`, and a string-vs-descriptor mismatch). Three of the fifteen
// reasons it can emit were near-misses of lib/drive/driveMessages.js's
// settled, closed copy table -- "denied" vs "consent-refused",
// "token-exchange-failed" vs "token-unreadable", "storage" vs
// "drive_storage_unavailable" -- now aligned above. This test does not
// trust that alignment by inspection: it re-derives the FULL reason
// vocabulary from the actual source of every module that can produce one
// (this route's own hardcoded literals, PLUS the two state-verification
// modules whose `.reason` this route forwards verbatim without ever
// spelling it out itself), and asserts each one still resolves through
// driveErrorMessage() to real UX copy. A fourth near-miss -- a new reason
// string added here or in either state module without a matching table
// entry -- reds this test instead of shipping unnoticed.
describe("reason vocabulary — every value the callback can emit resolves in the settled table (MAJOR-3)", () => {
  it("enumerates every reason string from source and asserts membership via driveErrorMessage()", async () => {
    const { driveErrorMessage } = await import("@/lib/drive/driveMessages");

    const routeSource = readFileSync(
      path.join(process.cwd(), "app/api/drive/oauth2callback/route.js"),
      "utf8",
    );
    const driveStateSource = readFileSync(
      path.join(process.cwd(), "lib/drive/oauthState.js"),
      "utf8",
    );
    const sharedStateSource = readFileSync(path.join(process.cwd(), "lib/oauth/state.js"), "utf8");

    // This route's own hardcoded reasons -- everything it passes to
    // respondHtml(origin, false, "<literal>"). Deliberately excludes the
    // one call site that forwards a VARIABLE (verified.reason) rather than
    // a literal -- that vocabulary is pulled from the state modules below
    // instead, so nothing here has to be manually re-typed and kept in
    // sync by hand.
    const hardcodedReasons = [
      ...routeSource.matchAll(/respondHtml\(origin,\s*false,\s*"([^"]+)"\)/g),
    ].map((m) => m[1]);

    // Every reason lib/drive/oauthState.js and lib/oauth/state.js can
    // themselves produce (`{ ok: false, reason: "…" }`), which this route
    // forwards verbatim as `verified.reason` without ever spelling the
    // individual strings out itself.
    const reasonLiteral = /reason:\s*"([^"]+)"/g;
    const driveStateReasons = [...driveStateSource.matchAll(reasonLiteral)].map((m) => m[1]);
    const sharedStateReasons = [...sharedStateSource.matchAll(reasonLiteral)].map((m) => m[1]);

    const allReasons = [...new Set([...hardcodedReasons, ...driveStateReasons, ...sharedStateReasons])];

    // Sanity control: prove the extraction actually found exactly the
    // fifteen known reasons rather than silently matching nothing (or
    // silently matching fewer, e.g. a reason literal deleted from source) --
    // an empty array would make the loop below vacuously pass, and a loose
    // ">=" bound would not catch a shrink. WAVE4-REVERIFY.md MINOR-5.
    expect(allReasons.length).toBe(15);
    expect(allReasons).toContain("consent-refused");
    expect(allReasons).toContain("nonce-mismatch");
    expect(allReasons).toContain("wrong-user");

    for (const reason of allReasons) {
      const message = driveErrorMessage(reason);
      expect(message, `driveErrorMessage(${JSON.stringify(reason)}) resolved to null -- no copy for a reason this callback can actually emit`).not.toBeNull();
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("positive control: the extraction rejects a reason with no table entry, so the loop above is not vacuous", async () => {
    const { driveErrorMessage } = await import("@/lib/drive/driveMessages");
    expect(driveErrorMessage("this-reason-does-not-exist")).toBeNull();
  });

  it("the three previously near-missed reasons now match the settled keys exactly", async () => {
    const routeSource = readFileSync(
      path.join(process.cwd(), "app/api/drive/oauth2callback/route.js"),
      "utf8",
    );
    expect(routeSource).toContain('"consent-refused"');
    expect(routeSource).toContain('"token-unreadable"');
    expect(routeSource).toContain('"drive_storage_unavailable"');
    // And the old near-miss spellings are gone, not just supplemented.
    expect(routeSource).not.toMatch(/respondHtml\(origin,\s*false,\s*"denied"\)/);
    expect(routeSource).not.toMatch(/respondHtml\(origin,\s*false,\s*"token-exchange-failed"\)/);
    expect(routeSource).not.toMatch(/respondHtml\(origin,\s*false,\s*"storage"\)/);
  });
});
