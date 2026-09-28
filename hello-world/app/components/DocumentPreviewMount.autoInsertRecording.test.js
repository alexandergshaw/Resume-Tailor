// @vitest-environment jsdom
//
// THE BLIND SPOT THIS FILE CLOSES (owner report, twice: "auto-inserted facts
// still not working").
// ---------------------------------------------------------------------------
// DocumentPreviewMount.js's coordinating effect only calls
// `research.autoInsertFactsForJob` -- and therefore only records anything via
// `recordAutoInsertOutcome` -> `recordDecision` -- when the job's research has
// resolved WITH AT LEAST ONE ARTICLE (`autoInsertResearchResolved`, which
// requires `articles.length > 0`). So the three most likely reasons a candidate
// sees no facts leave NOTHING in the downloaded activity log, and are
// indistinguishable from the feature being broken:
//
//   1. research resolved having found NOTHING (articles.length === 0);
//   2. research FAILED (it could not run at all -- a 503, a thrown fetch);
//   3. research was STILL RUNNING when the candidate closed the preview
//      (the owner's own session: research took ~25s; the preview opened ~25s
//      before it resolved).
//
// All three are ORDINARY outcomes, not faults. The fix these RED tests hand off
// records each of them AS A DECISION, from the EFFECT (the function is never
// called in any of these cases -- so a record placed inside the function could
// never fire), with a distinct machine `code` per case so a diagnoser reading
// the downloaded file can tell "there was nothing" from "we could not look"
// from "you closed it before it finished."
//
// WHY THESE RECORDS COME FROM THE EFFECT, NOT THE FUNCTION: every test below
// that asserts a record ALSO asserts `research.autoInsertFactsForJob` was NOT
// called. A record therefore cannot have come from the function (it never ran);
// it can only have come from the effect. That is the load-bearing pairing --
// without the "not called" half, a record could be the function's own and the
// test would prove nothing about placement.
//
// ON-SCREEN RULING (pinned here, decided by the TDD/SME seat): NONE of these
// three outcomes shows anything on screen. The auto-insert is a BACKGROUND
// nicety the candidate never asked for ("review after the fact"); a banner
// saying "we found nothing about this company", or "research failed", when they
// merely opened their own letter is noise at best and reads as a fault or a
// judgement on the employer at worst, and it offers no action they can take.
// This follows the codebase's OWN established precedent: the `already-edited`
// refusal is recorded-but-silent for the same reason (AutoInsertFactsMessage.js
// renders nothing for severity "silent"; useCompanyResearch.js's ruling). The
// distinction the owner needs -- nothing vs. couldn't-look vs. closed-early --
// is preserved where they actually diagnose from: the LOG (distinct outcome +
// code), never the candidate's screen. Each recording test therefore also
// asserts the recorded reason text does NOT appear in the rendered DOM.
//
// CONTENT-LEAK GUARD (the downloaded file is shared onward): a decision record
// carries a canned reason and a code ONLY -- never the company, a url, an
// article title, or a byte of the letter. Fixtures below plant a distinctive
// company name and, for the failure case, a content-bearing error string, and
// every recording test asserts none of it reaches the recorded fields.
//
// HARNESS: mounts the REAL DocumentPreviewMount (createRoot + act, the
// JobDescriptionTab.test.js pattern the sibling DocumentPreviewMount.test.js
// already uses) and drives it the way the app does -- by opening the preview
// and handing it research entries in the EXACT shapes useCompanyResearch.js
// produces (loading / resolved-with-articles / resolved-empty / failed). No
// effect handler or recorder is called directly; the effect is reached only by
// rendering. `recordDecision` is spied via a PARTIAL module mock (everything
// else in the module stays real, so network-capture callers are unaffected).
// The spy proves WHAT the component decided to record; a separate round-trip
// test against the REAL createActivityLog proves the ledger actually KEEPS
// those outcomes and fields (the "an injected fake cannot see the layer that
// drops your argument" trap -- the spy alone could not).

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { recordDecision, createActivityLog } from "@/lib/activityLog/appActivityLog.js";

// Partial mock: only recordDecision becomes a spy; recordActivity /
// attachActivitySection / createActivityLog / everything else stay REAL, so a
// module elsewhere in the mounted tree that captures network or renders a
// section is unaffected, and the round-trip test below exercises the genuine
// recorder.
vi.mock("@/lib/activityLog/appActivityLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn() };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The distinctive company / article title / error content the records must
// never carry. Any appearance of these strings in a recorded field is a leak.
const COMPANY = "Umbrella Corporation";
const ARTICLE_TITLE = "Umbrella Q3 layoffs, sources say";
const LEAKY_ERROR = `Research for ${COMPANY} at https://umbrella.example/story failed: 500`;

// jsdom (^29 here) implements no innerText; the sibling suite documents the
// same scoping. Not strictly needed (no edit mode entered), kept so a future
// edit that types cannot fail confusingly.
let removeInnerTextPolyfill = null;
beforeAll(() => {
  if (!("innerText" in document.createElement("div"))) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get() {
        return this.textContent;
      },
      set(value) {
        this.textContent = value;
      },
    });
    removeInnerTextPolyfill = () => {
      delete HTMLElement.prototype.innerText;
    };
  }
});
afterAll(() => {
  removeInnerTextPolyfill?.();
});

// Research entries in the EXACT shapes useCompanyResearch.js writes into
// researchByJob (verified against that file, 2026-09-28):
//   loading:               { loading:true,  articles:[], warnings:[], error:"",  needsCompany:false }
//   resolved with articles:{ loading:false, needsCompany:false, error:"", articles:[...], warnings:[] }
//   resolved EMPTY:        { loading:false, needsCompany:false, error:"", articles:[], warnings:[] }
//   FAILED (503 / throw):  { loading:false, articles:[], warnings:[], needsCompany:false, error:"<msg>" }
const researchLoading = () => ({ loading: true, articles: [], warnings: [], error: "", needsCompany: false });
const researchResolvedEmpty = () => ({ loading: false, needsCompany: false, error: "", articles: [], warnings: [] });
const researchFailed = (error) => ({ loading: false, articles: [], warnings: [], needsCompany: false, error });
const researchResolvedWithArticle = () => ({
  loading: false,
  needsCompany: false,
  error: "",
  warnings: [],
  articles: [{ id: "art-1", url: "https://umbrella.example/story", suggestion: "They shipped X.", title: ARTICLE_TITLE }],
});

function baseProps(overrides = {}) {
  const research = {
    researchByJob: {},
    companyResearchByJob: {},
    openCompanyResearch: vi.fn(),
    // Stubbed at the function boundary: recording lives in DocumentPreviewMount,
    // never in this function, so the component's recording decisions are what is
    // under test, not the hook's. A resolved {ok:true,count} matches the real
    // success shape.
    autoInsertFactsForJob: vi.fn(async () => ({ ok: true, count: 2 })),
    removeInsertedFact: vi.fn(async () => ({ ok: true })),
    ...(overrides.research || {}),
  };
  return {
    preview: {
      resumePreview: {
        open: true,
        title: "Staff Engineer",
        company: COMPANY,
        tab: "cover",
        jobId: "job-1",
        posting: "",
        url: "",
        busy: {},
        notice: {},
        error: {},
      },
      previewScopeAvailable: vi.fn(() => false),
      loadPreviewModel: vi.fn(),
      closeResumePreview: vi.fn(),
      saveDocumentPreview: vi.fn(),
      renameDocument: vi.fn(),
      resubmitDocumentPreview: vi.fn(),
      downloadDocumentPreview: vi.fn(),
      applyFocusArea: vi.fn(),
      documentVersions: {},
      currentVersionId: {},
      selectDocumentVersion: vi.fn(),
      ...(overrides.preview || {}),
    },
    tailoringMap: overrides.tailoringMap || {},
    research,
    chat: { askAiAbout: vi.fn() },
    tailorEngine: "embedded",
    previewReloadKey: 0,
    scrapePreviewPosting: vi.fn(),
    currentUser: { id: "user-1" },
    resumeFile: null,
    coverLetterFile: null,
  };
}

// Merge a research entry for job-1 into baseProps, preserving the stub fns.
function propsWithResearch(entry, extra = {}) {
  const p = baseProps(extra);
  p.research.researchByJob = { "job-1": entry };
  return p;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The recordDecision calls that target the auto-insert decision id.
function autoInsertCalls() {
  return recordDecision.mock.calls.filter((c) => c[0] === "fact-auto-insert");
}

let container;
let root;
beforeEach(() => {
  vi.clearAllMocks();
  recordDecision.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 500, json: async () => null })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

// ===========================================================================
// RED -- CASE 1: research resolved having found NOTHING (articles.length === 0)
// ===========================================================================
describe("auto-insert: research resolved with zero articles is RECORDED (RED)", () => {
  it("records skipped/research-empty from the effect, never runs the function, and shows nothing on screen", async () => {
    const entry = researchResolvedEmpty();
    // NON-VACUITY: prove the fixture really is the resolved-with-zero state --
    // a "recorded when research found nothing" test is worthless if research
    // never actually resolved to empty in the fixture.
    expect(entry.loading).toBe(false);
    expect(Array.isArray(entry.articles) && entry.articles.length).toBe(0);
    expect(entry.error).toBe("");

    const props = propsWithResearch(entry);
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    await flush();

    const calls = autoInsertCalls();
    // The record exists (RED at HEAD: the effect returns early on
    // articles.length === 0, so nothing is recorded at all).
    expect(calls, "research-found-nothing was not recorded at all").toHaveLength(1);
    const [, outcome, fields] = calls[0];
    // Ordinary outcome -> "skipped" (not "failed": nothing is broken).
    expect(outcome).toBe("skipped");
    // A DISTINCT code from the function's own "nothing-eligible" (articles
    // present, none passed the filter): this is the upstream "no articles at
    // all" state, and the owner must be able to tell them apart.
    expect(fields.code).toBe("research-empty");
    expect(typeof fields.reason).toBe("string");
    expect(fields.reason.length).toBeGreaterThan(0);

    // FROM THE EFFECT, NOT THE FUNCTION: the function never ran, so the record
    // could only be the effect's.
    expect(props.research.autoInsertFactsForJob).not.toHaveBeenCalled();

    // CONTENT-LEAK GUARD: no company / title / url in the recorded fields.
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain(COMPANY);
    expect(serialized).not.toContain(ARTICLE_TITLE);
    expect(serialized).not.toContain("umbrella.example");

    // ON-SCREEN RULING: found-nothing is silent. Whatever canned reason was
    // recorded must not appear in the rendered DOM. (Limitation, stated: this
    // would miss a message shown with text DIFFERENT from the recorded reason;
    // the effect's only natural on-screen text would be this reason, so the
    // check bites the realistic mutant. The paired "function not called"
    // assertion is the primary instrument.)
    expect(document.body.textContent).not.toContain(fields.reason);
  });
});

// ===========================================================================
// RED -- CASE 2: research FAILED (could not run), distinguishable from CASE 1
// ===========================================================================
describe("auto-insert: research failure is RECORDED and distinct from found-nothing (RED)", () => {
  it("records failed/research-failed from the effect with a CANNED reason (never the raw error), never runs the function", async () => {
    const entry = researchFailed(LEAKY_ERROR);
    // NON-VACUITY: a genuinely resolved-but-failed entry.
    expect(entry.loading).toBe(false);
    expect(entry.articles.length).toBe(0);
    expect(entry.error.length).toBeGreaterThan(0);

    const props = propsWithResearch(entry);
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    await flush();

    const calls = autoInsertCalls();
    expect(calls, "research-failed was not recorded at all").toHaveLength(1);
    const [, outcome, fields] = calls[0];
    // A FAILURE, not a skip: "we could not look" is materially different from
    // "there was nothing", and the outcome axis must say so.
    expect(outcome).toBe("failed");
    expect(fields.code).toBe("research-failed");
    // DISTINCT from CASE 1 on BOTH axes.
    expect(outcome).not.toBe("skipped");
    expect(fields.code).not.toBe("research-empty");
    expect(typeof fields.reason).toBe("string");
    expect(fields.reason.length).toBeGreaterThan(0);

    // FROM THE EFFECT, NOT THE FUNCTION.
    expect(props.research.autoInsertFactsForJob).not.toHaveBeenCalled();

    // CONTENT-LEAK GUARD -- the raw research error is content-bearing (it can
    // carry a server message naming the company / a url). The recorded reason
    // must be CANNED, never entry.error passed through.
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain(COMPANY);
    expect(serialized).not.toContain("umbrella.example");
    expect(serialized).not.toContain(LEAKY_ERROR);
    expect(fields.reason).not.toBe(LEAKY_ERROR);

    // Silent on screen (see file header ruling).
    expect(document.body.textContent).not.toContain(fields.reason);
    expect(document.body.textContent).not.toContain(LEAKY_ERROR);
  });
});

// ===========================================================================
// RED -- CASE 3: research STILL RUNNING when the preview closes
// ===========================================================================
describe("auto-insert: preview closed while research still running is RECORDED (RED)", () => {
  it("records nothing while open+loading, then records skipped/research-pending on the close, without running the function", async () => {
    const entry = researchLoading();
    // NON-VACUITY: the fixture is genuinely still loading.
    expect(entry.loading).toBe(true);

    const props = propsWithResearch(entry);
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    await flush();

    // While OPEN and still LOADING, nothing is decided yet -- the record must
    // be triggered by the CLOSE, not by the mount. (This also proves the test
    // is not passing simply because the effect records on every render.)
    expect(autoInsertCalls(), "recorded before the preview even closed").toHaveLength(0);
    expect(props.research.autoInsertFactsForJob).not.toHaveBeenCalled();

    // The candidate closes the letter before research resolves. Re-render with
    // the SAME still-loading research entry and open:false -- exactly the
    // owner's 25-second window.
    const closedProps = propsWithResearch(researchLoading(), {
      preview: { ...props.preview, resumePreview: { ...props.preview.resumePreview, open: false } },
    });
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, closedProps));
    });
    await flush();

    const calls = autoInsertCalls();
    // RED at HEAD: the effect early-returns on !previewOpen and on
    // !articles.length, so a close-during-load records nothing.
    expect(calls, "closing before research resolved recorded nothing").toHaveLength(1);
    const [, outcome, fields] = calls[0];
    expect(outcome).toBe("skipped");
    expect(fields.code).toBe("research-pending");
    // DISTINCT from the other two cases.
    expect(fields.code).not.toBe("research-empty");
    expect(fields.code).not.toBe("research-failed");
    expect(typeof fields.reason).toBe("string");
    expect(fields.reason.length).toBeGreaterThan(0);

    // FROM THE EFFECT, NOT THE FUNCTION.
    expect(closedProps.research.autoInsertFactsForJob).not.toHaveBeenCalled();

    // No content leak.
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain(COMPANY);
    expect(serialized).not.toContain(ARTICLE_TITLE);
  });
});

// ===========================================================================
// GREEN CONTROL -- the happy path still records EXACTLY ONCE (no double-record).
// Passes at HEAD (only the function's own `acted` record fires); it must STAY
// green through the fix -- the new effect-level records for the empty/failed/
// pending branches must be mutually exclusive with the function-call branch.
// Proven discriminating by the mutation run (an effect that also records on the
// articles path makes this go to 2).
// ===========================================================================
describe("auto-insert: the happy path records exactly one decision (GREEN control)", () => {
  it("runs the function once and records only its own outcome -- never an extra effect-level record", async () => {
    const props = propsWithResearch(researchResolvedWithArticle());
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    await flush();

    // The function ran (the articles path is reachable) ...
    expect(props.research.autoInsertFactsForJob).toHaveBeenCalledTimes(1);
    // ... and produced EXACTLY ONE decision record -- its own `acted`.
    const calls = autoInsertCalls();
    expect(calls).toHaveLength(1);
    const [, outcome, fields] = calls[0];
    expect(outcome).toBe("acted");
    // The success record carries the real count, no content.
    expect(fields.count).toBe(2);
    expect(fields.code).toBeUndefined();
  });
});

// ===========================================================================
// GREEN CONTROL -- the ledger actually KEEPS these outcomes and fields.
// The spy above proves what the component DECIDED to record; it cannot prove
// the ledger honours it (the "injected fake cannot see the dropping layer"
// trap). This drives the REAL createActivityLog / DECISION_LEDGER: if a future
// edit dropped "skipped"/"failed" from the vocabulary, or "code" from the
// fact-auto-insert field whitelist, the recorded events would lose them and
// this goes red. It also proves the content-leak guard is enforced by the
// recorder, not merely by the caller's discipline.
// ===========================================================================
describe("auto-insert: the decision ledger keeps the new records intact (GREEN control)", () => {
  it("round-trips skipped/research-empty and failed/research-failed through the real recorder, dropping undeclared content", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    // A caller that (wrongly) tried to smuggle the company through an
    // undeclared field must have it dropped by the whitelist.
    log.recordDecision("fact-auto-insert", "skipped", { reason: "canned", code: "research-empty", company: COMPANY });
    log.recordDecision("fact-auto-insert", "failed", { reason: "canned", code: "research-failed", url: "https://umbrella.example" });
    log.recordDecision("fact-auto-insert", "skipped", { reason: "canned", code: "research-pending" });

    const events = log.snapshot().events;
    const byType = (t) => events.find((e) => e.type === t);

    // "skipped" and "failed" are real outcomes -> the type is NOT normalized to
    // ".unknown".
    const empty = byType("fact-auto-insert.skipped");
    expect(empty, "skipped is not an accepted outcome for fact-auto-insert").toBeTruthy();
    expect(empty.code).toBe("research-empty");
    expect(empty.reason).toBe("canned");
    // Undeclared content field is dropped by the closed whitelist.
    expect(empty).not.toHaveProperty("company");

    const failed = byType("fact-auto-insert.failed");
    expect(failed, "failed is not an accepted outcome for fact-auto-insert").toBeTruthy();
    expect(failed.code).toBe("research-failed");
    expect(failed).not.toHaveProperty("url");

    // The pending record shares the skipped type; assert its code is present on
    // one of the two skipped events.
    const skippedCodes = events.filter((e) => e.type === "fact-auto-insert.skipped").map((e) => e.code);
    expect(skippedCodes).toContain("research-pending");
  });
});
