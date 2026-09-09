// R-369, R-370 / AC-SCH1, AC-SCH2, AC-SCH10, AC-S8, AC-C18.
//
// A SECOND AUTHORISATION SURFACE. This route makes paid model calls and is NOT
// behind `auth.getUser()`. Its only gate is `CRON_SECRET`, and what makes that
// safe is that it CANNOT BE AIMED: it reads no request body, takes no
// parameters, and selects its own work from the queue query. An attacker who
// guesses the secret can make the worker do work it was already going to do,
// sooner. That is the whole blast radius, and it is by construction -- so this
// file asserts the construction, not just the 401.
//
// The auth helper is asserted CHARACTER-IDENTICAL to the two live cron routes'.
// A copy that drifts is the hazard `citationHref.js:15-19` names for allow-lists
// and it is the reason that file re-exports rather than re-implements. There is
// no shared cron-auth helper in this repo today -- `cron/tailor/route.js:44-51`
// and `cron/feed-ingest/route.js:13-20` are byte-identical private copies, and
// feed-ingest's own comment says "Mirrors /api/cron/tailor" -- so a third copy
// is what the precedent actually is, and this test is what stops it drifting.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import * as routeModule from "./route.js";

const { POST, GET } = routeModule;

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SELF = path.join(ROOT, "app/api/cron/position-glossary/route.js");
const FEED_INGEST = path.join(ROOT, "app/api/cron/feed-ingest/route.js");
const TAILOR = path.join(ROOT, "app/api/cron/tailor/route.js");
const VERCEL_JSON = path.join(ROOT, "vercel.json");

// Extracts the `function isAuthorized(request) { ... }` body, whitespace-folded.
function authHelper(file) {
  const src = readFileSync(file, "utf8");
  const start = src.indexOf("function isAuthorized(request)");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n}", start);
  return src.slice(start, end + 2).replace(/\s+/g, " ").trim();
}

const interactionsCreate = vi.fn(async () => ({
  status: "completed",
  steps: [
    { type: "google_search_call" },
    { type: "model_output", content: [{ type: "text", text: "", annotations: [] }] },
  ],
}));

function emptyAdmin() {
  const chain = {
    select: () => chain,
    update: () => chain,
    eq: () => chain,
    lt: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return { from: () => chain };
}

const req = (headers = {}) =>
  new Request("http://localhost/api/cron/position-glossary", { method: "POST", headers });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("Gemini_LLM_API_Key", "k");
  vi.stubEnv("GLOSSARY_DISABLED", "");
  createAdminClient.mockImplementation(() => emptyAdmin());
  // Mocked with a REAL return value on purpose. Left as a bare vi.fn() this
  // returns undefined, `getServerEnv().geminiModel` throws, and the route takes
  // its no-engine branch -- which still answers 200 and still makes zero calls,
  // so every assertion below would pass while the worker was never reached.
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  getGeminiClient.mockImplementation(() => ({ interactions: { create: interactionsCreate } }));
});

afterEach(() => vi.unstubAllEnvs());

describe("the route's platform contract (AC-SCH1)", () => {
  it("runs on node with the 300-second budget its two siblings use", async () => {
    expect(routeModule.runtime).toBe("nodejs");
    expect(routeModule.maxDuration).toBe(300);
    // The literal above cannot BE the imported constant -- Next evaluates route
    // segment config exports statically and fails the build on an identifier --
    // so the number exists twice by necessity. This is what stops the two
    // copies drifting, and with them the worker's whole deadline arithmetic.
    const { CRON_MAX_DURATION_S } = await import("@/lib/copilot/glossaryConstants.js");
    expect(routeModule.maxDuration).toBe(CRON_MAX_DURATION_S);
  });

  it("accepts GET as well, because Vercel cron sends GETs in some configurations", () => {
    expect(GET).toBe(POST);
  });

  it("carries an isAuthorized helper character-identical to BOTH live cron routes", () => {
    const mine = authHelper(SELF);
    expect(mine).toBe(authHelper(FEED_INGEST));
    expect(mine).toBe(authHelper(TAILOR));
    // Positive control: the extractor really is reading a body, not "".
    expect(mine).toContain("CRON_SECRET");
    expect(mine).toContain("x-vercel-cron");
  });
});

describe("authorization (R-369)", () => {
  it("returns 401 and makes ZERO model calls for a request with no secret", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(interactionsCreate).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns 401 for the wrong secret", async () => {
    const res = await POST(req({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(interactionsCreate).not.toHaveBeenCalled();
  });

  it("accepts the exact bearer", async () => {
    const res = await POST(req({ authorization: "Bearer s3cret" }));
    expect(res.status).toBe(200);
  });

  it("falls back to the Vercel cron header only when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(req({ "x-vercel-cron": "1" }))).status).toBe(200);
    expect((await POST(req())).status).toBe(401);
  });
});

describe("the kill switch is the FIRST statement (AC-C18)", () => {
  it("returns before constructing a Supabase client or a model client", async () => {
    vi.stubEnv("GLOSSARY_DISABLED", "1");
    const res = await POST(req({ authorization: "Bearer s3cret" }));
    expect(await res.json()).toMatchObject({ status: "disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(interactionsCreate).not.toHaveBeenCalled();
  });

  it("is checked before the authorization gate, so an operator's off means off", () => {
    const src = readFileSync(SELF, "utf8");
    const handlerAt = src.indexOf("export async function POST");
    const killAt = src.indexOf("GLOSSARY_DISABLED", handlerAt);
    const authAt = src.indexOf("isAuthorized(", handlerAt);
    expect(killAt).toBeGreaterThan(-1);
    expect(killAt).toBeLessThan(authAt);
  });
});

describe("AC-SCH10 / AC-S8: the worker cannot be aimed", () => {
  const src = () => readFileSync(SELF, "utf8");

  it("reads no request body and no search params", () => {
    expect(src()).not.toContain("request.json(");
    expect(src()).not.toContain("searchParams");
    expect(src()).not.toContain("new URL(request.url");
  });

  it("performs no per-user authorization, because it authenticates as the PLATFORM", () => {
    expect(src()).not.toContain("auth.getUser");
    expect(src()).not.toContain('from("applications")');
  });

  it("is not rate-limited, deliberately -- its spend is bounded by row-level caps", () => {
    // Stated as an assertion so the absence is not read later as an oversight.
    expect(src()).not.toContain("createRateLimiter");
  });

  it("reads no cursor and no call count from Redis (AC-SCH5)", () => {
    // ingestFeed's Redis cursor returns 0 on ANY cache error and its lock fails
    // OPEN. That is right for re-scanning 25 companies and catastrophic for
    // re-spending ten grounded calls: a failed instrument is invalid, never its
    // zero value, and that rule applies to money.
    expect(src()).not.toContain("redisClient");
    expect(src()).not.toContain("@upstash/redis");
  });
});

describe("R-370: the vercel.json entry", () => {
  const parsed = () => JSON.parse(readFileSync(VERCEL_JSON, "utf8"));

  it("declares the glossary cron alongside the two pre-existing jobs, unchanged", () => {
    const { crons } = parsed();
    expect(crons).toContainEqual({ path: "/api/cron/tailor", schedule: "*/15 * * * *" });
    expect(crons).toContainEqual({ path: "/api/cron/feed-ingest", schedule: "* * * * *" });
    expect(crons).toContainEqual({ path: "/api/cron/position-glossary", schedule: "*/2 * * * *" });
    expect(crons).toHaveLength(3);
  });

  it("still has no key other than crons", () => {
    expect(Object.keys(parsed())).toEqual(["crons"]);
  });

  it("declares a cadence matching the constant the capacity claim is derived from", async () => {
    const { CRON_CADENCE_MINUTES } = await import("@/lib/copilot/glossaryConstants.js");
    const entry = parsed().crons.find((c) => c.path === "/api/cron/position-glossary");
    expect(entry.schedule).toBe(`*/${CRON_CADENCE_MINUTES} * * * *`);
  });
});
