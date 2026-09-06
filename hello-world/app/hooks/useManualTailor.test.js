// @vitest-environment jsdom
//
// The manual tailoring pipeline was moved verbatim out of app/page.js into
// this hook and given five deliberate behaviour changes. It had NO direct
// test of any kind, and three separate reviews each found a defect that lives
// exactly here and that nothing could catch: a cover-letter failure going
// silent for the callers that don't read the return value, the two entry
// guards writing the tab-wide error even under `queued: true`, and the
// docblock disagreeing with the catch path.
//
// app/hooks/useManualPostings.test.js injects a FAKE tailorPosting, on
// purpose, so it stays a test of the queue's wiring. This file is the other
// half: the real pipeline, with only the network and the storage/persistence
// modules mocked, asserting the CONTRACT its callers depend on.
//
// The docblock on line 1 is a per-file jsdom override; vitest.config.js stays
// `environment: "node"`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../lib/document/docx", () => ({
  buildTemplateLinesForUpload: vi.fn(async () => ["line one", "line two"]),
}));
vi.mock("../../lib/tailor/localSignals", () => ({
  promotedEditRules: vi.fn(() => []),
}));
vi.mock("../../lib/supabase/client", () => ({
  createClient: vi.fn(() => ({})),
}));
vi.mock("../../lib/supabase/upsertPosition", () => ({
  upsertPosition: vi.fn(async () => "position-1"),
}));
vi.mock("../../lib/supabase/upsertApplication", () => ({
  upsertApplication: vi.fn(async () => undefined),
}));
vi.mock("../../lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useManualTailor } from "./useManualTailor.js";
import { persistGeneratedDocuments } from "../../lib/supabase/persistGeneration";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A real File, not a plain object: FormData.append stringifies anything that
// isn't a Blob, so a stub would come back out of the body as
// "[object Object]" and the field assertion below would be checking nothing.
const RESUME = new File(["resume bytes"], "resume.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

// What /api/tailor actually resolves with on a good run, read from the route
// and from the pipeline's own reads rather than guessed: a mock of the wrong
// shape sends the hook down paths that would mask the very contract this
// file exists to pin.
function okPayload(overrides) {
  return {
    result: "TAILORED RESUME TEXT",
    resultLines: ["TAILORED RESUME TEXT"],
    jobTitle: "Staff Engineer",
    company: "Acme",
    coverLetterResultLines: ["Dear hiring team"],
    coverLetterResult: "Dear hiring team",
    coverLetterError: "",
    engine: "embedded",
    docxB64: "ZG9jeA==",
    coverLetterDocxB64: "",
    emailSubject: "",
    emailResultLines: [],
    ...overrides,
  };
}

function mockFetchOnce({ ok = true, payload = okPayload() } = {}) {
  globalThis.fetch = vi.fn(async () => ({ ok, json: async () => payload }));
}

let api;
let container;
let root;

function Probe(props) {
  api = useManualTailor(props);
  return null;
}

function baseProps(overrides) {
  return {
    resumeFile: RESUME,
    coverLetterFile: null,
    contextFiles: [],
    additionalContext: "",
    aggressiveness: 3,
    tailorEngine: "embedded",
    currentUser: null,
    setTrackedJobs: vi.fn(),
    updateTailoringJob: vi.fn(),
    maybeOfferLibraryUpdate: vi.fn(),
    withClearedEditedScopes: vi.fn(() => ({ resume: false, cover: false })),
    finishByOpeningPreview: vi.fn(),
    ...overrides,
  };
}

async function mount(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

async function run(opts) {
  let result;
  await act(async () => {
    result = await api.tailorPosting(null, opts);
  });
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchOnce();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("useManualTailor -- what it returns", () => {
  it("reports the tracked job it created, and the role it resolved to", async () => {
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting" });
    expect(result).toMatchObject({
      ok: true,
      jobTitle: "Staff Engineer",
      company: "Acme",
      warning: "",
    });
    expect(result.jobId).toMatch(/^manual-/);
  });

  it("gives two runs distinct tracked-job ids when the caller supplies none", async () => {
    await mount(baseProps());
    const first = await run({ overridePosting: "A" });
    mockFetchOnce();
    const second = await run({ overridePosting: "B" });
    expect(first.jobId).not.toBe(second.jobId);
  });

  it("uses the caller's id when given one", async () => {
    await mount(baseProps());
    const result = await run({ overridePosting: "A", syntheticJobId: "manual-supplied" });
    expect(result.jobId).toBe("manual-supplied");
  });

  it("reports a failed request rather than throwing", async () => {
    mockFetchOnce({ ok: false, payload: { error: "Engine unavailable." } });
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting" });
    expect(result).toMatchObject({ ok: false, error: "Engine unavailable." });
  });

  it("sends the posting to /api/tailor with the engine and the résumé attached", async () => {
    await mount(baseProps({ tailorEngine: "gemini", aggressiveness: 4 }));
    await run({ overridePosting: "The posting text" });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("/api/tailor");
    expect(init.method).toBe("POST");
    expect(init.body.get("jobPosting")).toBe("The posting text");
    expect(init.body.get("engine")).toBe("gemini");
    expect(init.body.get("aggressiveness")).toBe("4");
    expect(init.body.get("resume")).toBe(RESUME);
  });
});

describe("useManualTailor -- the preview auto-open", () => {
  it("opens the finished preview by default", async () => {
    const props = baseProps();
    await mount(props);
    await run({ overridePosting: "A posting" });
    expect(props.finishByOpeningPreview).toHaveBeenCalledTimes(1);
  });

  it("does not open it when the caller asks it not to", async () => {
    const props = baseProps();
    await mount(props);
    await run({ overridePosting: "A posting", openPreview: false });
    expect(props.finishByOpeningPreview).not.toHaveBeenCalled();
  });

  it("hands the preview the posting it tailored against", async () => {
    // Without this the preview opens with no posting text, and every Revise
    // inside it fails with "Couldn't find the job posting to revise against."
    const props = baseProps();
    await mount(props);
    await run({ overridePosting: "The posting text" });
    expect(props.finishByOpeningPreview.mock.calls[0][0]).toMatchObject({
      posting: "The posting text",
    });
  });
});

describe("useManualTailor -- the tab-wide submitting/error state", () => {
  it("clears the error and marks itself busy for an ordinary run", async () => {
    await mount(baseProps());
    await run({ overridePosting: "A posting" });
    expect(api.submitting).toBe(false);
    expect(api.error).toBe("");
  });

  it("reports a failure to the tab for an ordinary run", async () => {
    mockFetchOnce({ ok: false, payload: { error: "Engine unavailable." } });
    await mount(baseProps());
    await run({ overridePosting: "A posting" });
    expect(api.error).toBe("Engine unavailable.");
  });

  it("stays completely silent for a queued run, so concurrent postings cannot fight", async () => {
    mockFetchOnce({ ok: false, payload: { error: "Engine unavailable." } });
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting", queued: true });
    expect(result).toMatchObject({ ok: false, error: "Engine unavailable." });
    expect(api.error).toBe("");
    expect(api.submitting).toBe(false);
  });

  it("stays silent for a queued run that trips the blank-posting guard", async () => {
    await mount(baseProps());
    const result = await run({ overridePosting: "   ", queued: true });
    expect(result.ok).toBe(false);
    expect(api.error).toBe("");
  });

  it("stays silent for a queued run that trips the missing-résumé guard", async () => {
    // Reachable from "Retry failed" if the résumé is cleared between runs.
    // Left unguarded, every retried posting writes the same message into the
    // one shared banner while also showing it on its own card.
    await mount(baseProps({ resumeFile: null }));
    const result = await run({ overridePosting: "A posting", queued: true });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/resume/i);
    expect(api.error).toBe("");
  });

  it("still tells the tab about a guard failure on an ordinary run", async () => {
    await mount(baseProps({ resumeFile: null }));
    await run({ overridePosting: "A posting" });
    expect(api.error).toMatch(/resume/i);
  });
});

describe("useManualTailor -- a cover letter that failed", () => {
  it("is still a successful run, and says what went wrong", async () => {
    mockFetchOnce({ payload: okPayload({ coverLetterError: "Cover letter model refused." }) });
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting" });
    expect(result.ok).toBe(true);
    expect(result.warning).toBe("Cover letter model refused.");
  });

  it("is reported to the tab for callers that cannot show a returned warning", async () => {
    // The StatusBar chip's Regenerate and the reviewed-fields flow both call
    // this and DISCARD the return value. Before the queue existed this wrote
    // the tab-wide error; if it only returns now, those two callers silently
    // ship a stale or missing cover letter with the chip reading "done".
    mockFetchOnce({ payload: okPayload({ coverLetterError: "Cover letter model refused." }) });
    await mount(baseProps());
    await run({ overridePosting: "A posting" });
    expect(api.error).toBe("Cover letter model refused.");
  });

  it("is NOT reported to the tab for a queued run -- its own card shows it", async () => {
    mockFetchOnce({ payload: okPayload({ coverLetterError: "Cover letter model refused." }) });
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting", queued: true });
    expect(result.warning).toBe("Cover letter model refused.");
    expect(api.error).toBe("");
  });
});

// DEFECT 2: app/api/tailor/route.js returns a `warnings` array (engine
// fallback notices, embedded-engine degradations like an unmatched focus
// area or an unparsed steering note, project-pages truncation) that nothing
// on the client ever read. This hook already has an established channel for
// a post-success problem -- the cover-letter-failure `warning` above -- so
// an engine warning follows the exact same shape: combined into it (never
// replacing a cover-letter failure that also occurred), for both the
// returned value (queued callers) and the tab-wide error (unqueued callers).
describe("useManualTailor -- engine warnings reaching the user (DEFECT 2)", () => {
  it("surfaces an engine warning even when the cover letter succeeded", async () => {
    mockFetchOnce({
      payload: okPayload({
        warnings: ['Focus area "Data Science" isn\'t in your library — auto-detection was used instead.'],
      }),
    });
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting" });
    expect(result.ok).toBe(true);
    expect(result.warning).toContain("isn't in your library");
    expect(api.error).toContain("isn't in your library");
  });

  it("combines an engine warning with a cover-letter failure rather than dropping one", async () => {
    mockFetchOnce({
      payload: okPayload({
        coverLetterError: "Cover letter model refused.",
        warnings: ['Applied your recurring edit: "foo" → "bar".'],
      }),
    });
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting" });
    expect(result.warning).toContain("Cover letter model refused.");
    expect(result.warning).toContain("Applied your recurring edit");
    expect(api.error).toContain("Cover letter model refused.");
    expect(api.error).toContain("Applied your recurring edit");
  });

  it("is NOT reported to the tab for a queued run -- its own card shows it", async () => {
    mockFetchOnce({ payload: okPayload({ warnings: ["This role reads as non-technical."] }) });
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting", queued: true });
    expect(result.warning).toContain("This role reads as non-technical.");
    expect(api.error).toBe("");
  });

  it("ignores a non-array warnings field instead of throwing", async () => {
    mockFetchOnce({ payload: okPayload({ warnings: null }) });
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting" });
    expect(result.ok).toBe(true);
    expect(result.warning).toBe("");
  });
});

describe("useManualTailor -- the tracked job", () => {
  it("registers the posting as a tracked job before the request goes out", async () => {
    const props = baseProps();
    await mount(props);
    await run({ overridePosting: "A posting" });
    const added = props.setTrackedJobs.mock.calls[0][0]([]);
    expect(added[0]).toMatchObject({ description: "A posting", url: "" });
  });

  it("marks the job tailoring, then done", async () => {
    const props = baseProps();
    await mount(props);
    await run({ overridePosting: "A posting" });
    expect(props.updateTailoringJob.mock.calls[0][1]).toMatchObject({ status: "tailoring" });
  });

  it("marks the job errored when the request fails", async () => {
    mockFetchOnce({ ok: false, payload: { error: "Engine unavailable." } });
    const props = baseProps();
    await mount(props);
    await run({ overridePosting: "A posting" });
    const last = props.updateTailoringJob.mock.calls.at(-1)[1];
    expect(last).toMatchObject({ status: "error" });
  });

  it("persists nothing when signed out", async () => {
    await mount(baseProps({ currentUser: null }));
    await run({ overridePosting: "A posting" });
    expect(persistGeneratedDocuments).not.toHaveBeenCalled();
  });

  it("persists the generated documents when signed in", async () => {
    await mount(baseProps({ currentUser: { id: "user-1" } }));
    await run({ overridePosting: "A posting" });
    expect(persistGeneratedDocuments).toHaveBeenCalledTimes(1);
    expect(persistGeneratedDocuments.mock.calls[0][1]).toMatchObject({
      userId: "user-1",
      sourceResumePath: "user-1/resume",
    });
  });
});

// The duplicate-application flag's E4/E6 fire point (3-plan-dupapply.md
// §2.9, §4 A-1). `onCheckDuplicate` is a plain callback prop -- this hook
// has no opinion about what it does, only that calling it must never be
// able to turn a successful, already-paid-for tailor run into a reported
// failure (RM-15/F-1: this fire point sits INSIDE tailorPosting's own try,
// unlike page.js's three handlers, so a throw here that escaped would be
// caught by the SAME catch that handles a failed /api/tailor response).
describe("useManualTailor -- the duplicate-application check (onCheckDuplicate)", () => {
  it("is called with the resolved job (company known) and a jobId/entryPoint context, after the response resolves", async () => {
    const onCheckDuplicate = vi.fn();
    await mount(baseProps({ onCheckDuplicate }));
    const result = await run({ overridePosting: "A posting" });
    expect(onCheckDuplicate).toHaveBeenCalledTimes(1);
    const [candidate, ctx] = onCheckDuplicate.mock.calls[0];
    expect(candidate).toMatchObject({ id: result.jobId, company: "Acme", description: "A posting" });
    expect(ctx).toMatchObject({ jobId: result.jobId, entryPoint: "manual" });
  });

  it("does not fire it before the request resolves (a rejected request never calls it)", async () => {
    mockFetchOnce({ ok: false, payload: { error: "Engine unavailable." } });
    const onCheckDuplicate = vi.fn();
    await mount(baseProps({ onCheckDuplicate }));
    await run({ overridePosting: "A posting" });
    expect(onCheckDuplicate).not.toHaveBeenCalled();
  });

  it("a throwing onCheckDuplicate does not abort the run -- the preview still opens and the result is still ok", async () => {
    const onCheckDuplicate = vi.fn(() => {
      throw new Error("duplicate check exploded");
    });
    const props = baseProps({ onCheckDuplicate });
    await mount(props);
    const result = await run({ overridePosting: "A posting" });
    expect(result.ok).toBe(true);
    expect(props.finishByOpeningPreview).toHaveBeenCalledTimes(1);
  });

  it("a throwing onCheckDuplicate does not mark the tracked job errored", async () => {
    const onCheckDuplicate = vi.fn(() => {
      throw new Error("duplicate check exploded");
    });
    const props = baseProps({ onCheckDuplicate });
    await mount(props);
    await run({ overridePosting: "A posting" });
    const statuses = props.updateTailoringJob.mock.calls.map((call) => {
      const arg = call[1];
      return typeof arg === "function" ? arg({}).status : arg.status;
    });
    expect(statuses).not.toContain("error");
    expect(statuses).toContain("done");
  });

  it("persists the generated documents even when onCheckDuplicate throws", async () => {
    const onCheckDuplicate = vi.fn(() => {
      throw new Error("duplicate check exploded");
    });
    await mount(baseProps({ onCheckDuplicate, currentUser: { id: "user-1" } }));
    await run({ overridePosting: "A posting" });
    expect(persistGeneratedDocuments).toHaveBeenCalledTimes(1);
  });

  it("is optional -- omitting it entirely does not break the pipeline", async () => {
    await mount(baseProps());
    const result = await run({ overridePosting: "A posting" });
    expect(result.ok).toBe(true);
  });
});
