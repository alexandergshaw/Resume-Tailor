// @vitest-environment jsdom
//
// N73 -- THE TRIGGER (candidate-initiated half). The owner's words: "have the
// facts researched AT THE SAME TIME that the cover letter and resume are being
// generated, and then have the facts inserted and highlighted BY THE TIME THE
// MODAL OPENS UP." On HEAD, company research is warmed only when the PREVIEW
// OPENS (useDocumentPreview.js:308-313 openResumePreview, :914
// finishByOpeningPreview) -- i.e. AFTER the tailor response, AFTER the awaited
// persistence block, and AFTER the modal-open transition begins. This file is
// the candidate-initiated path's share of moving that warm EARLIER, inside
// tailorPosting itself.
//
// SCOPE OF THIS SEAT (N73). The auto-INSERT/highlight/remove function is N72,
// another seat's file (app/hooks/useCompanyResearch.js,
// app/hooks/autoInsertFactsForJob.*.test.js) -- NOT touched here. This file
// pins only the TRIGGER: that the manual pipeline fires the (existing,
// deduped, fire-and-forget) startBackgroundResearch as early as it can, with
// the SAME job identity the preview-open warm uses (so the shared
// researchStartedRef collapses them to one paid call), and that a slow/failed
// warm can never delay or fail the generation the candidate is waiting on.
//
// A HONEST LIMIT, stated up front and again in the seat report. The manual
// paste path has NO company until /api/tailor returns it (payload.company,
// useManualTailor.js:144), and startBackgroundResearch REFUSES to fetch with
// an empty company (useCompanyResearch.js:207-208). So "in flight BEFORE the
// tailor response resolves" -- the literal wording of N73 criterion 1 -- is
// UNACHIEVABLE on this path without changing another seat's gate. The
// achievable, faithful move that IS tested here: the warm is issued the moment
// the company is known and BEFORE the awaited persistence block and BEFORE
// finishByOpeningPreview, fire-and-forget -- a head start of the whole
// persistence + modal-open window over today's preview-open warm. The
// truly-concurrent (company-known-upfront) warm belongs to the page.js job/URL
// paths, which are NOT this seat's files; they "keep arriving late" until wired
// separately.
//
// CONTRACT THIS FILE BINDS: useManualTailor gains a `startBackgroundResearch`
// prop (page.js already holds `research.startBackgroundResearch`; the one-line
// thread into the useManualTailor({...}) call is the implementer's page.js
// change). tailorPosting calls it once, fire-and-forget, on a preview-opening
// run that produced a cover letter, keyed on the SAME syntheticJobId it hands
// finishByOpeningPreview.

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

// A real File (FormData stringifies non-Blobs -- see useManualTailor.test.js).
const RESUME = new File(["resume bytes"], "resume.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

// The good-run payload shape, read from the route + the pipeline's own reads
// (mirrors useManualTailor.test.js:okPayload). Company + a cover letter present
// by default: the case where research is worth warming.
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
    // The prop this seat adds. A vi.fn() stands in for
    // research.startBackgroundResearch (deduped + fire-and-forget in prod).
    startBackgroundResearch: vi.fn(),
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

describe("N73 crit 1 -- the manual pipeline warms research at generation, not only at preview-open", () => {
  it("fires startBackgroundResearch during tailorPosting, BEFORE persistence and BEFORE the preview opens", async () => {
    // RED on HEAD: tailorPosting never calls startBackgroundResearch -- the
    // only warm today is inside finishByOpeningPreview / openResumePreview, so
    // the prop is dead. "called at all" is the unambiguous RED reason.
    const props = baseProps({ currentUser: { id: "user-1" } }); // currentUser -> persistence runs, so the ordering is observable
    await mount(props);
    await run({ overridePosting: "A posting" });

    expect(
      props.startBackgroundResearch,
      "tailorPosting did not warm company research at generation time (N73 trigger absent)",
    ).toHaveBeenCalledTimes(1);

    // Non-vacuity for the ordering assertions: both later steps really ran.
    expect(persistGeneratedDocuments).toHaveBeenCalledTimes(1);
    expect(props.finishByOpeningPreview).toHaveBeenCalledTimes(1);

    const warmOrder = props.startBackgroundResearch.mock.invocationCallOrder[0];
    const persistOrder = persistGeneratedDocuments.mock.invocationCallOrder[0];
    const openOrder = props.finishByOpeningPreview.mock.invocationCallOrder[0];
    // The whole point: the warm gets a head start over the persistence +
    // modal-open window (today's warm fires only at :914, AFTER both).
    expect(warmOrder, "the warm did not precede the persistence round-trips").toBeLessThan(persistOrder);
    expect(warmOrder, "the warm did not precede the preview opening").toBeLessThan(openOrder);
  });

  it("warms with the SAME job identity it hands finishByOpeningPreview (so the shared dedupe collapses them) [crit 2]", async () => {
    // crit 2 depends on both warm sites keying on ONE jobId: the generation
    // warm and the preview-open warm must share researchStartedRef's key or
    // they double-spend. This pins the manual side of that shared key.
    const props = baseProps();
    await mount(props);
    const result = await run({ overridePosting: "A posting" });

    expect(props.startBackgroundResearch).toHaveBeenCalledTimes(1);
    const warmArg = props.startBackgroundResearch.mock.calls[0][0];
    const openArg = props.finishByOpeningPreview.mock.calls[0][0];
    expect(warmArg.jobId, "the warm's jobId is not the run's own synthetic id").toBe(result.jobId);
    expect(
      warmArg.jobId,
      "the generation warm and the preview-open warm use DIFFERENT job ids -- the dedupe cannot collapse them, so one job pays twice",
    ).toBe(openArg.jobId);
    // The company the dedupe/route needs is carried, not left empty.
    expect(warmArg.company, "the warm carried no company -- startBackgroundResearch would refuse it").toBe("Acme");
  });
});

describe("N73 crit 1/5 -- the warm can never delay or fail the generation", () => {
  it("does not block the run or the modal when the warm never settles (fire-and-forget, not awaited)", async () => {
    // A warm that hangs (slow external research) must not hold the candidate's
    // finished documents hostage. If the implementer AWAITS the warm, run()
    // never resolves and this test times out -- the discriminator.
    const props = baseProps({ startBackgroundResearch: vi.fn(() => new Promise(() => {})) });
    await mount(props);
    const result = await run({ overridePosting: "A posting" });

    expect(props.startBackgroundResearch, "the warm was never fired, so 'non-blocking' is untested").toHaveBeenCalledTimes(1);
    expect(result?.ok, "the run did not complete while the warm was still in flight").toBe(true);
    expect(props.finishByOpeningPreview, "the modal did not open while the warm was still in flight").toHaveBeenCalledTimes(1);
  });

  it("a warm that throws leaves the run successful, the modal open, and NO false message to the candidate [crit 5]", async () => {
    // Research failing must degrade to today: generation still succeeds, the
    // modal still opens, and the candidate is NOT told anything (a research
    // problem is not a generation problem). api.error stays clear -- it must
    // never carry a research-warm failure.
    const props = baseProps({
      startBackgroundResearch: vi.fn(() => {
        throw new Error("research warm boom");
      }),
    });
    await mount(props);
    const result = await run({ overridePosting: "A posting" });

    expect(props.startBackgroundResearch, "the warm never fired, so 'throw is swallowed' is untested").toHaveBeenCalledTimes(1);
    expect(result?.ok, "a thrown warm turned a paid-for, successful generation into a failure").toBe(true);
    expect(props.finishByOpeningPreview, "a thrown warm stopped the modal from opening").toHaveBeenCalledTimes(1);
    expect(api.error, "a research-warm failure was surfaced to the candidate as a generation error").toBe("");
  });
});

describe("N73 -- the warm is gated, not unconditional (controls: no over-fire)", () => {
  it("does not warm when the run produced no cover letter (facts only go in the cover letter)", async () => {
    // Control for the crit-1 'warm fires' test: without a cover letter there is
    // nowhere for a fact to land, so warming would be pure wasted spend. Mirrors
    // finishByOpeningPreview's own hasCover gate. (Green on HEAD -- the warm
    // never fires there at all -- so this bites the reference build, proven by
    // the 'remove the cover gate' mutant in the seat report.)
    const props = baseProps({ startBackgroundResearch: vi.fn() });
    mockFetchOnce({ payload: okPayload({ coverLetterResultLines: [], coverLetterResult: "" }) });
    await mount(props);
    await run({ overridePosting: "A posting" });
    expect(props.startBackgroundResearch, "warmed research for a run with no cover letter to hold the facts").not.toHaveBeenCalled();
  });

  it("does not warm on a queued (openPreview:false) run -- no modal opens, so it rides the late preview-open warm", async () => {
    // Control + design ruling (seat report): the generation-start warm is tied
    // to the run that will open a review surface. A queued multi-posting run
    // opens no modal per posting; warming N postings up front spends research
    // on letters the candidate may never open. Those rely on the late
    // openResumePreview warm (crit 3). The shared dedupe means no posting the
    // candidate DOES open pays twice.
    const props = baseProps({ startBackgroundResearch: vi.fn() });
    await mount(props);
    await run({ overridePosting: "A posting", queued: true, openPreview: false });
    expect(props.startBackgroundResearch, "warmed research on a queued run that opens no review surface").not.toHaveBeenCalled();
  });
});
