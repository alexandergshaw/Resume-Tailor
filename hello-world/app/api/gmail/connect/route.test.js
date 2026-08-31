import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/gmail/gmailClient", () => ({ getAuthUrl: vi.fn() }));
// No replay store in these tests: the connect route mints, it never verifies,
// and a live store would make the order of the assertions below significant.
vi.mock("@/lib/cache/redisClient", () => ({ default: vi.fn(() => null) }));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { getAuthUrl } from "@/lib/gmail/gmailClient";
import getRedisClient from "@/lib/cache/redisClient";
import { verifyOAuthState } from "@/lib/oauth/state";

const SECRET = "connect-route-oauth-state-secret";
const USER_ID = "3f2a91c4-7b6d-4e18-9c05-2a8f14d7be63";
const OTHER_USER_ID = "8c41d0ab-2e35-4f97-b1d6-59034ec7a218";

const ENV_KEYS = ["OAUTH_STATE_SECRET", "GOOGLE_CLIENT_SECRET"];
let savedEnv = {};

function signedIn(opts = {}) {
  const supabase = makeSupabase({}, { user: { id: USER_ID }, ...opts });
  createClient.mockResolvedValue(supabase);
  return supabase;
}

async function connect() {
  return GET(new Request("http://localhost:3000/api/gmail/connect"));
}

// The route's observable output is the redirect it returns. `getAuthUrl` is
// stubbed to fold the state it is handed into a realistic consent URL, so every
// assertion below reads the state back out of the Location header rather than
// out of a call-argument list.
function stateFromRedirect(res) {
  return new URL(res.headers.get("location")).searchParams.get("state");
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OAUTH_STATE_SECRET = SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;

  createClient.mockReset();
  getRedisClient.mockReset();
  getRedisClient.mockReturnValue(null);

  getAuthUrl.mockReset();
  getAuthUrl.mockImplementation(
    (redirectUri, state) =>
      `https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&scope=gmail.readonly&state=${encodeURIComponent(state ?? "")}`,
  );
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("GET /api/gmail/connect", () => {
  it("T20: returns 401 JSON for an unauthenticated caller", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));

    const res = await connect();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getAuthUrl).not.toHaveBeenCalled();
  });

  it("T21: redirects a signed-in caller to Google with a non-empty state", async () => {
    signedIn({ claims: { session_id: "sess-1" } });

    const res = await connect();

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location"));
    expect(location.host).toBe("accounts.google.com");
    expect(stateFromRedirect(res)).toBeTruthy();
  });

  it("T22: the state is not a plaintext user id", async () => {
    signedIn({ claims: { session_id: "sess-1" } });

    const state = stateFromRedirect(await connect());

    // The pre-fix state was base64url('{"userId":"..."}'): decodable by anyone,
    // forgeable by anyone. Neither half of that may survive.
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    } catch {
      decoded = undefined;
    }
    const carriesPlainUserId =
      decoded !== undefined && decoded !== null && typeof decoded === "object" && decoded.userId !== undefined;
    expect(carriesPlainUserId).toBe(false);

    expect(state).not.toContain(USER_ID);
  });

  it("T23: the minted state verifies for this binding and for no other", async () => {
    signedIn({ claims: { session_id: "sess-1" } });

    const state = stateFromRedirect(await connect());

    expect(await verifyOAuthState(state, { provider: "gmail", userId: OTHER_USER_ID, sessionId: "sess-1" })).toEqual({
      ok: false,
      reason: "wrong-user",
    });
    // `provider` is opaque data here — this asserts the field is bound, and
    // pins no behaviour of any second consumer of the shared helper.
    expect(await verifyOAuthState(state, { provider: "not-gmail", userId: USER_ID, sessionId: "sess-1" })).toEqual({
      ok: false,
      reason: "wrong-provider",
    });
    // Positive control: a fix that mints an unverifiable state passes every
    // negative above and is still broken.
    const good = await verifyOAuthState(state, { provider: "gmail", userId: USER_ID, sessionId: "sess-1" });
    expect(good.ok).toBe(true);
  });

  it("T23b: a state minted under one session does not verify under another", async () => {
    // Requires test/helpers/supabaseMock.js to expose auth.getClaims. Without
    // it the route can only ever mint boundSession:false and this assertion
    // passes vacuously — which is exactly the failure mode being guarded.
    signedIn({ claims: { session_id: "sess-1" } });

    const state = stateFromRedirect(await connect());

    expect(await verifyOAuthState(state, { provider: "gmail", userId: USER_ID, sessionId: "sess-2" })).toEqual({
      ok: false,
      reason: "wrong-session",
    });
    expect(await verifyOAuthState(state, { provider: "gmail", userId: USER_ID, sessionId: null })).toEqual({
      ok: false,
      reason: "wrong-session",
    });
  });

  it("T23c: still mints a usable state when the session id is unavailable", async () => {
    // getClaims() falls through to a network call on HS256 projects, so a
    // transient blip legitimately yields null data. Connecting must still work;
    // the userId binding alone already defeats both attack variants.
    signedIn();

    const res = await connect();
    const state = stateFromRedirect(res);

    expect(res.status).toBe(307);
    expect(state).toBeTruthy();
    const good = await verifyOAuthState(state, { provider: "gmail", userId: USER_ID, sessionId: null });
    expect(good.ok).toBe(true);
    // Unbound at mint means unbound at verify, whatever the verify side reports.
    const anySession = await verifyOAuthState(state, { provider: "gmail", userId: USER_ID, sessionId: "sess-7" });
    expect(anySession.ok).toBe(true);
  });
});
