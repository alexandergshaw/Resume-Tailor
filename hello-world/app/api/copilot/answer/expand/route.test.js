// POST /api/copilot/answer/expand -- one drafted bullet, expanded on demand.
//
// This is the app's second authenticated, paid, per-click endpoint, and the
// first that a user can fire once per bullet per answer. Its whole spend
// surface is here: the kill switch, the per-user bound, the validation that
// refuses before anything is read, and the two engines.
//
// USER IDS ARE UNIQUE PER CASE, deliberately, exactly as the ask route's suite
// does it: the limiter is a module singleton (that is the point), so its
// counters survive between `it()` blocks here just as they survive between
// requests in a running server. Sharing one id would let an early case's
// requests deny a later one.
//
// Type B red: the route does not exist yet.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { createClient } from "@/lib/supabase/server";
import { answerContextCache } from "@/lib/copilot/answerSessionCache";
import { MAX_QUESTION_CHARS } from "@/lib/copilot/questionVocabulary";
import { MAX_PARENT_POINT_CHARS } from "@/lib/copilot/expansionContract";

const ROUTE_SOURCE = readFileSync(
  path.join(process.cwd(), "app/api/copilot/answer/expand/route.js"),
  "utf8",
);
// Source assertions are about CODE, not prose: this route's comments name the
// very things they forbid (getSession, err.message) in order to say why they
// are never used, so a raw grep would fail on the documentation that exists to
// prevent the defect.
const ROUTE_CODE = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PAGE = {
  id: "p1",
  title: "Settlement ledger rebuild",
  archived_at: null,
  generated_kind: null,
  body: [
    "- I reconciled every settlement by hand for a week.",
    "- I wrote the replay script that closed the ledger gap.",
    "- I paged the on-call team twice during the incident.",
  ].join("\n"),
};

const QUESTION = "Tell me about the settlement ledger rebuild.";
const PARENT = "I rebuilt the ledger after the settlement outage.";
const POINTS = ["Situation: I rebuilt the ledger after the settlement outage.", "Action: I paged the on-call team."];

function jsonRequest(body) {
  return { json: async () => body, headers: new Headers() };
}

function mockSupabase({ id = "user-1", pages = [PAGE] } = {}) {
  const tables = [];
  const from = vi.fn((table) => {
    tables.push(table);
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      is: vi.fn(() => chain),
      order: vi.fn(async () => (table === "experience_pages" ? { data: pages, error: null } : { data: null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    return chain;
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: id ? { id } : null } }) },
    from,
  });
  return { from, tables };
}

function mockGemini(text) {
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn().mockResolvedValue({ text });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

function body(overrides = {}) {
  return {
    question: QUESTION,
    parentPoint: PARENT,
    points: POINTS,
    pointIndex: 0,
    applicationId: "app-1",
    engine: "embedded",
    ...overrides,
  };
}

let userSeq = 0;
function freshUser() {
  userSeq += 1;
  return `user-${userSeq}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  answerContextCache.clear();
  delete process.env.COPILOT_EXPANSION_DISABLED;
});

// ---------------------------------------------------------------------------
// A. The kill switch, identity, and the bound -- in that order
// ---------------------------------------------------------------------------
describe("the operator can turn this off without a deploy", () => {
  it("503s with code 'disabled', constructing no Supabase client and calling no model", async () => {
    process.env.COPILOT_EXPANSION_DISABLED = "1";
    const generateContent = mockGemini("unused");
    const res = await POST(jsonRequest(body({ engine: "gemini" })));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("disabled");
    expect(createClient).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("does NOT use wantsEmbedded as the kill switch", () => {
    // featureEngine returns on the CLIENT'S OWN body.engine before it ever
    // reads env.RESUME_ENGINE, so a client sending engine:"gemini" gets a
    // model call no matter what the server default says. Setting
    // RESUME_ENGINE=embedded is therefore not an off switch, and the flag read
    // must be its own thing at the top of the handler.
    expect(ROUTE_CODE).toContain("COPILOT_EXPANSION_DISABLED");
    const flagAt = ROUTE_CODE.indexOf("COPILOT_EXPANSION_DISABLED");
    const embeddedAt = ROUTE_CODE.indexOf("wantsEmbedded(");
    expect(flagAt).toBeGreaterThan(-1);
    expect(embeddedAt).toBeGreaterThan(flagAt);
  });
});

describe("identity is resolved before anything is read", () => {
  it("401s with no signed-in user and reads no table", async () => {
    const { from } = mockSupabase({ id: null });
    const res = await POST(jsonRequest(body()));
    expect(res.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("never gates on getSession(), which makes zero network requests", () => {
    expect(ROUTE_CODE).not.toMatch(/getSession/);
    expect(ROUTE_CODE).toMatch(/auth\.getUser\(\)/);
  });
});

describe("the spend ceiling actually bites", () => {
  it("denies past the bound with 429 and rate-limit headers", async () => {
    mockSupabase({ id: "greedy-expander" });
    const statuses = [];
    for (let i = 0; i < 41; i += 1) {
      const res = await POST(jsonRequest(body()));
      statuses.push(res.status);
    }
    // A limiter built INSIDE the handler gets a fresh store per request, so
    // every caller is forever on its first request and all 41 succeed. This
    // assertion is what catches that, which is why the loop runs past the
    // bound rather than stopping at it.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    const denied = await POST(jsonRequest(body()));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("builds the limiter at MODULE scope, never inside the handler", () => {
    // The static half. A per-request limiter counts nothing while looking
    // correct, so both halves are kept: the behavioural one proves the bound
    // today, this one proves the construction that makes the bound survivable.
    const declaration = /^const \w+ = createRateLimiter\(/m;
    expect(ROUTE_SOURCE).toMatch(declaration);
    const limiterAt = ROUTE_SOURCE.search(declaration);
    const handlerAt = ROUTE_SOURCE.indexOf("export async function POST");
    expect(limiterAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeLessThan(handlerAt);
    expect(ROUTE_SOURCE.slice(handlerAt)).not.toMatch(/createRateLimiter\(/);
  });

  it("keys the bound on the SERVER-RESOLVED user id, never on a body field", () => {
    // MUTATION PROOF: replace `identify(request, { userId: user.id })` with
    // `identify(request)` -- which falls back to the client IP -- and the
    // two-users case below goes red.
    expect(ROUTE_CODE).toMatch(/identify\(request,\s*\{\s*userId:\s*user\.id\s*\}\)/);
  });

  it("does not let one user's spending deny another's", async () => {
    mockSupabase({ id: "tenant-hungry" });
    for (let i = 0; i < 41; i += 1) await POST(jsonRequest(body()));
    mockSupabase({ id: "tenant-innocent" });
    const res = await POST(jsonRequest(body()));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// B. Validation -- refused before a single Supabase data read or model call
// ---------------------------------------------------------------------------
describe("the wire is self-checking", () => {
  async function rejects(overrides) {
    const { from } = mockSupabase({ id: freshUser() });
    const generateContent = mockGemini("unused");
    const res = await POST(jsonRequest(body(overrides)));
    expect(from).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
    return res;
  }

  it("ACCEPTS a labelled point whose parentPoint is label-stripped", async () => {
    // THE DEFECT THIS PINS. `points` carries the RAW drafted points, STAR
    // labels included; `parentPoint` is `line.point`, which answerLines has
    // already stripped. Comparing them raw makes every labelled point 400 --
    // which is most points on the behavioural path -- so every real expansion
    // fails while a fixture of unlabelled points passes. The route strips the
    // label with the SAME imported function answerLines uses before comparing.
    mockSupabase({ id: freshUser() });
    const res = await POST(jsonRequest(body({ pointIndex: 0, parentPoint: PARENT })));
    expect(res.status).toBe(200);
  });

  it("400s when pointIndex names a different point than parentPoint", async () => {
    const res = await rejects({ pointIndex: 1, parentPoint: PARENT });
    expect(res.status).toBe(400);
  });

  it("400s a client that sent the RENDERED line index instead of the source index", async () => {
    // The shortest array in which the two differ: "Situation:" is dropped only
    // AFTER the map, so "B sentence." renders at line index 1 and lives at
    // source index 3. A client sending 1 elaborates the wrong bullet --
    // silently, with the right count and the right citation shape.
    const points = ["Situation:", "A sentence.", "", "B sentence."];
    const bad = await rejects({ points, pointIndex: 1, parentPoint: "B sentence." });
    expect(bad.status).toBe(400);

    mockSupabase({ id: freshUser() });
    const good = await POST(jsonRequest(body({ points, pointIndex: 3, parentPoint: "B sentence." })));
    expect(good.status).toBe(200);
  });

  it("400s a non-integer, negative or out-of-range pointIndex", async () => {
    for (const pointIndex of [null, "0", 1.5, -1, 99]) {
      expect((await rejects({ pointIndex })).status).toBe(400);
    }
  });

  it("400s more points than an answer can have", async () => {
    const points = Array.from({ length: 7 }, (_, i) => `Point ${i} sentence here.`);
    expect((await rejects({ points, pointIndex: 0, parentPoint: "Point 0 sentence here." })).status).toBe(400);
  });

  it("REJECTS a missing applicationId rather than quietly degrading", async () => {
    // Omitting it is not merely a cache miss: the context key becomes
    // `${userId}::`, a DIFFERENT and also-cacheable entry with an empty
    // resume, cover letter and posting, so the sub-bullets would be drafted
    // with no resume at all and nothing would say so.
    expect((await rejects({ applicationId: "" })).status).toBe(400);
    expect((await rejects({ applicationId: undefined })).status).toBe(400);
  });

  it("refuses rather than coerces a non-string field", async () => {
    expect((await rejects({ parentPoint: 42 })).status).toBe(400);
    expect((await rejects({ points: "not an array" })).status).toBe(400);
    expect((await rejects({ applicationId: {} })).status).toBe(400);
  });

  it("400s an over-cap question or parent point instead of answering a shorter one", async () => {
    expect((await rejects({ question: "q".repeat(MAX_QUESTION_CHARS + 1) })).status).toBe(400);
    const long = "I ".repeat(MAX_PARENT_POINT_CHARS);
    expect((await rejects({ parentPoint: long, points: [long], pointIndex: 0 })).status).toBe(400);
  });

  it("400s an unparseable body", async () => {
    mockSupabase({ id: freshUser() });
    const res = await POST({
      json: async () => {
        throw new Error("bad json");
      },
      headers: new Headers(),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// C. The embedded engine -- mandatory, not a fallback
// ---------------------------------------------------------------------------
describe("the embedded engine", () => {
  it("returns sub-bullets with zero model calls and no model client constructed", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini("unused");
    const res = await POST(jsonRequest(body({ engine: "embedded" })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.subBullets.length).toBeGreaterThan(0);
    expect(json.empty).toBe(false);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("says which engine and which material produced the text", async () => {
    mockSupabase({ id: freshUser() });
    const json = await (await POST(jsonRequest(body({ engine: "embedded" })))).json();
    expect(json.caption).toContain("no AI provider");
    expect(json.caption).toContain("Settlement ledger rebuild");
  });

  it("carries a resolved page citation and a source reference on every sub-bullet", async () => {
    mockSupabase({ id: freshUser() });
    const json = await (await POST(jsonRequest(body({ engine: "embedded" })))).json();
    for (const sub of json.subBullets) {
      expect(sub.pageSource).toEqual({ id: "p1", title: "Settlement ledger rebuild" });
      expect(sub.source).toMatchObject({ kind: "page", pageId: "p1" });
      expect(typeof sub.text).toBe("string");
    }
  });

  it("costs ZERO Supabase data reads on the second expansion of a session", async () => {
    // The warm-context guarantee. Without it, five expansions of one answer
    // cost thirty-five queries, and the route still passes every other test in
    // this file.
    const id = freshUser();
    const { from } = mockSupabase({ id });
    await POST(jsonRequest(body()));
    const afterFirst = from.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    await POST(jsonRequest(body({ pointIndex: 1, parentPoint: "I paged the on-call team." })));
    expect(from.mock.calls.length).toBe(afterFirst);
  });
});

// ---------------------------------------------------------------------------
// D. Honest empty is a SUCCESS, not an error
// ---------------------------------------------------------------------------
describe("nothing to say is a 200", () => {
  it("returns the empty marker rather than a 502 when the material yields nothing", async () => {
    // Four sites in the answer route return
    // `502 { error: "Could not generate an answer." }` when points is empty,
    // and on two of them -- the embedded branches -- nothing had failed. That
    // precedent renders an error alert over a truthful "there is nothing more
    // here", and it is deliberately not copied.
    mockSupabase({ id: freshUser(), pages: [] });
    const res = await POST(jsonRequest(body()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.empty).toBe(true);
    expect(json.subBullets).toEqual([]);
    expect(json.error).toBeUndefined();
  });

  it("returns the empty marker when the page did not clear the honesty gate", async () => {
    mockSupabase({ id: freshUser() });
    const res = await POST(
      jsonRequest(body({ question: "Tell me about a time you had a difficult problem." })),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).empty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. The Gemini engine
// ---------------------------------------------------------------------------
describe("the Gemini engine", () => {
  it("makes exactly ONE model call and filters its output for provenance", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(
      JSON.stringify({
        subBullets: [
          "I reconciled every settlement by hand for a week.",
          "I rewrote the whole platform in Rust over one weekend.",
        ],
      }),
    );
    const res = await POST(jsonRequest(body({ engine: "gemini" })));
    expect(generateContent).toHaveBeenCalledTimes(1);
    const json = await res.json();
    // The first is quoted whole out of the cited page; the second is invented.
    expect(json.subBullets.map((s) => s.text)).toEqual([
      "I reconciled every settlement by hand for a week.",
    ]);
    expect(json.caption).toContain("Gemini");
  });

  it("sends no tools, no thinking budget and a bounded prompt", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(JSON.stringify({ subBullets: [] }));
    await POST(jsonRequest(body({ engine: "gemini" })));
    const call = generateContent.mock.calls[0][0];
    expect(call.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(call.config.tools).toBeUndefined();
    expect(JSON.stringify(call)).not.toContain("googleSearch");
    expect(JSON.stringify(call)).not.toContain("urlContext");
  });

  it("times the model call out rather than hanging the interviewee", async () => {
    // 4000ms, deliberately SHORTER than the client's own 6000ms budget, so
    // that when both fire it is the server's diagnosis that wins the race and
    // the reader is told what actually happened rather than "network error".
    // Asserted as constant-plus-use rather than as one literal, so a second
    // hard-coded timeout somewhere else in the file cannot satisfy it.
    expect(ROUTE_CODE).toContain("const MODEL_TIMEOUT_MS = 4000;");
    expect(ROUTE_CODE).toContain("AbortSignal.timeout(MODEL_TIMEOUT_MS)");
  });

  it("actually hands that signal to the model call", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(JSON.stringify({ subBullets: [] }));
    await POST(jsonRequest(body({ engine: "gemini" })));
    const { abortSignal } = generateContent.mock.calls[0][0].config;
    expect(abortSignal).toBeInstanceOf(AbortSignal);
    expect(abortSignal.aborted).toBe(false);
  });

  it("returns 504 with a code, not a 200, when the model call is aborted", async () => {
    mockSupabase({ id: freshUser() });
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    const err = new Error("aborted");
    err.name = "TimeoutError";
    getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn().mockRejectedValue(err) } });
    const res = await POST(jsonRequest(body({ engine: "gemini" })));
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("expansion_timeout");
  });

  it("does NOT silently fall back to the deterministic path on a model failure", async () => {
    // The route template it otherwise follows degrades a failed Gemini call to
    // the local drafter and surfaces it only as `source: "fallback"`. That
    // would make the caption LIE about which engine produced the text, which
    // is the same defect class this feature is careful about one level up.
    mockSupabase({ id: freshUser() });
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("provider exploded")) },
    });
    const res = await POST(jsonRequest(body({ engine: "gemini" })));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(ROUTE_CODE).not.toMatch(/fallback/);
  });

  it("never returns the provider's own error string", async () => {
    mockSupabase({ id: freshUser() });
    getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("SECRET-PROVIDER-DETAIL")) },
    });
    const res = await POST(jsonRequest(body({ engine: "gemini" })));
    expect(JSON.stringify(await res.json())).not.toContain("SECRET-PROVIDER-DETAIL");
    expect(ROUTE_CODE).not.toMatch(/err\?\.message/);
  });
});

// ---------------------------------------------------------------------------
// F. What this route must never do
// ---------------------------------------------------------------------------
describe("the route's blast radius", () => {
  it("accepts no grounding from the request body", async () => {
    mockSupabase({ id: freshUser() });
    const generateContent = mockGemini(JSON.stringify({ subBullets: [] }));
    await POST(
      jsonRequest(body({ engine: "gemini", resume: "INJECTED RESUME", coverLetter: "INJECTED LETTER" })),
    );
    const sent = JSON.stringify(generateContent.mock.calls[0][0]);
    expect(sent).not.toContain("INJECTED RESUME");
    expect(sent).not.toContain("INJECTED LETTER");
  });

  it("goes through the shared context cache, never a second createTtlCache", () => {
    // A second instance is always cold, so every expansion misses forever --
    // and the route test files that .clear() the shared instance stop
    // isolating it.
    expect(ROUTE_CODE).not.toContain("createTtlCache");
    expect(ROUTE_CODE).toContain("loadAnswerContext");
    expect(ROUTE_CODE).toContain("answerContextKey");
  });

  it("touches neither the ideal-project benchmark nor company facts", () => {
    // Neither is the candidate's own experience, so neither may become
    // "further detail" about something they did.
    for (const forbidden of ["idealProject", "answerCompanyFacts", "answerAids", "startCompanyFacts"]) {
      expect(ROUTE_CODE).not.toContain(forbidden);
    }
  });

  it("has no stream field: this is not a streaming endpoint", () => {
    expect(ROUTE_CODE).not.toMatch(/stream/i);
  });

  it("re-validates a page id against THIS request's own whitelist", () => {
    expect(ROUTE_CODE).not.toContain("includedPages: []");
    expect(ROUTE_SOURCE).toContain("normalizeSubBullets");
  });
});
