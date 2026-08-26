import { describe, it, expect, vi } from "vitest";
import { fetchLlmSearchPostings, shouldRunLlmSearch } from "@/lib/feed/llmSearch";
import { selectQueueCandidates } from "@/lib/feed/selectQueueCandidates";
import { snippetFrom, remoteTypeFor, extractMinYearsRequired } from "@/lib/feed/normalize";

// Spied, not stubbed: the real implementations still run. This is the only way
// to tell "used the shared normalizers" apart from "hand-rolled something that
// happens to produce the same values", which a 12-line private copy does.
vi.mock("@/lib/feed/normalize", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    snippetFrom: vi.fn(actual.snippetFrom),
    remoteTypeFor: vi.fn(actual.remoteTypeFor),
    extractMinYearsRequired: vi.fn(actual.extractMinYearsRequired),
  };
});

// The whole point of this module is that NOTHING the model says about a posting
// is trusted except the URL, and even the URL is only trusted once we have
// fetched it ourselves. Every test below exists because the alternative is a
// fabricated job landing in a global table and getting a resume tailored to it.

const POSTING_BODY = [
  "Senior React Engineer at Acme",
  "About the role: build product surfaces used by millions of people every day.",
  "Responsibilities: own features end to end, review code, and mentor other engineers.",
  "Qualifications: 5+ years of experience with React and TypeScript, strong testing habits.",
  "Benefits: health, dental, and generous PTO. Apply now to join the team.",
].join("\n");

function modelResponse(postings, groundedUris = ["https://acme.com/x"]) {
  return {
    text: `Found some roles!\n\`\`\`json\n${JSON.stringify({ postings })}\n\`\`\``,
    candidates: [
      {
        groundingMetadata: {
          groundingChunks: groundedUris.map((uri) => ({ web: { uri, title: "src" } })),
        },
      },
    ],
  };
}

function clientReturning(response) {
  return { models: { generateContent: vi.fn().mockResolvedValue(response) } };
}

const okFetch = (over = {}) =>
  vi.fn().mockResolvedValue({
    finalUrl: "https://acme.com/jobs/1",
    title: "Senior React Engineer",
    description: POSTING_BODY,
    publishedDate: "2026-08-01",
    ...over,
  });

const baseArgs = {
  query: { key: "k1", query: "remote react jobs", keywords: ["react"], excludedTitleKeywords: [], excludedCompanies: [] },
  model: "gemini-2.5-flash",
};

const candidate = (over = {}) => ({
  title: "Senior React Engineer",
  company: "Acme",
  location: "Remote",
  url: "https://acme.com/jobs/1",
  ...over,
});

describe("fetchLlmSearchPostings — the search call itself", () => {
  it("asks Gemini with the googleSearch tool enabled", async () => {
    // Without the tool the model answers from training data and every result is
    // stale or invented — there is no grounding metadata to check it against.
    const client = clientReturning(modelResponse([candidate()]));
    await fetchLlmSearchPostings({ ...baseArgs, client, fetchUrl: okFetch() });

    const call = client.models.generateContent.mock.calls[0][0];
    // `config.tools`, NOT `call.tools`. This is an INJECTED FAKE client: it
    // sees whatever object the module hands it and cannot observe the SDK
    // layer that DISCARDS a top-level `tools`, so the comment above described
    // a tool the request never carried. The second assertion stops that shape
    // returning; llmSearch.wire.test.js proves it on the actual bytes.
    expect(call.config?.tools).toEqual([{ googleSearch: {} }]);
    expect(call.tools).toBeUndefined();
    expect(call.model).toBe("gemini-2.5-flash");
    expect(String(call.contents)).toContain("remote react jobs");
  });

  it("reports a model failure instead of throwing, so one source cannot abort the run", async () => {
    const client = { models: { generateContent: vi.fn().mockRejectedValue(new Error("429 quota")) } };
    const result = await fetchLlmSearchPostings({ ...baseArgs, client, fetchUrl: okFetch() });
    expect(result.ok).toBe(false);
    expect(result.postings).toEqual([]);
    expect(String(result.error)).toContain("429");
  });

  it("folds the query's exclusions into the prompt sent to Gemini", async () => {
    // Filtering happens twice by design: as a hint in the prompt (asserted
    // here) and again in code as the real gate (covered elsewhere). Both
    // halves need coverage — a model that ignores the hint still has to be
    // caught by the code-side filter, but the hint itself can silently rot.
    const client = clientReturning(modelResponse([candidate()]));
    await fetchLlmSearchPostings({
      ...baseArgs,
      query: {
        ...baseArgs.query,
        excludedTitleKeywords: ["senior", "staff"],
        excludedCompanies: ["initech"],
      },
      client,
      fetchUrl: okFetch(),
    });

    const call = client.models.generateContent.mock.calls[0][0];
    const contents = String(call.contents);
    expect(contents).toContain("senior");
    expect(contents).toContain("staff");
    expect(contents).toContain("initech");
  });
});

describe("fetchLlmSearchPostings — the verification gate", () => {
  it("verifies every surviving posting by fetching its page", async () => {
    const fetchUrl = okFetch();
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(modelResponse([candidate()])),
      fetchUrl,
    });

    expect(result.ok).toBe(true);
    expect(result.postings).toHaveLength(1);
    expect(fetchUrl).toHaveBeenCalledWith("https://acme.com/jobs/1");
  });

  it("drops a posting whose page cannot be read", async () => {
    const fetchUrl = vi.fn().mockResolvedValue({ error: "HTTP 404" });
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(modelResponse([candidate()])),
      fetchUrl,
    });
    expect(result.postings).toEqual([]);
    // The run itself still succeeded — an unverifiable result is a normal
    // outcome, not a source failure.
    expect(result.ok).toBe(true);
  });

  it("drops a posting whose page is not a job posting", async () => {
    const fetchUrl = okFetch({ description: "Welcome to our careers page. See all openings." });
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(modelResponse([candidate()])),
      fetchUrl,
    });
    expect(result.postings).toEqual([]);
  });

  it("drops a posting from a host the model never actually searched", async () => {
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(
        modelResponse([candidate({ url: "https://invented.example/jobs/1" })], ["https://acme.com/x"]),
      ),
      fetchUrl: okFetch({ finalUrl: "https://invented.example/jobs/1" }),
    });
    expect(result.postings).toEqual([]);
  });

  it("keeps the verifiable posting when it is mixed in with unverifiable ones", async () => {
    // The positive control for all four drops above: an implementation that
    // returned [] unconditionally would satisfy every one of them.
    const fetchUrl = vi.fn(async (url) => {
      if (url === "https://acme.com/jobs/1") {
        return { finalUrl: url, title: "Senior React Engineer", description: POSTING_BODY, publishedDate: "2026-08-01" };
      }
      return { error: "HTTP 404" };
    });
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(
        modelResponse([
          candidate({ url: "https://acme.com/dead-link" }),
          candidate(),
          candidate({ url: "https://acme.com/also-dead" }),
        ]),
      ),
      fetchUrl,
    });
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0].url).toBe("https://acme.com/jobs/1");
  });
});

describe("fetchLlmSearchPostings — what actually gets stored", () => {
  async function onePosting(over = {}, fetchOver = {}) {
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(modelResponse([candidate(over)])),
      fetchUrl: okFetch(fetchOver),
    });
    return result.postings[0];
  }

  it("takes the description from the fetched page, never from the model", async () => {
    const row = await onePosting();
    expect(row.raw_data.description).toBe(POSTING_BODY);
    expect(row.description_snippet).toContain("Senior React Engineer");
  });

  it("stores the resolved final URL, not the link the model produced", async () => {
    const row = await onePosting(
      { url: "https://acme.com/jobs/1" },
      { finalUrl: "https://acme.com/careers/senior-react-engineer" },
    );
    expect(row.url).toBe("https://acme.com/careers/senior-react-engineer");
  });

  it("keys dedup_key on the FETCHED final url, not on the link the model gave", async () => {
    // The two URLs must canonicalize DIFFERENTLY or this proves only that
    // canonicalization ran, never which URL it ran on.
    const row = await onePosting(
      { url: "https://acme.com/jobs/1" },
      { finalUrl: "https://www.acme.com/careers/senior-react-engineer/?utm_source=gemini" },
    );
    expect(row.source).toBe("ai_search");
    expect(row.dedup_key).toBe("ai_search:https://acme.com/careers/senior-react-engineer");
  });

  it("carries a stable source_posting_id, without which the row can never be queued", async () => {
    // postingExternalId() reads source_posting_id; selectQueueCandidates skips
    // any row whose external id is empty, and tailorAndQueueOne throws on one.
    // A row without this reaches the feed and is then invisible to the entire
    // auto-tailor pipeline — the feature would look shipped and do nothing.
    const row = await onePosting();
    expect(row.source_posting_id).toBeTruthy();
    expect(typeof row.source_posting_id).toBe("string");
  });

  it("extracts the years requirement from the FETCHED text via the shared normalizer", async () => {
    const row = await onePosting();
    expect(row.min_years_required).toBe(5);
  });

  it("takes posted_at from the fetched page even when the model volunteered a date", async () => {
    const row = await onePosting({ postedText: "January 1999" }, { publishedDate: "2026-08-01" });
    expect(row.posted_at).toBe("2026-08-01");
    expect(JSON.stringify(row)).not.toContain("1999");
  });

  it("populates salary from the fetched text through the shared salary parser", async () => {
    const row = await onePosting(
      {},
      { description: `${POSTING_BODY}\nCompensation: $180,000 - $220,000 per year.` },
    );
    expect(row.salary_min).toBe(180000);
    expect(row.salary_max).toBe(220000);
  });

  it("yields null salary bounds, not 0 or undefined, when the fetched page has no salary anywhere", async () => {
    // parseSalary runs over fetched text that will very often carry no dollar
    // figure at all; a fetched page with none must not be mistaken for "free"
    // (0) or "unknown field" (undefined) on the stored row.
    const row = await onePosting(); // POSTING_BODY has no dollar figure anywhere
    expect(row.salary_min).toBeNull();
    expect(row.salary_max).toBeNull();
  });

  it("carries a source_posting_id stable across independent runs over the same URL", async () => {
    // Downstream dedupe (selectQueueCandidates/applications) keys off this id.
    // If two runs over the same posting produced different ids, the same job
    // would get queued twice.
    const runOnce = async () => (await onePosting()).source_posting_id;
    const first = await runOnce();
    const second = await runOnce();
    expect(first).toBe(second);
  });

  it("carries different source_posting_ids for different URLs", async () => {
    const idFor = async (url) =>
      (await onePosting({ url }, { finalUrl: url })).source_posting_id;
    const a = await idFor("https://acme.com/jobs/1");
    const b = await idFor("https://acme.com/jobs/2");
    expect(a).not.toBe(b);
  });

  it("derives remote_type from the location, which is the ONE model field it trusts", async () => {
    // Deliberate, recorded carve-out from "trust nothing but the URL": location
    // is display metadata and never reaches a tailoring prompt, and a fetched
    // page frequently states remoteness nowhere parseable. The description —
    // the field that DOES reach the prompt — is never taken from the model.
    expect((await onePosting({ location: "Remote - US" })).remote_type).toBe("remote");
    expect((await onePosting({ location: "Austin, TX" })).remote_type).toBe("onsite");
  });

  it("reports a label so a failure can be attributed to this source", async () => {
    // runSource reads r.label when building sampleErrors; without it every AI
    // failure is reported as `source: undefined`.
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(modelResponse([candidate()])),
      fetchUrl: okFetch(),
    });
    expect(result.label).toBeTruthy();
  });

  it("caps how many pages a single query may fetch", async () => {
    const fetchUrl = okFetch();
    const many = Array.from({ length: 25 }, (_, i) => candidate({ url: `https://acme.com/jobs/${i}` }));
    await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(modelResponse(many)),
      fetchUrl,
      maxPostings: 5,
    });
    expect(fetchUrl.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("applies the saved search's exclusions to what the model returned", async () => {
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      query: { ...baseArgs.query, excludedTitleKeywords: ["senior"], excludedCompanies: ["initech"] },
      client: clientReturning(
        modelResponse([
          candidate(),
          candidate({ title: "React Engineer", company: "Initech", url: "https://acme.com/jobs/2" }),
          candidate({ title: "React Engineer", company: "Acme", url: "https://acme.com/jobs/3" }),
        ]),
      ),
      fetchUrl: vi.fn(async (url) => ({ finalUrl: url, description: POSTING_BODY, publishedDate: null })),
    });
    expect(result.postings.map((p) => p.url)).toEqual(["https://acme.com/jobs/3"]);
  });
});

describe("fetchLlmSearchPostings — it must use the shared machinery, not lookalikes", () => {
  it("puts the fetched page through lib/feed/normalize.js itself", async () => {
    snippetFrom.mockClear();
    remoteTypeFor.mockClear();
    extractMinYearsRequired.mockClear();

    await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(modelResponse([candidate()])),
      fetchUrl: okFetch(),
    });

    expect(snippetFrom).toHaveBeenCalled();
    expect(remoteTypeFor).toHaveBeenCalled();
    expect(String(extractMinYearsRequired.mock.calls[0][0])).toContain("5+ years");
  });

  it("produces a row the existing queue selector will actually pick up", async () => {
    // The composition check. Both halves of this feature can be individually
    // correct and still never meet: a row with no stable external id sails into
    // feed_postings and is then skipped by every downstream consumer, so the
    // feature ships looking complete and auto-applies to nothing.
    const result = await fetchLlmSearchPostings({
      ...baseArgs,
      client: clientReturning(modelResponse([candidate()])),
      fetchUrl: okFetch(),
    });
    const savedSearch = { job_keywords: ["react"], excluded_title_keywords: [], excluded_companies: [], max_years_exp: "any" };

    expect(selectQueueCandidates(result.postings, savedSearch, new Set(), 10)).toHaveLength(1);
  });
});

describe("shouldRunLlmSearch", () => {
  const now = Date.parse("2026-08-13T12:00:00Z");

  it("runs when it has never run before", () => {
    expect(shouldRunLlmSearch({ lastRunAt: null, now, intervalMinutes: 60 })).toBe(true);
  });

  it("does not run again before the interval has elapsed", () => {
    // /api/cron/feed-ingest fires every minute (R-202). Without this gate the
    // feature costs 1440 grounded model calls per query per day.
    expect(
      shouldRunLlmSearch({ lastRunAt: now - 59 * 60_000, now, intervalMinutes: 60 }),
    ).toBe(false);
  });

  it("runs once the interval has elapsed", () => {
    expect(shouldRunLlmSearch({ lastRunAt: now - 61 * 60_000, now, intervalMinutes: 60 })).toBe(true);
  });

  it("runs when the stored timestamp is unusable rather than stalling forever", () => {
    for (const bad of ["nonsense", NaN, undefined, {}]) {
      expect(shouldRunLlmSearch({ lastRunAt: bad, now, intervalMinutes: 60 })).toBe(true);
    }
  });

  it("treats a future timestamp as due rather than locking the source out", () => {
    expect(shouldRunLlmSearch({ lastRunAt: now + 86_400_000, now, intervalMinutes: 60 })).toBe(true);
  });
});
