import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Route contract for the tracking table's researched digest.
//
// The expensive mistakes this pins are all about NOT calling the model: not
// for someone else's application, not for the embedded engine, not when a
// cached digest could not even be read, and above all not when a digest
// already exists. A tracking table re-renders constantly; a route that
// researched afresh each time it was asked would bill a grounded search per
// render.
//
// THE SURFACE MIGRATED. This route is the ONLY grounded call site in the repo
// on `client.interactions.create`; the other seven stay on
// `models.generateContent`. The two request shapes are INVERTED — `tools` is
// TOP-LEVEL here and nested inside `config` there — so an assertion copied
// between them is wrong in both directions. `route.wire.test.js` proves the
// bytes; this file proves everything the bytes cannot reach.
//
// FIXTURES ARE CONSTRUCTED, NOT OBSERVED. There is no GEMINI_API_KEY in this
// checkout. Every Interaction below is built to the shape `Interaction` /
// `ModelOutputStep` / `URLCitation` document in the installed @google/genai
// 2.6.0 `.d.ts` — snake_case `start_index`/`end_index`, byte offsets — and
// none was captured from a live call.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({
  listDigests: vi.fn(),
  upsertDigest: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { listDigests, upsertDigest } from "@/lib/supabase/applicationDigests";
import { POST } from "./route.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";

const POSITION = {
  id: "p1",
  company: "Acme Robotics",
  title: "Senior Platform Engineer",
  location: "Remote (US)",
  description: "Own our Kubernetes estate.",
};

const CRUNCHBASE = "https://www.crunchbase.com/organization/acme";
const REUTERS = "https://www.reuters.com/business/acme-series-c";

const BODY = "Acme builds warehouse robots for cold storage. It runs depots in three states.";
const MARKDOWN = `## What the company does\n\n${BODY}`;

// The vendor sends BYTE offsets. Computing them rather than typing a number is
// what keeps these fixtures honest about the unit.
const encoder = new TextEncoder();
const bytesTo = (text, index) => encoder.encode(text.slice(0, index)).length;

function urlCitation(text, { url, title, from, to }) {
  return {
    type: "url_citation",
    url,
    title,
    start_index: bytesTo(text, from),
    end_index: bytesTo(text, to),
  };
}

// The first sentence of the body, which is what a real annotation spans.
function firstSentenceCitation(text = MARKDOWN, url = CRUNCHBASE) {
  const from = text.indexOf(BODY);
  const to = text.indexOf("storage.") + "storage.".length;
  return urlCitation(text, { url, title: "crunchbase.com", from, to });
}

function interaction({ text = MARKDOWN, annotations = [], searched = true, status = "completed" } = {}) {
  const steps = [];
  if (searched) steps.push({ type: "google_search_call", id: "s1" });
  steps.push({
    type: "model_output",
    content: [{ type: "text", text, annotations }],
  });
  return { id: "int-1", status, steps, ...(text ? { output_text: text } : {}) };
}

// The route reads the application scoped to the caller. `found` false models
// "not this user's row" — RLS would return nothing, and so must we.
function supabaseWith({ found = true } = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: found ? { id: APP_ID, user_id: "user-1", positions: POSITION } : null,
    error: null,
  });
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle,
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(() => chain),
  });
  return chain;
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    from: vi.fn(),
  });
}

// The migrated surface. `client.interactions.create`, NOT
// `client.models.generateContent` — a fake that still offers `models` would
// make the route throw on `client.interactions` being undefined and every
// assertion below would pass for the wrong reason.
function geminiReplying(value = interaction({ annotations: [firstSentenceCitation()] })) {
  const create = vi.fn().mockResolvedValue(value);
  getGeminiClient.mockReturnValue({ interactions: { create } });
  return create;
}

function geminiRejecting(error = new Error("model exploded")) {
  const create = vi.fn().mockRejectedValue(error);
  getGeminiClient.mockReturnValue({ interactions: { create } });
  return create;
}

const request = (body) =>
  new Request("http://localhost/api/application-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const storedFields = () => upsertDigest.mock.calls[0][3];

let warnSpy;
let errorSpy;

beforeEach(() => {
  vi.clearAllMocks();
  supabaseWith();
  // wantsEmbedded reads process.env directly, not the mocked getServerEnv.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  // The REAL lib/supabase/applicationDigests.js returns `digests` as an OBJECT
  // keyed by application_id, not an array. Mocking it as an array would make
  // every assertion here a test against a shape production never produces.
  listDigests.mockResolvedValue({ digests: {}, error: null });
  upsertDigest.mockImplementation(async (_s, _u, id, fields) => ({ digest: { application_id: id, ...fields }, error: null }));
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("POST /api/application-digest — the gates before the model", () => {
  it("refuses an unauthenticated caller before reading anything", async () => {
    signedOut();
    const create = geminiReplying();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
    expect(listDigests).not.toHaveBeenCalled();
  });

  it("rejects a missing application id without calling the model", async () => {
    const create = geminiReplying();
    const res = await POST(request({}));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("will not research an application that is not the caller's", async () => {
    supabaseWith({ found: false });
    const create = geminiReplying();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it("scopes the application read to the caller's own user_id", async () => {
    // Deleting the tenant filter leaves every other test in this file green.
    const chain = supabaseWith();
    geminiReplying();
    await POST(request({ applicationId: APP_ID }));
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("refuses the embedded engine, creating nothing", async () => {
    const create = geminiReplying();
    const res = await POST(request({ applicationId: APP_ID, engine: "embedded" }));
    expect(res.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
    expect(upsertDigest).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/engine/i) });
  });

  it("returns an existing digest without calling the model again", async () => {
    // The tracking table asks for this on every load. Re-researching would
    // bill a grounded search per page view.
    listDigests.mockResolvedValue({
      digests: { [APP_ID]: { application_id: APP_ID, status: "ready", markdown: MARKDOWN, sources: [] } },
      error: null,
    });
    const create = geminiReplying();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ digest: { markdown: MARKDOWN } });
  });

  it("re-researches when the caller forces it, which is what the Research button does", async () => {
    listDigests.mockResolvedValue({
      digests: { [APP_ID]: { application_id: APP_ID, status: "ready", markdown: "stale", sources: [] } },
      error: null,
    });
    const create = geminiReplying();
    const res = await POST(request({ applicationId: APP_ID, force: true }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not treat a FAILED cache read as a cache miss", async () => {
    // listDigests returns { digests: null, error } on a transient PostgREST
    // failure. Reading only `digests` makes that indistinguishable from "this
    // application has no digest" — and the consequence is a full billed
    // grounded call on a row that already had a ready one, on every load.
    listDigests.mockResolvedValue({ digests: null, error: "connection reset" });
    const create = geminiReplying();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(create).not.toHaveBeenCalled();
    expect(upsertDigest).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });
});

describe("POST /api/application-digest — the Interactions request", () => {
  it("asks for google_search with tools at the TOP LEVEL, not inside config", async () => {
    // The polarity of this assertion is INVERTED from every other grounded
    // call site in the repo. `interactions.create` takes `tools` top-level and
    // has no `config` at all; `models.generateContent` takes it inside
    // `config` and DISCARDS a top-level key silently. Seven other call sites
    // still use the second rule, and their tests must not be "fixed" to match
    // this one.
    const create = geminiReplying();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.tools).toEqual([{ type: "google_search" }]);
    expect(params.config).toBeUndefined();
    expect(params.contents).toBeUndefined();
    expect(String(params.input)).toContain("Acme Robotics");
    expect(params.model).toBe("gemini-2.5-flash");
  });

  it("bounds the retry and timeout budget PER CALL, never on the shared client", async () => {
    // Measured on the installed SDK: the Interactions transport defaults to a
    // 60 s timeout and maxRetries 2 — three attempts — and it retries a
    // client-side timeout too, so the worst case is ~182 s. The route's
    // maxDuration is 120, so an unbounded call is killed MID-RETRY: the catch
    // never runs, no `failed` row is written, and selectAutoDigestTargets
    // re-fires a billed grounded search on every page load for 24 hours.
    //
    // The options go on the CALL. getGeminiClient memoises a module singleton
    // shared with seven other features; setting them on the client would
    // change all of them.
    const create = geminiReplying();
    await POST(request({ applicationId: APP_ID }));
    const options = create.mock.calls[0][1];
    expect(options).toBeDefined();
    expect(options.maxRetries).toBe(1);
    expect(options.timeout).toBe(45_000);
    // 45 s + backoff + 45 s is ~92 s, which has to fit inside maxDuration.
    const mod = await import("./route.js");
    expect(mod.maxDuration).toBe(120);
    expect(2 * options.timeout).toBeLessThan(mod.maxDuration * 1000);
  });

  it("is dynamic and runs on node", async () => {
    const mod = await import("./route.js");
    expect(mod.runtime).toBe("nodejs");
    expect(mod.dynamic).toBe("force-dynamic");
  });
});

describe("POST /api/application-digest — the citation outcome reaches storage", () => {
  it("stores the record beside the markdown and the spans it describes", async () => {
    geminiReplying();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(200);
    expect(upsertDigest).toHaveBeenCalledTimes(1);
    const stored = storedFields();

    expect(stored.status).toBe("ready");
    expect(stored.markdown).toContain("Acme builds warehouse robots");

    // ONE identifier, spelled citation_outcome, everywhere. A camelCase or
    // shortened variant is a key no column matches — a silent drop.
    const outcome = stored.citation_outcome;
    expect(outcome).toBeTruthy();
    expect(stored.citationOutcome).toBeUndefined();
    expect(outcome.version).toBe(1);
    expect(outcome.surface).toBe("interactions");
    expect(outcome.searched).toBe(true);

    // The stamp binds the record to the exact string being stored.
    expect(outcome.len).toBe(stored.markdown.length);
    expect(typeof outcome.hash).toBe("string");

    // counts.placed must equal the number of stored sources carrying a span —
    // the binding the renderer checks before it splices anything.
    const withSpans = stored.sources.filter(
      (s) => Number.isInteger(s.start) && Number.isInteger(s.end),
    );
    expect(outcome.counts.placed).toBe(withSpans.length);
    expect(outcome.counts.annotations).toBe(1);
  });

  it("carries the vendor's citation into sources, with the publisher url verbatim", async () => {
    geminiReplying();
    await POST(request({ applicationId: APP_ID }));
    const stored = storedFields();
    expect(stored.sources).toHaveLength(1);
    expect(stored.sources[0].url).toBe(CRUNCHBASE);
    // The stored markdown never carries a marker. Markers are a render-time
    // presentation, computed from the spans.
    expect(stored.markdown).not.toContain("](");
  });

  it("records the record on the stage counts, not on the source list alone", async () => {
    // The observability invariant: every narrowing stage records its input
    // count beside its output count, and the chain is monotone.
    geminiReplying(
      interaction({
        annotations: [
          firstSentenceCitation(),
          firstSentenceCitation(MARKDOWN, REUTERS),
        ],
      }),
    );
    await POST(request({ applicationId: APP_ID }));
    const counts = storedFields().citation_outcome.counts;
    expect(counts.annotations).toBe(2);
    for (const stage of ["annotations", "urlsUsable", "spansUsable", "splicesSafe", "placed"]) {
      expect(Number.isInteger(counts[stage])).toBe(true);
    }
    expect(counts.urlsUsable).toBeLessThanOrEqual(counts.annotations);
    expect(counts.spansUsable).toBeLessThanOrEqual(counts.urlsUsable);
    expect(counts.splicesSafe).toBeLessThanOrEqual(counts.spansUsable);
    expect(counts.placed).toBeLessThanOrEqual(counts.splicesSafe);
  });

  it("carries exactly one previous generation forward, timed from the researched_at COLUMN", async () => {
    listDigests.mockResolvedValue({
      digests: {
        [APP_ID]: {
          application_id: APP_ID,
          status: "ready",
          markdown: "old",
          sources: [],
          researched_at: "2026-07-25T09:12:44.001Z",
          citation_outcome: { version: 1, counts: { placed: 4 }, refused: { count: 1 } },
        },
      },
      error: null,
    });
    geminiReplying();
    await POST(request({ applicationId: APP_ID, force: true }));
    expect(storedFields().citation_outcome.previous).toEqual({
      placed: 4,
      refusedCount: 1,
      researchedAt: "2026-07-25T09:12:44.001Z",
    });
  });
});

describe("POST /api/application-digest — the anomaly is stored, not just computed", () => {
  it("names the stage that ate every citation when grounding returned some", async () => {
    // "Grounding returned chunks and zero citations survived" is the single
    // number that would have made this feature's original defect loud on day
    // one. The route computed both halves one line apart and joined them
    // nowhere, so the digest silently persisted an empty source list for the
    // life of the feature. A url the link control refuses reproduces exactly
    // that arithmetic: annotations in, zero out.
    geminiReplying(
      interaction({
        annotations: [
          urlCitation(MARKDOWN, {
            url: "data://www.crunchbase.com/organization/acme",
            title: "crunchbase.com",
            from: MARKDOWN.indexOf(BODY),
            to: MARKDOWN.indexOf("storage.") + "storage.".length,
          }),
        ],
      }),
    );
    await POST(request({ applicationId: APP_ID }));
    const outcome = storedFields().citation_outcome;
    expect(outcome.counts.annotations).toBe(1);
    expect(outcome.counts.urlsUsable).toBe(0);
    expect(outcome.anomaly).toBeTruthy();
    expect(outcome.anomaly.stage).toBe("url-control");
    expect(outcome.refused.reasons.unusableAnnotationUrl).toBe(1);
  });

  it("warns on the anomaly with counts only — never a url, a title or a company", async () => {
    geminiReplying(
      interaction({
        annotations: [
          urlCitation(MARKDOWN, {
            url: "data://www.crunchbase.com/organization/acme",
            title: "crunchbase.com",
            from: MARKDOWN.indexOf(BODY),
            to: MARKDOWN.indexOf("storage.") + "storage.".length,
          }),
        ],
      }),
    );
    await POST(request({ applicationId: APP_ID }));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0].map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    expect(logged).toContain("url-control");
    for (const secret of ["http", "data://", "crunchbase", "Acme", "warehouse"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("[positive control] stays silent when nothing was eaten", async () => {
    // Without this the warn assertion above is satisfied by a route that warns
    // unconditionally, which would be noise rather than a signal.
    geminiReplying();
    await POST(request({ applicationId: APP_ID }));
    expect(storedFields().citation_outcome.anomaly).toBe(null);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not call a search that produced nothing an anomaly", async () => {
    // searched=false, no annotations: an honest empty, not a narrowing.
    geminiReplying(interaction({ searched: false, annotations: [] }));
    await POST(request({ applicationId: APP_ID }));
    const outcome = storedFields().citation_outcome;
    expect(outcome.searched).toBe(false);
    expect(outcome.counts.annotations).toBe(0);
    expect(outcome.anomaly).toBe(null);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stores an ungrounded claim without its invented link", async () => {
    // The pipeline is deliberately unmocked: the guarantee is that nothing
    // between the model and the stored row can admit a url the model made up.
    // Under Interactions the property is STRONGER than it was — the model's
    // url is not merely demoted to text, it is removed as residue and counted.
    geminiReplying(
      interaction({
        text: "## Recent signals\n\nRaised a Series C. [Report](https://invented.example/x)",
        annotations: [],
      }),
    );
    await POST(request({ applicationId: APP_ID }));
    const stored = storedFields();
    expect(stored.markdown).toContain("Raised a Series C.");
    expect(stored.markdown).not.toContain("invented.example");
    expect(stored.markdown).not.toContain("](");
    expect(stored.citation_outcome.refused.count).toBeGreaterThan(0);
    expect(stored.sources).toEqual([]);
  });
});

describe("POST /api/application-digest — research recency", () => {
  it("stamps researched_at on a SUCCESSFUL run, as an ISO timestamp", async () => {
    const before = Date.now();
    geminiReplying();
    await POST(request({ applicationId: APP_ID }));
    const stored = storedFields();
    expect(typeof stored.researched_at).toBe("string");
    const at = Date.parse(stored.researched_at);
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
    // The fact has ONE home. It is not duplicated into the jsonb record.
    expect(stored.citation_outcome.researchedAt).toBeUndefined();
    expect(JSON.stringify(stored.citation_outcome)).not.toContain("\"researchedAt\":\"20");
  });

  it("does NOT stamp research recency on a failed run", async () => {
    // A six-week-old digest whose newest attempt failed two minutes ago used
    // to render as "Researched 2 minutes ago", because updated_at is stamped
    // on every write and the panel read it. researched_at is omitted here, and
    // the upsert is column-wise, so the stored value survives untouched.
    listDigests.mockResolvedValue({
      digests: {
        [APP_ID]: {
          application_id: APP_ID,
          status: "ready",
          markdown: "six weeks old",
          sources: [{ url: CRUNCHBASE }],
          researched_at: "2026-07-25T09:12:44.001Z",
          citation_outcome: { version: 1, counts: { placed: 1 } },
        },
      },
      error: null,
    });
    geminiRejecting();
    await POST(request({ applicationId: APP_ID, force: true }));
    const stored = storedFields();
    expect(stored.status).toBe("failed");
    expect(Object.prototype.hasOwnProperty.call(stored, "researched_at")).toBe(false);
  });
});

describe("POST /api/application-digest — the failure path", () => {
  it("records a failure instead of leaving the cell looking untried", async () => {
    const create = geminiRejecting();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(upsertDigest).toHaveBeenCalledTimes(1);
    const stored = storedFields();
    expect(stored.status).toBe("failed");
    expect(stored.error).toContain("model exploded");
    // An empty cell reads as "nobody has looked yet"; the user needs to know
    // it was tried and can be retried. And a row must exist, or
    // selectAutoDigestTargets re-fires a billed grounded search on every load.
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.digest.status).toBe("failed");
  });

  it("carries markdown, sources AND the outcome record forward together", async () => {
    // They move as one generation or the stamp stops describing the markdown,
    // and every marker then splices at an offset from a different document.
    const outcome = { version: 1, surface: "interactions", counts: { placed: 1 }, len: 13, hash: "deadbeef" };
    listDigests.mockResolvedValue({
      digests: {
        [APP_ID]: {
          application_id: APP_ID,
          status: "ready",
          markdown: "six weeks old",
          sources: [{ url: CRUNCHBASE, start: 0, end: 3 }],
          citation_outcome: outcome,
        },
      },
      error: null,
    });
    geminiRejecting();
    await POST(request({ applicationId: APP_ID, force: true }));
    const stored = storedFields();
    expect(stored.markdown).toBe("six weeks old");
    expect(stored.sources).toEqual([{ url: CRUNCHBASE, start: 0, end: 3 }]);
    expect(stored.citation_outcome).toEqual(outcome);
  });

  it("writes an explicit null outcome for a row that never had one", async () => {
    geminiRejecting();
    await POST(request({ applicationId: APP_ID }));
    const stored = storedFields();
    expect(Object.prototype.hasOwnProperty.call(stored, "citation_outcome")).toBe(true);
    expect(stored.citation_outcome).toBe(null);
    expect(stored.markdown).toBe("");
    expect(stored.sources).toEqual([]);
  });

  it("treats a well-formed interaction with no text as a failure, not a ready digest", async () => {
    // AppViewDialog gates the digest page on `markdown` being truthy, so a
    // `ready` row with empty markdown is a page the user can never open,
    // behind a cell that reads "not researched yet" — and it burned a grounded
    // call. `output_text` is OMITTED by the SDK when the text is empty, so the
    // discriminator is `Array.isArray(steps)`, never the absent key.
    geminiReplying(interaction({ text: "", annotations: [] }));
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(200);
    const stored = storedFields();
    expect(stored.status).toBe("failed");
    expect(stored.error).toBe("The model returned no research.");
  });

  it("surfaces a failed WRITE rather than swallowing it", async () => {
    upsertDigest.mockResolvedValue({ digest: null, error: "column does not exist" });
    geminiReplying();
    const res = await POST(request({ applicationId: APP_ID }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "column does not exist" });
  });

  it("logs the write error on the FAILURE path, where it was silently dropped", async () => {
    // The catch path never destructured upsertDigest's own error, so a failed
    // failure-write produced no row and no trace of why — the exact state that
    // re-arms the stampede.
    upsertDigest.mockResolvedValue({ digest: null, error: "column does not exist" });
    geminiRejecting();
    await POST(request({ applicationId: APP_ID }));
    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("column does not exist");
  });
});

describe("POST /api/application-digest — the response-side invariant (D-1)", () => {
  it("either stores a source, or records per-reason why the citation died", async () => {
    // The repo has one instrument for silent grounding failures — a wire test
    // per call site, which checks the REQUEST. This defect was on the
    // RESPONSE, and this is its counterpart: it asserts the pipeline's
    // arithmetic rather than any vendor's URL format, which is why it is the
    // only check here that survives a vendor shape change.
    for (const [label, value] of [
      ["usable", interaction({ annotations: [firstSentenceCitation()] })],
      [
        "refused",
        interaction({
          annotations: [
            urlCitation(MARKDOWN, {
              url: "https://acme.com@evil.example/x",
              title: "acme.com",
              from: MARKDOWN.indexOf(BODY),
              to: MARKDOWN.indexOf("storage.") + "storage.".length,
            }),
          ],
        }),
      ],
    ]) {
      upsertDigest.mockClear();
      geminiReplying(value);
      await POST(request({ applicationId: APP_ID }));
      const stored = storedFields();
      const outcome = stored.citation_outcome;
      expect(outcome.counts.annotations, label).toBe(1);
      const refusedTotal = Object.values(outcome.refused.reasons).reduce((a, b) => a + b, 0);
      // Non-empty sources, or a named reason. Never both empty.
      expect(stored.sources.length + refusedTotal, label).toBeGreaterThan(0);
    }
  });
});
