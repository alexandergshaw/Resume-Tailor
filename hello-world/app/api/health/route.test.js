import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

// Obvious fakes — nothing here is, or resembles, a real credential. They are
// long and distinctive on purpose so a substring search over the response body
// cannot match one by accident.
const FAKE_URL = "https://fake-project-ref-9z9z9z.supabase.co";
const FAKE_ANON = "fake.anon.key.AAAAAAAAAAAAAAAAAAAA.tail";
const FAKE_SERVICE = "fake.service.role.BBBBBBBBBBBBBBBB.tail";
const FAKE_FROM = "fake-alerts@example-not-real.test";
const FAKE_RESEND = "fake_resend_key_CCCCCCCCCCCC";
const FAKE_CRON = "fake-cron-secret-DDDDDDDDDDDD";

// The two 20-character prefixes the pre-fix route emitted verbatim. A prefix is
// not harmless because it is short: for a Supabase anon/service JWT the leading
// characters are the base64url of the JOSE header plus the start of the claim
// set, which encodes the algorithm and the key class (anon vs service_role) —
// i.e. it confirms which key is which and that a real one is present, and it
// shortens any offline guess. It is asserted against explicitly, separately
// from the whole key, so an implementation that redacts the value but keeps the
// prefix does not pass.
const ANON_PREFIX = FAKE_ANON.slice(0, 20);
const SERVICE_PREFIX = FAKE_SERVICE.slice(0, 20);

// Everything an unauthenticated caller must never receive, and that even an
// authorized caller must never receive as a VALUE (only as a boolean).
const NEVER_DISCLOSE = [
  FAKE_URL,
  "fake-project-ref-9z9z9z",
  FAKE_ANON,
  FAKE_SERVICE,
  ANON_PREFIX,
  SERVICE_PREFIX,
  FAKE_FROM,
  FAKE_RESEND,
  FAKE_CRON,
];

// The field names the pre-fix route used to carry a value. Asserted ABSENT from
// the unauthenticated body rather than "empty", so returning the same shape
// with the values blanked out does not pass.
const VALUE_BEARING_FIELDS = [
  "supabaseUrlValue",
  "supabaseAnonKeyPrefix",
  "supabaseServiceKeyPrefix",
];

// The configuration inventory. A boolean is still a disclosure — it tells an
// unauthenticated caller which integrations exist and therefore which attacks
// are worth attempting — so these names must be absent from the public answer
// too, not merely stripped of their values.
const INVENTORY_FIELDS = [
  "supabaseUrl",
  "supabaseAnonKey",
  "supabaseServiceKey",
  "resendApiKey",
  "emailFrom",
  "cronSecret",
  "authReachable",
  "authError",
  "adminDbReachable",
  "adminDbError",
];

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "CRON_SECRET",
];

function healthRequest(headers = {}) {
  return new Request("http://localhost/api/health", { method: "GET", headers });
}

// Read the body ONCE (a Response body is single-use) and hand back both views.
async function getHealth(headers = {}) {
  const res = await GET(healthRequest(headers));
  const text = await res.text();
  return { res, text, json: JSON.parse(text) };
}

// A stand-in for the SSR client. ONE method serves both callers, told apart by
// its argument — which is exactly the distinction the route depends on:
//   - the GATE calls `getUser()` with NO argument, so supabase-js resolves the
//     session from the cookie and then VALIDATES it with the auth server;
//   - the reachability PROBE calls `getUser(<probe token>)`, which supabase-js
//     sends straight to the auth server with no session involved, so it always
//     costs exactly one round trip.
//
// `getSession` is stubbed to hand back a fully signed-in session on purpose.
// Measured against @supabase/auth-js 2.106.2: an attacker-supplied
// `sb-<ref>-auth-token` cookie decodes into a session object with ZERO network
// requests, so `getSession()` is what a bypass looks like. Making the stub
// generous means any implementation that gates on it — or that answers
// "reachable" out of it — fails loudly instead of passing by luck.
//
// The probe's DEFAULT answer is a 401, because that is what a healthy auth
// server actually returns for the deliberately invalid probe token. A fixture
// where the probe succeeds is a state production never reaches.
function stubSupabase({
  user = null,
  authProbeError = { message: "invalid JWT: unable to parse or verify signature", status: 401 },
  getUserThrows = null,
  sessionUser = { id: "cookie-user" },
} = {}) {
  return {
    auth: {
      getUser: vi.fn(async (jwt) => {
        if (jwt) return { data: { user: null }, error: authProbeError };
        if (getUserThrows) throw getUserThrows;
        return {
          data: { user },
          error: user ? null : { message: "Auth session missing!" },
        };
      }),
      getSession: vi.fn(async () => ({
        data: {
          session: sessionUser
            ? { user: sessionUser, access_token: "cookie-token-not-validated" }
            : null,
        },
        error: null,
      })),
    },
  };
}

function stubAdmin({ error = null } = {}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ limit: vi.fn(async () => ({ data: [], error })) })),
    })),
  };
}

let savedEnv;

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = {};
  ENV_KEYS.forEach((key) => {
    savedEnv[key] = process.env[key];
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = FAKE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = FAKE_ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE;
  process.env.RESEND_API_KEY = FAKE_RESEND;
  process.env.EMAIL_FROM = FAKE_FROM;
  process.env.CRON_SECRET = FAKE_CRON;

  createClient.mockResolvedValue(stubSupabase({ user: null }));
  createAdminClient.mockReturnValue(stubAdmin());
});

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  });
});

describe("GET /api/health — unauthenticated", () => {
  it("still answers 200 so a platform uptime probe keeps working", async () => {
    const { res } = await getHealth();
    expect(res.status).toBe(200);
  });

  it("answers liveness and nothing else", async () => {
    const { json } = await getHealth();
    expect(json).toEqual({ ok: true });
  });

  it("never discloses the Supabase project URL", async () => {
    const { text } = await getHealth();
    expect(text).not.toContain(FAKE_URL);
    expect(text).not.toContain("fake-project-ref-9z9z9z");
  });

  it("never discloses key material", async () => {
    const { text } = await getHealth();
    expect(text).not.toContain(FAKE_ANON);
    expect(text).not.toContain(FAKE_SERVICE);
    expect(text).not.toContain(FAKE_RESEND);
  });

  it("never discloses a key PREFIX either", async () => {
    const { text } = await getHealth();
    expect(text).not.toContain(ANON_PREFIX);
    expect(text).not.toContain(SERVICE_PREFIX);
  });

  it("never discloses the alert From address", async () => {
    const { text } = await getHealth();
    expect(text).not.toContain(FAKE_FROM);
  });

  it("drops the value-bearing fields entirely — not blanked, absent", async () => {
    const { json } = await getHealth();
    VALUE_BEARING_FIELDS.forEach((field) => {
      expect(Object.keys(json)).not.toContain(field);
    });
  });

  it("does not publish an inventory of which integrations are configured", async () => {
    const { json } = await getHealth();
    INVENTORY_FIELDS.forEach((field) => {
      expect(Object.keys(json)).not.toContain(field);
    });
  });
});

describe("GET /api/health — the gate cannot be talked past", () => {
  it("is not unlocked by any header the caller controls", async () => {
    const attackerHeaders = [
      { "x-vercel-cron": "1" },
      { "x-health-detail": "true" },
      { "x-admin": "1" },
      { "x-forwarded-for": "127.0.0.1" },
      { origin: "http://localhost:3000" },
      { authorization: "Bearer not-the-secret" },
      { authorization: `Bearer ${FAKE_CRON}x` },
      { authorization: `Basic ${FAKE_CRON}` },
    ];
    for (const headers of attackerHeaders) {
      const { json } = await getHealth(headers);
      expect(json).toEqual({ ok: true });
    }
  });

  it("is not unlocked by an empty bearer when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const probes = [{}, { authorization: "Bearer " }, { authorization: "Bearer" }, { authorization: "Bearer undefined" }];
    for (const headers of probes) {
      const { json } = await getHealth(headers);
      expect(json).toEqual({ ok: true });
    }
  });

  it("is not unlocked by a request that carries no headers object at all", async () => {
    const res = await GET(undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("gates on getUser(), never on the cookie getSession() would hand back", async () => {
    // The stub models the real split: the cookie carries a session (getSession
    // returns one with no round trip at all), but the auth server does not
    // confirm a user. An implementation that gated on `getSession()` would let
    // anyone with a hand-written `sb-<ref>-auth-token` cookie read tier 2.
    const client = stubSupabase({ user: null, sessionUser: { id: "attacker" } });
    createClient.mockResolvedValue(client);
    const { json } = await getHealth();
    expect(json).toEqual({ ok: true });
    // Called with NO argument: the session-derived, server-validated form.
    expect(client.auth.getUser).toHaveBeenCalledWith();
  });

  it("tells every cache not to keep a copy — the body varies by credential", async () => {
    // Two different callers get two different bodies from the same URL. A
    // shared cache that keyed only on the URL would hand tier 2 to whoever
    // asked next.
    const anon = await GET(healthRequest());
    expect(anon.headers.get("cache-control")).toBe("no-store");
    createClient.mockResolvedValue(stubSupabase({ user: { id: "user-1" } }));
    const authed = await GET(healthRequest());
    expect(await authed.clone().json()).toHaveProperty("authorized", true);
    expect(authed.headers.get("cache-control")).toBe("no-store");
  });

  it("does no database work at all for an anonymous caller", async () => {
    // The header claims tier 1 "cannot be used to drive load against the
    // database". This is that claim as an assertion: not one admin client is
    // built and not one query is issued.
    const admin = stubAdmin();
    createAdminClient.mockReturnValue(admin);
    await getHealth();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });
});

describe("GET /api/health — authorized by a signed-in session", () => {
  beforeEach(() => {
    createClient.mockResolvedValue(stubSupabase({ user: { id: "user-1" } }));
  });

  it("reports each configured item as a boolean, never as a value", async () => {
    const { res, json, text } = await getHealth();
    expect(res.status).toBe(200);
    expect(json.supabaseUrl).toBe(true);
    expect(json.supabaseAnonKey).toBe(true);
    expect(json.supabaseServiceKey).toBe(true);
    expect(json.resendApiKey).toBe(true);
    expect(json.emailFrom).toBe(true);
    expect(json.cronSecret).toBe(true);
    NEVER_DISCLOSE.forEach((secret) => {
      expect(text).not.toContain(secret);
    });
  });

  it("reports a MISSING item as false rather than dropping it", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const { json } = await getHealth();
    expect(json.resendApiKey).toBe(false);
    expect(json.emailFrom).toBe(false);
  });

  it("keeps the reachability probes that make a misconfiguration diagnosable", async () => {
    const { json } = await getHealth();
    expect(json.authReachable).toBe(true);
    expect(json.adminDbReachable).toBe(true);
    expect(json.authError).toBeNull();
    expect(json.adminDbError).toBeNull();
  });

  it("surfaces the auth and admin-DB failure messages", async () => {
    createClient.mockResolvedValue(
      stubSupabase({
        user: { id: "user-1" },
        // A TRANSPORT failure. supabase-js raises AuthRetryableFetchError with
        // `status` 0 when fetch itself throws, and gives a real HTTP answer a
        // real status — so status-0 is what "nothing answered" looks like.
        authProbeError: { message: "auth probe failed", status: 0 },
      }),
    );
    createAdminClient.mockReturnValue(stubAdmin({ error: { message: "relation applied_jobs missing" } }));
    const { json } = await getHealth();
    expect(json.authReachable).toBe(false);
    expect(json.authError).toBe("auth probe failed");
    expect(json.adminDbReachable).toBe(false);
    expect(json.adminDbError).toBe("relation applied_jobs missing");
  });

  it("probes reachability by ASKING the auth server, not by reading the cookie", async () => {
    const client = stubSupabase({ user: { id: "user-1" } });
    createClient.mockResolvedValue(client);
    const { json } = await getHealth();
    expect(json.authReachable).toBe(true);
    // Exactly one call carrying a token — i.e. a real round trip to
    // /auth/v1/user. Both `getSession()` and a bare `getUser()` answer out of
    // the cookie with no request at all, so neither can decide reachability.
    const probeCalls = client.auth.getUser.mock.calls.filter(([jwt]) => typeof jwt === "string" && jwt !== "");
    expect(probeCalls).toHaveLength(1);
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it("counts a 401 from the auth server as REACHABLE — it answered", async () => {
    // The probe token is deliberately invalid, so a healthy auth server
    // ALWAYS rejects it. Treating "any error" as unreachable would make this
    // field permanently false in production.
    createClient.mockResolvedValue(
      stubSupabase({
        user: { id: "user-1" },
        authProbeError: { message: "invalid JWT", status: 401 },
      }),
    );
    const { json } = await getHealth();
    expect(json.authReachable).toBe(true);
    expect(json.authError).toBeNull();
  });

  it("counts a 5xx from the auth server as NOT reachable — it is not serving", async () => {
    createClient.mockResolvedValue(
      stubSupabase({
        user: { id: "user-1" },
        authProbeError: { message: "internal server error", status: 503 },
      }),
    );
    const { json } = await getHealth();
    expect(json.authReachable).toBe(false);
    expect(json.authError).toBe("internal server error");
  });
});

describe("GET /api/health — authorized by the operator secret", () => {
  it("unlocks the detail for an exact CRON_SECRET bearer", async () => {
    const { res, json, text } = await getHealth({ authorization: `Bearer ${FAKE_CRON}` });
    expect(res.status).toBe(200);
    expect(json.supabaseUrl).toBe(true);
    expect(json.supabaseServiceKey).toBe(true);
    expect(json.adminDbReachable).toBe(true);
    NEVER_DISCLOSE.forEach((secret) => {
      expect(text).not.toContain(secret);
    });
  });

  it("costs a break-glass caller no session lookup at all", async () => {
    // `hasOperatorSecret` is free — a header read and an env read — and is
    // evaluated first so `||` short-circuits the session lookup away. That
    // lookup is the one part of the request that can leave the process, so
    // the ordering is load-bearing, not cosmetic.
    const client = stubSupabase({ user: null });
    createClient.mockResolvedValue(client);
    const { json } = await getHealth({ authorization: `Bearer ${FAKE_CRON}` });
    expect(json.authorized).toBe(true);
    // The gate's call is `getUser()` with no argument. Only the reachability
    // probe, which passes a token, may have run.
    const gateCalls = client.auth.getUser.mock.calls.filter(([jwt]) => jwt === undefined);
    expect(gateCalls).toEqual([]);
  });

  it("works when Supabase itself is the thing that is broken", async () => {
    // The chicken-and-egg this path exists for: nobody can sign in to read the
    // diagnostics when the auth config is what is misconfigured.
    createClient.mockRejectedValue(new Error("supabaseUrl is required"));
    const { json } = await getHealth({ authorization: `Bearer ${FAKE_CRON}` });
    expect(json.supabaseUrl).toBe(true);
    expect(json.authReachable).toBe(false);
  });
});

describe("GET /api/health — the error paths leak nothing either", () => {
  it("keeps liveness-only when the SSR client constructor throws with a leaky message", async () => {
    createClient.mockRejectedValue(
      new Error(`supabaseUrl is required: ${FAKE_URL} anon=${FAKE_ANON}`),
    );
    const { res, text, json } = await getHealth();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(text).not.toContain(FAKE_URL);
    expect(text).not.toContain(FAKE_ANON);
  });

  it("keeps liveness-only when getUser throws with a leaky message", async () => {
    createClient.mockResolvedValue(
      stubSupabase({ getUserThrows: new Error(`fetch failed for ${FAKE_URL}`) }),
    );
    const { res, text, json } = await getHealth();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(text).not.toContain(FAKE_URL);
  });

  it("keeps liveness-only when the admin client constructor throws with a leaky message", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error(`invalid service key ${FAKE_SERVICE}`);
    });
    const { res, text, json } = await getHealth();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(text).not.toContain(FAKE_SERVICE);
    expect(text).not.toContain(SERVICE_PREFIX);
  });

  it("actually REDACTS a secret that a driver error puts in the message", async () => {
    // Every other failure-path fixture uses a message that contains no secret,
    // so `redactSecrets` could be `return message` and they would all still
    // pass — a fixture that cannot exhibit the defect proves nothing. This one
    // plants the project URL and the service key in messages that an
    // AUTHORIZED caller receives, which is the only tier that echoes them.
    createClient.mockResolvedValue(
      stubSupabase({
        user: { id: "user-1" },
        authProbeError: { message: `getaddrinfo ENOTFOUND ${FAKE_URL}`, status: 0 },
      }),
    );
    createAdminClient.mockImplementation(() => {
      throw new Error(`connect ECONNREFUSED ${FAKE_URL} key=${FAKE_SERVICE}`);
    });
    const { json, text } = await getHealth();
    expect(json.authError).toContain("[redacted:NEXT_PUBLIC_SUPABASE_URL]");
    expect(json.adminDbError).toContain("[redacted:NEXT_PUBLIC_SUPABASE_URL]");
    expect(json.adminDbError).toContain("[redacted:SUPABASE_SERVICE_ROLE_KEY]");
    // The surrounding text survives, so this is redaction, not deletion.
    expect(json.adminDbError).toContain("connect ECONNREFUSED");
    NEVER_DISCLOSE.forEach((secret) => {
      expect(text).not.toContain(secret);
    });
  });

  it("gives an authorized caller the admin failure without printing key material", async () => {
    createClient.mockResolvedValue(stubSupabase({ user: { id: "user-1" } }));
    createAdminClient.mockImplementation(() => {
      throw new Error("service key rejected");
    });
    const { json, text } = await getHealth();
    expect(json.adminDbReachable).toBe(false);
    expect(json.adminDbError).toBe("service key rejected");
    NEVER_DISCLOSE.forEach((secret) => {
      expect(text).not.toContain(secret);
    });
  });
});
