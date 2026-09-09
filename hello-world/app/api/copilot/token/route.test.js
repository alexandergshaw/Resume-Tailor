import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET, POST } from "./route.js";
import { createClient } from "@/lib/supabase/server";

// @/lib/config/env is deliberately left unmocked here: the regression this
// route exists to prevent is specifically about the real getDeepgramApiKey()
// no longer depending on Gemini_LLM_API_Key (see lib/config/env.js). Mocking
// that module out would hide the exact bug the fix addresses.

// Unique per call: the module-scope limiter's counters survive between `it()`
// blocks in this file exactly as they survive between requests in a running
// server, so a shared id would let an early case deny a later one. Same
// discipline as app/api/copilot/ask/route.test.js.
let userSeq = 0;
function mockUser(id = `token-user-${(userSeq += 1)}`) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
  });
}

const originalFetch = globalThis.fetch;
const originalGeminiKey = process.env.Gemini_LLM_API_Key;
const originalDeepgramKey = process.env.DEEPGRAM_API_KEY;
const originalSttProvider = process.env.STT_PROVIDER;
const originalElevenLabsKey = process.env.ELEVENLABS_API_KEY;

// Stubs the outbound call to Deepgram's own grant endpoint (the only network
// call route.js makes) with a controllable ok/status/body.
function mockDeepgramGrant({
  ok = true,
  status = 200,
  accessToken = "dg-token-abc",
  expiresIn = 30,
  text = "",
} = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => text,
    json: async () => ({ access_token: accessToken, expires_in: expiresIn }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalGeminiKey === undefined) delete process.env.Gemini_LLM_API_Key;
  else process.env.Gemini_LLM_API_Key = originalGeminiKey;
  if (originalDeepgramKey === undefined) delete process.env.DEEPGRAM_API_KEY;
  else process.env.DEEPGRAM_API_KEY = originalDeepgramKey;
  if (originalSttProvider === undefined) delete process.env.STT_PROVIDER;
  else process.env.STT_PROVIDER = originalSttProvider;
  if (originalElevenLabsKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originalElevenLabsKey;
});

// Stubs the outbound call to ElevenLabs' single-use-token endpoint (the only
// network call mintElevenLabsToken makes) with a controllable ok/status/body.
function mockElevenLabsGrant({ ok = true, status = 200, token = "el-token-abc", text = "" } = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => text,
    json: async () => ({ token }),
  });
}

describe("POST /api/copilot/token (auth is checked before configuration)", () => {
  it("401s with the existing sign-in message when not signed in, even when Deepgram is unconfigured", async () => {
    delete process.env.DEEPGRAM_API_KEY;
    mockUser(null);
    globalThis.fetch = vi.fn();

    const res = await POST();

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Sign in to use the interview copilot.");
    // An anonymous caller can't use this response to probe Deepgram config:
    // the request never even reaches the Deepgram grant call.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("401s with the same sign-in message when not signed in and Deepgram IS configured", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser(null);
    globalThis.fetch = vi.fn();

    const res = await POST();

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Sign in to use the interview copilot.");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/copilot/token (Deepgram configuration)", () => {
  it("503s with the existing message verbatim when signed in but DEEPGRAM_API_KEY is unset", async () => {
    delete process.env.DEEPGRAM_API_KEY;
    mockUser();
    globalThis.fetch = vi.fn();

    const res = await POST();

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe(
      "Deepgram is not configured. Add DEEPGRAM_API_KEY to .env.local to use the interview copilot.",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("REGRESSION GUARD: mints a token for a signed-in request when Gemini_LLM_API_Key is unset and DEEPGRAM_API_KEY is set", async () => {
    // Before the fix, reading the Deepgram key went through getServerEnv(),
    // which throws when Gemini_LLM_API_Key is missing -- turning a keyless
    // Gemini deploy into a 500 for the copilot even though Deepgram itself
    // was fully configured.
    delete process.env.Gemini_LLM_API_Key;
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser();
    mockDeepgramGrant({ accessToken: "regression-token", expiresIn: 30 });

    const res = await POST();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe("regression-token");
    expect(data.expiresIn).toBe(30);
    expect(data.provider).toBe("deepgram");
  });
});

describe("POST /api/copilot/token (Deepgram grant outcome)", () => {
  it("returns token, expiresIn and provider 'deepgram' on a successful grant", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser();
    mockDeepgramGrant({ accessToken: "dg-token-xyz", expiresIn: 45 });

    const res = await POST();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ token: "dg-token-xyz", expiresIn: 45, provider: "deepgram" });
  });

  it("502s when the Deepgram grant request itself fails", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser();
    mockDeepgramGrant({ ok: false, status: 401, text: "invalid API key" });

    const res = await POST();

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("401");
    expect(data.error).toContain("invalid API key");
  });
});

describe("GET /api/copilot/token (auth is checked before configuration)", () => {
  it("401s with the sign-in message when not signed in", async () => {
    mockUser(null);
    globalThis.fetch = vi.fn();

    const res = await GET();

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Sign in to use the interview copilot.");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("401s the same way even when no provider is configured at all", async () => {
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    mockUser(null);
    globalThis.fetch = vi.fn();

    const res = await GET();

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Sign in to use the interview copilot.");
  });
});

describe("GET /api/copilot/token (reports the provider without minting)", () => {
  it("returns only { provider } for a signed-in caller and calls no provider API", async () => {
    delete process.env.STT_PROVIDER;
    mockUser();
    globalThis.fetch = vi.fn();

    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ provider: "deepgram" });
    // This is the whole point of the read-only route: it must never spend a
    // provider credential (ElevenLabs tokens are single-use) just to answer
    // "which provider is selected".
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reports 'elevenlabs' when STT_PROVIDER selects it, still without minting", async () => {
    process.env.STT_PROVIDER = "elevenlabs";
    // Deliberately unset so a mint attempt would 503 -- proving GET never
    // even tries to mint, rather than happening to succeed.
    delete process.env.ELEVENLABS_API_KEY;
    mockUser();
    globalThis.fetch = vi.fn();

    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ provider: "elevenlabs" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/copilot/token (ElevenLabs configuration)", () => {
  it("503s naming ElevenLabs and ELEVENLABS_API_KEY when signed in but the key is unset, without falling back to Deepgram", async () => {
    process.env.STT_PROVIDER = "elevenlabs";
    delete process.env.ELEVENLABS_API_KEY;
    // Deepgram IS configured here -- if the route ever silently fell back to
    // it, this test would see a 200 for Deepgram instead of the 503 below.
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser();
    globalThis.fetch = vi.fn();

    const res = await POST();

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe(
      "ElevenLabs is not configured. Add ELEVENLABS_API_KEY to .env.local to use the interview copilot.",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("mints via the ElevenLabs single-use-token endpoint with an xi-api-key header and returns provider 'elevenlabs'", async () => {
    process.env.STT_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-server-key";
    mockUser();
    mockElevenLabsGrant({ token: "el-token-xyz" });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
      expect.objectContaining({
        method: "POST",
        headers: { "xi-api-key": "el-server-key" },
      }),
    );
    const data = await res.json();
    expect(data).toEqual({ token: "el-token-xyz", provider: "elevenlabs" });
  });

  it("502s when the ElevenLabs single-use-token request itself fails", async () => {
    process.env.STT_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "el-server-key";
    mockUser();
    mockElevenLabsGrant({ ok: false, status: 403, text: "quota exceeded" });

    const res = await POST();

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toContain("403");
    expect(data.error).toContain("quota exceeded");
  });
});

describe("POST /api/copilot/token (provider selection never falls back)", () => {
  it("503s naming Deepgram when STT_PROVIDER is unset and DEEPGRAM_API_KEY is unset, even though ELEVENLABS_API_KEY is set", async () => {
    delete process.env.STT_PROVIDER;
    delete process.env.DEEPGRAM_API_KEY;
    process.env.ELEVENLABS_API_KEY = "el-server-key";
    mockUser();
    globalThis.fetch = vi.fn();

    const res = await POST();

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe(
      "Deepgram is not configured. Add DEEPGRAM_API_KEY to .env.local to use the interview copilot.",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("mints via Deepgram when STT_PROVIDER is an unrecognized value, matching today's default behavior", async () => {
    process.env.STT_PROVIDER = "azure";
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser();
    mockDeepgramGrant({ accessToken: "dg-token-default", expiresIn: 60 });

    const res = await POST();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ token: "dg-token-default", expiresIn: 60, provider: "deepgram" });
  });
});

// ---------------------------------------------------------------------------
// The spend ceiling. Each POST here mints a REAL credential at a metered
// provider -- an ElevenLabs single-use token is consumed whether or not the
// browser ever connects -- so an unbounded loop is unbounded third-party spend
// with nothing to show for it.
// ---------------------------------------------------------------------------
describe("the token-minting spend ceiling actually bites", () => {
  const LIMIT = 10;

  it("denies past the bound with 429, Retry-After and the RateLimit-* headers", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser("token-greedy");
    mockDeepgramGrant({ accessToken: "dg-token-abc", expiresIn: 30 });

    const statuses = [];
    for (let i = 0; i < LIMIT + 1; i += 1) {
      statuses.push((await POST()).status);
    }

    // A limiter built INSIDE the handler gets a fresh store on every request,
    // so every caller is forever on its first request and all LIMIT+1 succeed.
    expect(statuses.filter((s) => s === 200)).toHaveLength(LIMIT);
    expect(statuses[LIMIT]).toBe(429);

    const denied = await POST();
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(denied.headers.get("RateLimit-Limit")).toBe(String(LIMIT));
  });

  it("mints nothing on a denied request -- the provider is never called", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser("token-nospend");
    mockDeepgramGrant({ accessToken: "dg-token-abc", expiresIn: 30 });
    for (let i = 0; i < LIMIT + 1; i += 1) await POST();

    const mintsBefore = globalThis.fetch.mock.calls.length;
    const denied = await POST();
    expect(denied.status).toBe(429);
    expect(globalThis.fetch.mock.calls).toHaveLength(mintsBefore);
  });

  it("bounds POST but deliberately leaves the read-only GET alone", async () => {
    // GET only reports which provider is configured -- no provider API call,
    // no spend -- and the copilot privacy notice reads it on every page view.
    // A bound there would be cost without benefit. Both halves are asserted
    // for the SAME caller so this cannot pass by neither being limited.
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockUser("token-reader");
    mockDeepgramGrant({ accessToken: "dg-token-abc", expiresIn: 30 });

    for (let i = 0; i < LIMIT + 1; i += 1) await POST();
    expect((await POST()).status).toBe(429);

    for (let i = 0; i < LIMIT + 5; i += 1) {
      expect((await GET()).status).toBe(200);
    }
  });

  it("counts per authenticated user, so one caller's flood cannot deny another", async () => {
    process.env.DEEPGRAM_API_KEY = "dg-server-key";
    mockDeepgramGrant({ accessToken: "dg-token-abc", expiresIn: 30 });

    mockUser("token-flooder");
    for (let i = 0; i < LIMIT + 1; i += 1) await POST();
    expect((await POST()).status).toBe(429);

    mockUser("token-bystander");
    expect((await POST()).status).toBe(200);
  });
});
