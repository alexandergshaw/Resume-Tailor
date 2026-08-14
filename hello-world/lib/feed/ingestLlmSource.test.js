import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeSupabase } from "../../test/helpers/supabaseMock.js";

// Wiring tests for the AI-search source INSIDE ingestFeed.
//
// These exist because two individually-correct halves can still be joined wrong,
// and a composition defect is invisible to the pure unit tests in
// llmSearch.test.js by construction. Everything here is asserted by observable
// effect — was a model call actually issued, did the row reach the shared upsert
// — not by re-testing the pieces.

const generateContent = vi.fn();

vi.mock("@/lib/llm/geminiClient", () => ({
  getGeminiClient: () => ({ models: { generateContent } }),
}));

const POSTING_BODY = [
  "Senior React Engineer at Acme",
  "About the role: build product surfaces used by millions of people every day.",
  "Responsibilities: own features end to end, review code, and mentor other engineers.",
  "Qualifications: 5+ years of experience with React and TypeScript, strong testing habits.",
  "Benefits: health, dental, and generous PTO. Apply now to join the team.",
].join("\n");

const fetchUrlContent = vi.fn(async (url) => ({
  finalUrl: url,
  title: "Senior React Engineer",
  description: POSTING_BODY,
  publishedDate: "2026-08-01",
}));

vi.mock("@/lib/scrape/fetchUrlContent", () => ({ fetchUrlContent }));

// An in-memory Redis. Without this getRedisClient() returns null, every cadence
// code path is inert during the test, and an implementation that never wired the
// gate in at all passes — the single most expensive failure mode available here.
const store = new Map();
// Toggled by the resilience test below to make get/set reject like a Redis
// outage, so every helper that reads/writes through this client (lock,
// cursor, ai-search cadence, meta) exercises its documented "never take
// ingestion down over a cache hiccup" behavior end to end.
let redisRejects = false;
vi.mock("@/lib/cache/redisClient", () => ({
  default: () => ({
    get: async (k) => {
      if (redisRejects) throw new Error("redis get failed");
      return store.has(k) ? store.get(k) : null;
    },
    set: async (k, v, opts) => {
      if (redisRejects) throw new Error("redis set failed");
      if (opts?.nx && store.has(k)) return null;
      store.set(k, v);
      return "OK";
    },
    del: async (k) => void store.delete(k),
  }),
}));

function groundedResponse(urls) {
  return {
    text: `\`\`\`json\n${JSON.stringify({
      postings: urls.map((url, i) => ({
        title: `Senior React Engineer ${i}`,
        company: "Acme",
        location: "Remote",
        url,
      })),
    })}\n\`\`\``,
    candidates: [
      { groundingMetadata: { groundingChunks: urls.map((uri) => ({ web: { uri, title: "s" } })) } },
    ],
  };
}

const SEARCH = {
  id: "s1",
  user_id: "u1",
  name: "Remote React",
  job_keywords: ["react", "remote"],
  excluded_title_keywords: [],
  excluded_companies: [],
  max_years_exp: "any",
  auto_tailor_enabled: true,
  email_on_new_jobs: false,
};

function adminWith({ savedSearches = [SEARCH], knownFeedUrls = [] } = {}) {
  return makeSupabase(
    {
      saved_searches: { data: savedSearches },
      feed_postings: {
        select: { data: knownFeedUrls.map((url) => ({ url })) },
        upsert: { data: null, error: null },
      },
    },
    { rpc: { prune_feed_postings: 0 } },
  );
}

const upsertCalls = (admin) => admin.calls.feed_postings?.upsert || [];
const upsertedRows = (admin) => upsertCalls(admin).flatMap(([rows]) => rows || []);
const aiRows = (admin) => upsertedRows(admin).filter((r) => r.source === "ai_search");

async function runIngest(admin) {
  // Imported per test so env changes are picked up at module init.
  const { ingestFeed } = await import("./ingestFeed.js");
  return ingestFeed(admin);
}

describe("ingestFeed — AI search source wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    store.clear();
    redisRejects = false;
    generateContent.mockReset();
    generateContent.mockResolvedValue(groundedResponse(["https://acme.com/jobs/1"]));
    fetchUrlContent.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ jobs: [] }), text: async () => "<rss></rss>" })),
    );
    vi.stubEnv("Gemini_LLM_API_Key", "test-key");
    vi.stubEnv("RESUME_ENGINE", "gemini");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("issues the grounded search and upserts the verified posting", async () => {
    const admin = adminWith();
    const summary = await runIngest(admin);

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(aiRows(admin)).toHaveLength(1);
    expect(aiRows(admin)[0].url).toBe("https://acme.com/jobs/1");
    expect(summary.ok).toBe(true);
  });

  it("reports the source in sourceHealth alongside the boards", async () => {
    const summary = await runIngest(adminWith());
    expect(summary.sourceHealth).toHaveProperty("ai_search");
    // The pre-existing sources must still be reported — this source is added
    // beside them, not in place of them.
    expect(summary.sourceHealth).toHaveProperty("greenhouse");
    expect(summary.sourceHealth).toHaveProperty("lever");
  });

  it("counts the AI source in the run totals like every other source", async () => {
    const summary = await runIngest(adminWith());
    expect(summary.sourceHealth.ai_search.fetched).toBe(1);
    expect(summary.itemsFetched).toBeGreaterThanOrEqual(1);
  });

  it("puts the AI rows through the SHARED chunked upsert, not a private one", async () => {
    // A source that runs its own admin.from("feed_postings").upsert(...)
    // produces identical rows and passes every other assertion here, while
    // skipping chunking, the exact-count tally and the updated_at stamp.
    const admin = adminWith();
    await runIngest(admin);

    const withAiRows = upsertCalls(admin).filter(([rows]) => (rows || []).some((r) => r.source === "ai_search"));
    expect(withAiRows).toHaveLength(1);
    const [rows, options] = withAiRows[0];
    expect(options).toEqual({ onConflict: "dedup_key", count: "exact" });
    for (const row of rows) expect(row.updated_at).toBeTruthy();
  });
});

describe("ingestFeed — the cadence gate, observed through the run", () => {
  beforeEach(() => {
    vi.resetModules();
    store.clear();
    redisRejects = false;
    generateContent.mockReset();
    generateContent.mockResolvedValue(groundedResponse(["https://acme.com/jobs/1"]));
    fetchUrlContent.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ jobs: [] }), text: async () => "<rss></rss>" })),
    );
    vi.stubEnv("Gemini_LLM_API_Key", "test-key");
    vi.stubEnv("RESUME_ENGINE", "gemini");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does not issue a second grounded search inside the cadence window", async () => {
    // /api/cron/feed-ingest fires EVERY MINUTE (R-202). shouldRunLlmSearch being
    // unit-tested proves nothing unless ingestFeed actually calls it.
    await runIngest(adminWith());
    expect(generateContent).toHaveBeenCalledTimes(1);

    const summary = await runIngest(adminWith());
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(summary.sourceHealth.ai_search.skipped).toBeTruthy();
  });

  it("a skipped run does not consume the cadence window", async () => {
    vi.stubEnv("RESUME_ENGINE", "embedded");
    await runIngest(adminWith());
    expect(generateContent).not.toHaveBeenCalled();

    vi.stubEnv("RESUME_ENGINE", "gemini");
    await runIngest(adminWith());
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("caps how many pages one run may fetch, at the call site not just the helper", async () => {
    generateContent.mockResolvedValue(
      groundedResponse(Array.from({ length: 40 }, (_, i) => `https://acme.com/jobs/${i}`)),
    );
    await runIngest(adminWith());
    expect(fetchUrlContent.mock.calls.length).toBeGreaterThan(0);
    expect(fetchUrlContent.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it("splits the per-run fetch budget across every distinct query due this run", async () => {
    // The existing cap test above only exercises a single saved search, so it
    // cannot tell "perQueryMaxPostings divides the run budget" apart from
    // "each query independently caps itself at the run budget" — the latter
    // would let three simultaneous queries spend 10 fetches each, 30 total.
    generateContent.mockResolvedValue(
      groundedResponse(Array.from({ length: 40 }, (_, i) => `https://acme.com/jobs/${i}`)),
    );
    const admin = adminWith({
      savedSearches: [
        { ...SEARCH, id: "s1", user_id: "u1", job_keywords: ["react", "remote"] },
        { ...SEARCH, id: "s2", user_id: "u2", job_keywords: ["python", "remote"] },
        { ...SEARCH, id: "s3", user_id: "u3", job_keywords: ["rust", "remote"] },
      ],
    });
    await runIngest(admin);

    expect(generateContent).toHaveBeenCalledTimes(3); // three distinct queries, all due
    expect(fetchUrlContent.mock.calls.length).toBeGreaterThan(0);
    expect(fetchUrlContent.mock.calls.length).toBeLessThanOrEqual(10);
  });
});

describe("ingestFeed — AI search skips and failures", () => {
  beforeEach(() => {
    vi.resetModules();
    store.clear();
    redisRejects = false;
    generateContent.mockReset();
    generateContent.mockResolvedValue(groundedResponse(["https://acme.com/jobs/1"]));
    fetchUrlContent.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ jobs: [] }), text: async () => "<rss></rss>" })),
    );
    vi.stubEnv("Gemini_LLM_API_Key", "test-key");
    vi.stubEnv("RESUME_ENGINE", "gemini");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("makes no model call when Gemini is not configured", async () => {
    vi.stubEnv("Gemini_LLM_API_Key", "");
    const summary = await runIngest(adminWith());
    expect(generateContent).not.toHaveBeenCalled();
    expect(summary.ok).toBe(true);
    expect(summary.sourceHealth.ai_search.skipped).toBeTruthy();
  });

  it("makes no model call when the deployment runs the embedded engine", async () => {
    // Engine choice governs every AI feature in this app, not just tailoring.
    vi.stubEnv("RESUME_ENGINE", "embedded");
    const summary = await runIngest(adminWith());
    expect(generateContent).not.toHaveBeenCalled();
    expect(summary.sourceHealth.ai_search.skipped).toBeTruthy();
  });

  it("makes no model call when no saved search asked for automated work", async () => {
    const admin = adminWith({
      savedSearches: [{ ...SEARCH, auto_tailor_enabled: false, email_on_new_jobs: false }],
    });
    await runIngest(admin);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("does not let a model failure abort the run or the other sources", async () => {
    generateContent.mockRejectedValue(new Error("503 unavailable"));
    const admin = adminWith();
    const summary = await runIngest(admin);

    expect(summary.ok).toBe(true);
    expect(admin.calls.rpc).toContainEqual(["prune_feed_postings", { retention_hours: 36 }]);
    expect(summary.sourceHealth.ai_search.failures).toBeGreaterThan(0);
  });

  it("does not fail the run when the Redis client's get and set reject", async () => {
    // readAiSearchLastRun/writeAiSearchLastRun (and every other Redis helper
    // in ingestFeed.js) swallow errors by design — a cache hiccup must never
    // take ingestion down. This exercises that through the real run rather
    // than unit-testing the helpers in isolation.
    redisRejects = true;
    const summary = await runIngest(adminWith());
    expect(summary.ok).toBe(true);
  });

  it("bounds the cross-source dedupe read instead of selecting the whole table", async () => {
    // The dedupe reads feed_postings.url on every AI-search run. Left
    // unbounded it is a full-table scan inside a serverless function, and if
    // PostgREST's row ceiling truncates it the dedupe silently covers an
    // arbitrary subset — the feature quietly stops doing the one thing it
    // exists to do. Bounded AND ordered by recency, so a truncation keeps the
    // rows most likely to collide with a posting found today.
    const admin = adminWith();
    await runIngest(admin);

    const limits = admin.calls.feed_postings?.limit || [];
    expect(limits.length).toBeGreaterThan(0);
    expect(limits[0][0]).toBeGreaterThan(0);
    expect(admin.calls.feed_postings?.order || []).not.toHaveLength(0);
  });

  it("drops a posting the feed already holds under another source", async () => {
    // Same job, found by both Greenhouse and the AI search: the user must not
    // get two cards and two auto-tailored applications for one job.
    const admin = adminWith({ knownFeedUrls: ["https://www.acme.com/jobs/1?utm_source=gh"] });
    await runIngest(admin);
    expect(aiRows(admin)).toEqual([]);
  });

  // Positive control for the drop above.
  it("keeps a posting the feed does not already hold", async () => {
    const admin = adminWith({ knownFeedUrls: ["https://acme.com/jobs/other"] });
    await runIngest(admin);
    expect(aiRows(admin)).toHaveLength(1);
  });
});
