// N60 SECOND CHUNK -- Step C (4b TDD) -- the model-spending chat route.
//
// SCOPE: app/api/feed-config/chat/route.js -- POST derives a feed configuration
// from the user's message and RETURNS IT for review. It must not write a saved
// search (that is the apply route, Step B); it must authenticate before it
// spends; and it must be bounded (12 turns / 10 min / user, matching
// interview-prep's human-paced bound).
//
// REACHABILITY: the real POST handler is driven with a real Request. Only
// Supabase (auth) and the Gemini entry point are mocked; the deriver is the
// REAL lib/feedConfig/deriveFeedConfig, forced onto the gemini path so
// getGeminiClient() is the live SPEND observable -- "spent nothing" is proven by
// that spy staying silent, not by mocking the deriver away (which would hide
// the route -> deriver -> model join). The static module-scope / limit / window
// / 429-shape assertions come free from lib/rateLimit/adoption.test.js's
// it.each(BOUNDED) once the implementer lists this route; this file carries the
// irreplaceable BEHAVIOURAL half (fire limit+1, the last is 429) plus the
// no-write, auth, and spend-nothing properties.
//
// RED ON HEAD: app/api/feed-config/chat/route.js does not exist (MEASURED at
// HEAD 98be9ce). `import { POST } from "./route.js"` fails to resolve, so this
// file fails COLLECTION -- RED for the honest reason (subject absent).
// Satisfiability is proven against an isolated reference build in the notes.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { POST } from "./route.js";
// The paired positive control (brief non-vacuity rule): the apply route, which
// exists (Step B) and DOES insert -- so "the chat route inserts nothing" is a
// real property, not an artefact of a request that never reached an insert.
import { POST as APPLY_POST } from "../apply/route.js";

// A Supabase-ish recorder: auth.getUser resolves `user`, every insert argument
// and touched table is recorded, and a select-count for the apply route's cap
// check is answered. Mirrors the recorder in the apply route's own tests.
function recordingClient({ user, existing = 0 } = {}) {
  const inserts = [];
  const tablesTouched = [];
  const client = {
    from(table) {
      tablesTouched.push(table);
      const calls = [];
      const b = {};
      const rec = (n) => (...a) => {
        calls.push([n, ...a]);
        if (n === "insert") inserts.push({ table, arg: a[0] });
        return b;
      };
      for (const m of ["select", "insert", "update", "delete", "eq", "in", "or", "order", "limit"]) b[m] = rec(m);
      b.single = () => Promise.resolve({ data: { id: "new-id" }, error: null });
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (res, rej) => {
        const sel = calls.find((c) => c[0] === "select");
        const opts = sel && sel[2];
        const rows = Array.from({ length: existing }, (_, i) => ({ id: `row-${i}` }));
        const payload = opts && opts.count ? { count: existing, data: rows, error: null } : { data: rows, error: null };
        return Promise.resolve(payload).then(res, rej);
      };
      return b;
    },
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
  };
  client.__inserts = inserts;
  client.__tablesTouched = tablesTouched;
  return client;
}

function stubModel(reply) {
  const generateContent = vi.fn(async () => ({
    text: typeof reply === "string" ? reply : JSON.stringify(reply),
  }));
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

// A JSON POST that forces the gemini path so getGeminiClient is the live spend
// observable. `env` inside the deriver defaults to process.env; RESUME_ENGINE is
// unset in the test runner, so engine:"gemini" resolves to the gemini path.
function chatRequest(body) {
  return new Request("http://localhost/api/feed-config/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: "gemini", ...body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESUME_ENGINE", ""); // never let an ambient default flip the path
  stubModel({ name: "Backend roles", jobKeywords: ["backend"], autoTailorMinIntervalMinutes: 60 });
});

// ---------------------------------------------------------------------------
// Brief item 1 -- the derived configuration is RETURNED for review, NOT stored.
// ---------------------------------------------------------------------------
describe("brief item 1: the chat route returns a config for review and writes nothing", () => {
  it("performs NO insert on any table", async () => {
    const client = recordingClient({ user: { id: "u-nowrite" } });
    createClient.mockResolvedValue(client);
    const res = await POST(chatRequest({ message: "backend roles, hourly" }));
    expect(res.status).toBe(200);
    // The whole point: the configuration is shown before anything is stored.
    expect(client.__inserts).toHaveLength(0);
    // ...and specifically nothing was written to saved_searches.
    expect(client.__tablesTouched).not.toContain("saved_searches");
  });

  it("[non-vacuity control] the APPLY route, same recorder, DOES insert into saved_searches", async () => {
    // Proves "no insert" is a property of the chat route, not of a request that
    // never got far enough to insert anything.
    const client = recordingClient({ user: { id: "u-apply" }, existing: 0 });
    createClient.mockResolvedValue(client);
    const res = await APPLY_POST(
      new Request("http://localhost/api/feed-config/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Backend roles" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(client.__inserts).toHaveLength(1);
    expect(client.__inserts[0].table).toBe("saved_searches");
  });

  it("returns the derived config in the response body (with no enable flag)", async () => {
    stubModel({ name: "Backend", jobKeywords: ["backend", "python"], autoTailorMinIntervalMinutes: 60 });
    const client = recordingClient({ user: { id: "u-config" } });
    createClient.mockResolvedValue(client);
    const res = await POST(chatRequest({ message: "backend python roles" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.config).toBeTruthy();
    expect(json.config.jobKeywords).toContain("backend");
    expect(json.config).not.toHaveProperty("auto_tailor_enabled");
    expect(json.config).not.toHaveProperty("autoTailorEnabled");
  });
});

// ---------------------------------------------------------------------------
// Brief item 3 (route boundary) -- the RESPONSE states the delivered cadence.
// The deriver's own clamp is pinned in deriveFeedConfig.test.js; here we prove
// the route surfaces the delivered value, not the raw request.
// ---------------------------------------------------------------------------
describe("brief item 3: the response states the delivered (clamped) cadence", () => {
  it("a 5-minute request comes back as 15 in the response config", async () => {
    stubModel({ name: "Fast", jobKeywords: ["backend"], autoTailorMinIntervalMinutes: 5 });
    const client = recordingClient({ user: { id: "u-cadence" } });
    createClient.mockResolvedValue(client);
    const res = await POST(chatRequest({ message: "every 5 minutes" }));
    const json = await res.json();
    expect(json.config.autoTailorMinIntervalMinutes).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Brief item 2 (route boundary) -- an unmentioned cadence stays unset in the response.
// ---------------------------------------------------------------------------
describe("brief item 2: an unmentioned cadence stays null in the response", () => {
  it("no cadence in the reply -> response config cadence is null, not defaulted", async () => {
    stubModel({ name: "No cadence", jobKeywords: ["backend"] });
    const client = recordingClient({ user: { id: "u-unset" } });
    createClient.mockResolvedValue(client);
    const res = await POST(chatRequest({ message: "backend jobs" }));
    const json = await res.json();
    expect(json.config.autoTailorMinIntervalMinutes).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Brief item 5 -- it cannot spend without authenticating.
// ---------------------------------------------------------------------------
describe("brief item 5: an unauthenticated request spends nothing", () => {
  it("no session user -> 401, no model call, no write", async () => {
    const client = recordingClient({ user: null });
    createClient.mockResolvedValue(client);
    const res = await POST(chatRequest({ message: "backend" }));
    expect(res.status).toBe(401);
    // "Spends nothing" is the point: the model was never reached for an
    // unauthenticated caller, and nothing was written.
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(client.__inserts).toHaveLength(0);
  });

  it("[non-vacuity control] an authenticated request DOES reach getGeminiClient", async () => {
    // Proves the spy CAN fire, so "not called" above is meaningful, not vacuous.
    const client = recordingClient({ user: { id: "u-authed" } });
    createClient.mockResolvedValue(client);
    await POST(chatRequest({ message: "backend" }));
    expect(getGeminiClient).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Brief item 5 -- the bound is reached, the caller sees a 429, and the denied
// request spends nothing. The static shape (module-scope limiter, 12 / 600_000,
// rateLimitHeaders) is asserted by adoption.test.js once the route is listed;
// this is the behavioural half that a static check cannot replace.
// ---------------------------------------------------------------------------
describe("brief item 5: the route is bounded at 12 / 10 minutes", () => {
  it("the 13th request in the window is denied with a 429 and back-off headers", async () => {
    const client = recordingClient({ user: { id: "u-ratelimit" } });
    createClient.mockResolvedValue(client);

    // 12 allowed (limit=12), each returning a config.
    for (let i = 0; i < 12; i += 1) {
      const ok = await POST(chatRequest({ message: `turn ${i}` }));
      expect(ok.status).toBe(200);
    }

    const callsBeforeDenied = getGeminiClient.mock.calls.length;
    const denied = await POST(chatRequest({ message: "one too many" }));

    // The caller sees a real 429 with back-off, never a throw or a silent no-op.
    expect(denied.status).toBe(429);
    expect(denied.headers.get("RateLimit-Limit")).toBe("12");
    expect(denied.headers.get("Retry-After")).toBeTruthy();
    const body = await denied.json();
    expect(body).toBeTruthy(); // a JSON error body, not an unhandled throw

    // Spends nothing at the limit: the denied request did not reach the model.
    expect(getGeminiClient.mock.calls.length).toBe(callsBeforeDenied);
  });

  it("[non-vacuity control] a request under the limit DID reach getGeminiClient", async () => {
    // A distinct user id so this test's own count is not the rate-limited one's.
    const client = recordingClient({ user: { id: "u-underlimit" } });
    createClient.mockResolvedValue(client);
    await POST(chatRequest({ message: "hello" }));
    expect(getGeminiClient).toHaveBeenCalled();
  });
});
