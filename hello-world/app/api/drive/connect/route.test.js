import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/drive/driveOAuth", () => ({
  driveConfig: vi.fn(),
  driveAuthUrl: vi.fn(),
}));
// The state signature runs for real (lib/oauth/state.js), but its replay
// layer must not reach a live store.
vi.mock("@/lib/cache/redisClient", () => ({ default: vi.fn(() => null) }));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { driveConfig, driveAuthUrl } from "@/lib/drive/driveOAuth";
import getRedisClient from "@/lib/cache/redisClient";
import { verifyDriveOAuthState, stateCookieName } from "@/lib/drive/oauthState";

const SECRET = "drive-connect-route-oauth-state-secret";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

const ENV_KEYS = ["OAUTH_STATE_SECRET", "GOOGLE_CLIENT_SECRET"];
let savedEnv = {};

function signedIn(opts = {}) {
  const supabase = makeSupabase({}, { user: { id: USER_ID }, ...opts });
  createClient.mockResolvedValue(supabase);
  return supabase;
}

async function connect() {
  return GET(new Request("http://localhost:3000/api/drive/connect"));
}

function stateFromRedirect(res) {
  return new URL(res.headers.get("location")).searchParams.get("state");
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OAUTH_STATE_SECRET = SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;

  createClient.mockReset();

  driveConfig.mockReset();
  driveConfig.mockReturnValue({ clientId: "id", clientSecret: "secret", configured: true });

  driveAuthUrl.mockReset();
  driveAuthUrl.mockImplementation(
    (redirectUri, state) =>
      `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&state=${encodeURIComponent(state ?? "")}`,
  );

  getRedisClient.mockReset();
  getRedisClient.mockReturnValue(null);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("GET /api/drive/connect", () => {
  it("returns 401 JSON for an unauthenticated caller and never calls driveAuthUrl", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));

    const res = await connect();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(driveAuthUrl).not.toHaveBeenCalled();
    expect(driveConfig).not.toHaveBeenCalled();
  });

  it("checks auth BEFORE configuration: unauthenticated + unconfigured is still 401, not 503", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));
    driveConfig.mockReturnValue({ clientId: null, clientSecret: null, configured: false });

    const res = await connect();

    expect(res.status).toBe(401);
  });

  it("returns 503 drive_unconfigured for a signed-in caller when Google credentials are unset", async () => {
    signedIn({ claims: { session_id: "sess-1" } });
    driveConfig.mockReturnValue({ clientId: null, clientSecret: null, configured: false });

    const res = await connect();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "drive_unconfigured", configured: false });
    expect(driveAuthUrl).not.toHaveBeenCalled();
  });

  it("redirects a signed-in, configured caller to Google with a non-empty state (defaults to 307)", async () => {
    signedIn({ claims: { session_id: "sess-1" } });

    const res = await connect();

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location"));
    expect(location.host).toBe("accounts.google.com");
    expect(stateFromRedirect(res)).toBeTruthy();
    expect(driveAuthUrl).toHaveBeenCalledTimes(1);
    const [redirectUriArg] = driveAuthUrl.mock.calls[0];
    expect(redirectUriArg).toBe("http://localhost:3000/api/drive/oauth2callback");
  });

  it("sets an HttpOnly, SameSite=Lax, Max-Age=600 drive_oauth_state cookie carrying a nonce", async () => {
    signedIn({ claims: { session_id: "sess-1" } });

    const res = await connect();

    const cookie = res.cookies.get(stateCookieName);
    expect(cookie).toBeTruthy();
    expect(cookie.value).toBeTruthy();
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.maxAge).toBe(600);
  });

  it("the minted state verifies for this user/session/cookie and for no other", async () => {
    signedIn({ claims: { session_id: "sess-1" } });

    const res = await connect();
    const state = stateFromRedirect(res);
    const cookieValue = res.cookies.get(stateCookieName).value;

    const good = await verifyDriveOAuthState(state, {
      userId: USER_ID,
      sessionId: "sess-1",
      cookieValue,
    });
    expect(good.ok).toBe(true);

    expect(
      await verifyDriveOAuthState(state, { userId: OTHER_USER_ID, sessionId: "sess-1", cookieValue }),
    ).toEqual({ ok: false, reason: "wrong-user" });

    expect(
      await verifyDriveOAuthState(state, { userId: USER_ID, sessionId: "sess-1", cookieValue: "not-the-nonce" }),
    ).toEqual({ ok: false, reason: "nonce-mismatch" });

    // A Gmail state can never verify at a Drive callback (ARCH.md §6).
    const { verifyOAuthState } = await import("@/lib/oauth/state");
    expect(await verifyOAuthState(state, { provider: "gmail", userId: USER_ID, sessionId: "sess-1" })).toEqual({
      ok: false,
      reason: "wrong-provider",
    });
  });

  it("the minted state's signed payload is bound to provider:'drive'", async () => {
    signedIn({ claims: { session_id: "sess-1" } });

    const state = stateFromRedirect(await connect());
    const [payloadB64] = state.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));

    expect(payload.provider).toBe("drive");
    // The pre-fix Gmail vulnerability was an unsigned, plaintext {userId}
    // blob — neither the shape nor the raw id may survive here either.
    expect(payload.userId).not.toBe(undefined);
    expect(state).not.toContain(USER_ID);
  });

  it("still mints a usable, verifiable state when the session id is unavailable", async () => {
    signedIn();

    const res = await connect();
    const state = stateFromRedirect(res);
    const cookieValue = res.cookies.get(stateCookieName).value;

    expect(res.status).toBe(307);
    const good = await verifyDriveOAuthState(state, { userId: USER_ID, sessionId: null, cookieValue });
    expect(good.ok).toBe(true);
  });
});
