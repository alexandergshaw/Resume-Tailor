// R-351, R-352, R-353, R-361, R-376, R-377 / AC-C1, AC-C2, AC-C4, AC-C5,
// AC-C16', AC-S3, AC-T6, AC-T10, AC-E1, AC-E4, gates 1-14.
//
// THE GATE ORDER IS LOAD-BEARING AND EACH STEP STATES WHAT IT MUST PRECEDE.
// A module that constructs the model client and THEN decides is green on most
// fixtures and red only on the one that reaches the gate at all, so every gate
// below is asserted to refuse BEFORE `getGeminiClient` is constructed.
//
// THE LIMITER IS AT MODULE SCOPE AND BOTH HALVES ARE PINNED. One constructed
// inside the handler gets a brand-new store on every request, so every caller is
// forever on its first request: it permits everything, counts nothing, and
// passes a smoke test while doing it. The behavioural case fires five requests
// and expects the fifth to be denied (a per-request limiter would pass all
// five), and the static case asserts the declaration precedes the handler.
//
// FORCE MUST NOT MINT BUDGET. A `force` rebuild increments both call counters,
// does NOT reset `attempts`, is refused at either cap, and is refused inside the
// one-hour generation cooldown. An earlier draft reset `attempts` on every
// Rebuild press, re-arming three automatic generations per press, on a SHARED
// row, from a button rendered for every user.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { POST, GET } from "./route.js";
import {
  MAX_LIFETIME_MODEL_CALLS,
  MAX_ABSOLUTE_MODEL_CALLS,
} from "@/lib/copilot/glossaryConstants.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SELF = path.join(ROOT, "app/api/copilot/glossary/route.js");

const POSITION_ID = "11111111-1111-1111-1111-111111111111";
const APPLICATION_ID = "22222222-2222-2222-2222-222222222222";
const DESCRIPTION = [
  "Senior Platform Engineer, Payments.",
  "You will own our PostgreSQL estate and the payments ledger.",
  "We care about idempotency in every write path and about schema normalization.",
].join("\n");

let glossaryRow = null;
let applicationRows = [{ id: APPLICATION_ID, position_id: POSITION_ID, user_id: "user-1" }];
let positionRow = { id: POSITION_ID, title: "Senior Platform Engineer", company: "Acme", description: DESCRIPTION };
let adminWrites = [];
const generateContent = vi.fn();

function tableChain(result, single) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    limit: () => chain,
    order: () => chain,
    or: () => chain,
    update: (v) => (adminWrites.push(v), chain),
    upsert: (v) => (adminWrites.push(v), chain),
    insert: (v) => (adminWrites.push(v), chain),
    maybeSingle: async () => ({ data: single, error: null }),
    then: (res, rej) => Promise.resolve({ data: result, error: null }).then(res, rej),
  };
  return chain;
}

// The limiter lives at MODULE scope -- that is the property this file exists to
// pin -- so its counters survive between tests in this file. Every test
// therefore gets its own caller id, and only the two limiter cases below reuse
// one deliberately. Sharing an id instead would make every test after the
// five-request case fail with a 429 for reasons that have nothing to do with it.
let currentUserId = "user-1";

function userClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: currentUserId } }, error: null }) },
    from: (table) => {
      if (table === "applications") return tableChain(applicationRows, applicationRows[0] ?? null);
      if (table === "positions") return tableChain([positionRow], positionRow);
      return tableChain([], null);
    },
  };
}

function adminClient() {
  return {
    from: (table) => {
      if (table === "position_glossaries") return tableChain(glossaryRow ? [glossaryRow] : [], glossaryRow);
      if (table === "positions") return tableChain([positionRow], positionRow);
      return tableChain([], null);
    },
  };
}

const harvestResponse = () => ({
  text: JSON.stringify({
    terms: Array.from({ length: 12 }, (_, i) => ({
      term: `non compositional concept ${i}`,
      kind: "anticipated",
      category: "terminology",
      parent: "PostgreSQL",
      anchor_quote: "You will own our PostgreSQL estate and the payments ledger.",
      definition:
        "A precise explanation of this concept that is long enough to satisfy the definition contract used here.",
    })),
  }),
});

const postRequest = (body = { positionId: POSITION_ID }) =>
  new Request("http://localhost/api/copilot/glossary", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });

const getRequest = (query = `applicationId=${APPLICATION_ID}`) =>
  new Request(`http://localhost/api/copilot/glossary?${query}`);

let userCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  currentUserId = `user-${(userCounter += 1)}`;
  vi.stubEnv("GLOSSARY_DISABLED", "");
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  vi.stubEnv("RESUME_ENGINE", "gemini");
  glossaryRow = null;
  applicationRows = [{ id: APPLICATION_ID, position_id: POSITION_ID, user_id: "user-1" }];
  positionRow = { id: POSITION_ID, title: "Senior Platform Engineer", company: "Acme", description: DESCRIPTION };
  adminWrites = [];
  createClient.mockResolvedValue(userClient());
  createAdminClient.mockImplementation(() => adminClient());
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  generateContent.mockResolvedValue(harvestResponse());
  getGeminiClient.mockImplementation(() => ({ models: { generateContent } }));
});

afterEach(() => vi.unstubAllEnvs());

describe("R-351 / AC-C1: the limiter is at MODULE scope", () => {
  it("declares createRateLimiter before the exported handler", () => {
    const src = readFileSync(SELF, "utf8");
    const limiterAt = src.indexOf("createRateLimiter({");
    const handlerAt = src.indexOf("export async function POST");
    expect(limiterAt).toBeGreaterThan(-1);
    expect(handlerAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeLessThan(handlerAt);
  });

  it("denies the fifth generation in one hour, and a per-request limiter would not", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      glossaryRow = null;
      statuses.push((await POST(postRequest())).status);
    }
    expect(statuses.slice(0, 4).every((s) => s !== 429)).toBe(true);
    expect(statuses[4]).toBe(429);
  });

  it("emits the RateLimit headers only on the denial (AC-C2)", async () => {
    let denied = null;
    for (let i = 0; i < 6 && !denied; i += 1) {
      glossaryRow = null;
      const res = await POST(postRequest());
      if (res.status === 429) denied = res;
    }
    expect(denied).not.toBeNull();
    expect(denied.headers.get("Retry-After")).toBeTruthy();
    expect(denied.headers.get("RateLimit-Limit")).toBeTruthy();
  });

  it("AC-C5: a 429 writes no row and is never converted into a failed row", async () => {
    for (let i = 0; i < 4; i += 1) {
      glossaryRow = null;
      await POST(postRequest());
    }
    adminWrites = [];
    const res = await POST(postRequest());
    expect(res.status).toBe(429);
    expect(adminWrites).toHaveLength(0);
  });
});

describe("R-352 / AC-T6: the gates refuse before a model client is constructed", () => {
  it("gate 1 -- the kill switch is the first statement", async () => {
    vi.stubEnv("GLOSSARY_DISABLED", "1");
    const res = await POST(postRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "disabled" });
    expect(createClient).not.toHaveBeenCalled();
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("gate 2 -- an unauthenticated caller gets 401 and never reaches the model", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: () => tableChain([], null),
    });
    expect((await POST(postRequest())).status).toBe(401);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("gate 2 -- identity comes from getUser, NEVER getSession", () => {
    // getSession() makes ZERO network requests, so gating on it is not a weak
    // check, it is a total bypass.
    const src = readFileSync(SELF, "utf8");
    expect(src).toContain("auth.getUser()");
    expect(src).not.toContain("getSession");
  });

  it("gate 3 -- a malformed body is 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/copilot/glossary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{{{",
      }),
    );
    expect(res.status).toBe(400);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("gate 5 -- a missing or oversized id is 400", async () => {
    expect((await POST(postRequest({}))).status).toBe(400);
    expect((await POST(postRequest({ positionId: "x".repeat(101) }))).status).toBe(400);
    expect(getGeminiClient).not.toHaveBeenCalled();
  });

  it("gate 6 / R-353 -- a position the caller holds no application on is 403, zero calls, zero writes", async () => {
    applicationRows = [];
    const res = await POST(postRequest());
    expect(res.status).toBe(403);
    expect(generateContent).not.toHaveBeenCalled();
    expect(adminWrites).toHaveLength(0);
  });

  it("gate 13 -- an empty description writes `unavailable` with NO model call", async () => {
    positionRow = { ...positionRow, description: "   " };
    const res = await POST(postRequest());
    expect(res.status).toBe(200);
    expect(generateContent).not.toHaveBeenCalled();
    expect(adminWrites[0]).toMatchObject({ status: "unavailable", reason: "no-posting-text" });
  });

  it("gate 14 / AC-E4 -- the embedded engine makes ZERO outbound calls of either kind", async () => {
    const res = await POST(postRequest({ positionId: POSITION_ID, engine: "embedded" }));
    expect(res.status).toBe(200);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(getServerEnv).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
    expect(adminWrites[0]).toMatchObject({ status: "quotes-only", engine: "embedded" });
  });

  it("AC-E1 -- the embedded row is never selectable by the worker", async () => {
    await POST(postRequest({ positionId: POSITION_ID, engine: "embedded" }));
    expect(adminWrites[0]).toMatchObject({ research_total: 0, research_cursor: 0, recalled_count: 0 });
  });
});

describe("the cache gates spend nothing (gates 8-12)", () => {
  const baseRow = {
    position_id: POSITION_ID,
    status: "ready",
    posting_fingerprint: null,
    terms: [],
    researched_count: 12,
    recalled_count: 0,
    research_cursor: 1,
    research_total: 1,
    model_calls_fingerprint: 11,
    model_calls_total: 11,
    attempts: 1,
    last_generation_at: new Date(Date.now() - 86_400_000).toISOString(),
  };

  async function fingerprintOf() {
    const { postingFingerprint } = await import("@/lib/copilot/glossaryStore.js");
    return postingFingerprint(positionRow);
  }

  it("gate 8 -- a ready row on the same fingerprint is returned as-is, and `force` adds nothing", async () => {
    glossaryRow = { ...baseRow, posting_fingerprint: await fingerprintOf() };
    for (const body of [{ positionId: POSITION_ID }, { positionId: POSITION_ID, force: true }]) {
      generateContent.mockClear();
      adminWrites = [];
      const res = await POST(postRequest(body));
      expect(res.status).toBe(200);
      expect(generateContent).not.toHaveBeenCalled();
      expect(adminWrites).toHaveLength(0);
    }
  });

  it("gate 9 -- a generation already in flight is returned as-is, `force` INCLUDED", async () => {
    // This is what stops a Rebuild press re-rolling the harvest mid-research and
    // pulling the term list out from under the worker's cursor.
    glossaryRow = {
      ...baseRow,
      status: "partial",
      research_cursor: 3,
      research_total: 10,
      posting_fingerprint: await fingerprintOf(),
    };
    const res = await POST(postRequest({ positionId: POSITION_ID, force: true }));
    expect(res.status).toBe(200);
    expect(generateContent).not.toHaveBeenCalled();
    expect(adminWrites).toHaveLength(0);
  });

  it("gate 11 / R-377 -- the one-hour cooldown refuses a second generation, `force` INCLUDED", async () => {
    glossaryRow = {
      ...baseRow,
      status: "partial",
      researched_count: 1,
      recalled_count: 11,
      research_cursor: 1,
      research_total: 1,
      posting_fingerprint: "stale-fingerprint",
      last_generation_at: new Date(Date.now() - 60_000).toISOString(),
    };
    const res = await POST(postRequest({ positionId: POSITION_ID, force: true }));
    expect(generateContent).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ reason: "cooldown" });
  });

  it("gate 12 / R-376 -- the fingerprint cap refuses, and force does not mint budget", async () => {
    glossaryRow = {
      ...baseRow,
      status: "partial",
      posting_fingerprint: await fingerprintOf(),
      research_cursor: 1,
      research_total: 1,
      researched_count: 1,
      recalled_count: 11,
      model_calls_fingerprint: MAX_LIFETIME_MODEL_CALLS,
      model_calls_total: MAX_LIFETIME_MODEL_CALLS,
      last_generation_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    const res = await POST(postRequest({ positionId: POSITION_ID, force: true }));
    expect(generateContent).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ reason: "call-cap" });
  });

  it("gate 12 / R-376 -- the ABSOLUTE cap refuses even after a fingerprint change resets the other", async () => {
    // The fingerprint counter resets when the description changes, and anyone
    // who can rewrite a shared posting's description can cycle it. The absolute
    // counter is what makes the reset safe rather than an unbounded bypass.
    glossaryRow = {
      ...baseRow,
      status: "partial",
      posting_fingerprint: "a-different-posting-entirely",
      research_cursor: 1,
      research_total: 1,
      model_calls_fingerprint: 0,
      model_calls_total: MAX_ABSOLUTE_MODEL_CALLS,
      last_generation_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    const res = await POST(postRequest({ positionId: POSITION_ID, force: true }));
    expect(generateContent).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ reason: "call-cap" });
  });

  it("R-358 -- across a fingerprint change a rebuild IS allowed; it is not a demotion", async () => {
    glossaryRow = {
      ...baseRow,
      posting_fingerprint: "a-different-posting-entirely",
      last_generation_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    const res = await POST(postRequest({ positionId: POSITION_ID, force: true }));
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("R-358 / AC-E9 -- an embedded force rebuild over a partial row writes nothing", async () => {
    glossaryRow = {
      ...baseRow,
      status: "partial",
      research_cursor: 1,
      research_total: 1,
      posting_fingerprint: "a-different-posting-entirely",
      last_generation_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    const res = await POST(postRequest({ positionId: POSITION_ID, engine: "embedded", force: true }));
    expect(res.status).toBe(200);
    expect(adminWrites).toHaveLength(0);
  });
});

describe("R-361 / AC-C16': force increments both counters and resets nothing", () => {
  it("counts the harvest call against both counters and leaves attempts alone", async () => {
    glossaryRow = null;
    await POST(postRequest());
    expect(adminWrites[0]).toMatchObject({ model_calls_fingerprint: 1, model_calls_total: 1, attempts: 1 });
  });

  it("R-376 -- a fingerprint change resets the fingerprint counter and NOT the total", async () => {
    // The second half is the one a well-meaning refactor would delete.
    glossaryRow = {
      position_id: POSITION_ID,
      status: "partial",
      posting_fingerprint: "a-different-posting-entirely",
      terms: [],
      researched_count: 0,
      recalled_count: 0,
      research_cursor: 1,
      research_total: 1,
      model_calls_fingerprint: 30,
      model_calls_total: 30,
      attempts: 2,
      last_generation_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    await POST(postRequest({ positionId: POSITION_ID, force: true }));
    expect(adminWrites[0]).toMatchObject({ model_calls_fingerprint: 1, model_calls_total: 31, attempts: 3 });
  });
});

describe("AC-T10: the read route the UI will call", () => {
  it("resolves an applicationId to its position and returns the row", async () => {
    glossaryRow = { position_id: POSITION_ID, status: "partial", terms: [{ term: "x" }] };
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ glossary: { position_id: POSITION_ID } });
  });

  it("returns a null glossary rather than a 404 when no row exists yet", async () => {
    glossaryRow = null;
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ glossary: null });
  });

  it("401s an unauthenticated read", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: () => tableChain([], null),
    });
    expect((await GET(getRequest())).status).toBe(401);
  });

  it("403s a read for an application the caller does not hold", async () => {
    applicationRows = [];
    expect((await GET(getRequest())).status).toBe(403);
  });

  it("400s a read with neither id", async () => {
    expect((await GET(new Request("http://localhost/api/copilot/glossary"))).status).toBe(400);
  });

  it("makes NO model call, ever", async () => {
    glossaryRow = { position_id: POSITION_ID, status: "ready", terms: [] };
    await GET(getRequest());
    expect(getGeminiClient).not.toHaveBeenCalled();
  });
});
