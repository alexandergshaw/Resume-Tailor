// @vitest-environment jsdom
//
// N68 latency, step L4 -- the preview opens WITHOUT waiting on post-generation
// persistence. (AC-L4; design DS-4/DS-5/DS-6; plan step 2 / risk rows 2(L4).)
// This is the TDD hand-off: these tests land RED against HEAD; the implementer
// makes them green. NO production code is written by this seat.
//
// WHAT L4 DOES, and how each property is pinned below:
//   1. INITIATION ORDER (the latency win). On an interactive run
//      (openPreview !== false) finishByOpeningPreview is called -- and the
//      modal reaches `open:true` -- BEFORE the awaited persistence resolves.
//      HEAD awaits upsertPosition -> upsertApplication -> persistGeneratedDocuments
//      (useManualTailor.js:271-303) and only THEN calls finishByOpeningPreview
//      (:307). Test A.
//   2. A BACKGROUND-PERSIST FAILURE IS SURFACED, NEVER SWALLOWED. On HEAD a
//      throwing upsertApplication (lib/supabase/applicationStatusWriter.js:272,
//      reached via upsertApplication) propagates to tailorPosting's catch
//      (:320), flips the job to "error" and returns {ok:false} -- the preview
//      never opens and nothing reaches the preview's error channel. L4 catches
//      the background failure and surfaces it through the preview's scoped
//      error channel. Test B (+ its success control).
//   3. NO PAID-GENERATION LOSS. Same HEAD failure discards an already-generated,
//      already-paid-for document (the design's own finding). L4 keeps the
//      generated document reaching the preview even when persistence fails.
//      Test C.
//   4. VERSION HISTORY REFRESHES after the background persist completes, via a
//      new onGenerationPersisted callback -> useDocumentPreview
//      reloadVersionsForPosition(jobId, positionId) over the knownPositionId
//      seam (useDocumentPreview.js:167-168). Test D.
//   5. SCOPE GUARD: the queued/auto path (openPreview === false) keeps
//      persistence INLINE/awaited (useManualPostings awaits the return to know a
//      worker finished). Test E.
//   6. LAST HOP: the user can download the shown document from the opened
//      preview after a successful run. Test F.
//
// jsdom PROVES ORDERING/INITIATION-ORDER, NOT wall-clock or a true concurrency
// race (backlog N74). Every timing claim below is "which calls/setState have
// happened at this point", asserted by holding a mock as an unresolved deferred
// and checking state before/after it resolves -- never by a timer or an elapsed
// duration. Each test says so.
//
// REACHABILITY (standing rule). Test A and the success/failure content tests
// drive the real tailorPosting by CLICKING a rendered Generate button, the way
// page.js's Generate control does; this harness stands in for page.js's wiring
// (page.js is a held god-component, out of this seat's scope). The queued path
// (Test E) is driven the way its real caller drives it: useManualPostings calls
// tailorPosting directly, so that test invokes it directly and notes so.
//
// THE L4 CONTRACT THIS FILE PINS (design named reloadVersionsForPosition and
// "surface via the preview notice/error channel" but left the exact failure
// seam to the plan/TDD; this seat pins it, flagged for the checker):
//   useManualTailor NEW props:
//     onGenerationPersisted?({ jobId, positionId })   -- called after the
//        background persistence SUCCEEDS (interactive path).
//     onGenerationPersistError?({ jobId, error })     -- called from the
//        background persistence CATCH (interactive path). The non-swallow.
//   useDocumentPreview NEW return methods:
//     reloadVersionsForPosition(jobId, positionId)    -- bump a fresh versions
//        requestId and refresh both scopes via the knownPositionId seam.
//     notePersistFailure(jobId, message)              -- surface a persist
//        failure on resumePreview.error (both scopes) for the open job.
// None of these are MODULE exports (they are hook props / return properties),
// so the ORPHAN_EXPORTS/TEST_REFERENCED census (70/368) is untouched.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

// ---------------------------------------------------------------------------
// Mocks. The network, the docx parse, and the four Supabase helpers are mocked;
// the two hooks under test are real and composed together (the AC-L4 instrument:
// the manual pipeline + the REAL finishByOpeningPreview from useDocumentPreview).
// ---------------------------------------------------------------------------
vi.mock("../../lib/document/docx", () => ({
  buildTemplateLinesForUpload: vi.fn(async () => ["line one", "line two"]),
  // previewBlob.js imports resolveDocumentBlob from this module; never called on
  // the L4 paths, but provided so the binding is defined if a path ever reaches it.
  resolveDocumentBlob: vi.fn(async () => null),
}));
vi.mock("../../lib/tailor/localSignals", () => ({
  promotedEditRules: vi.fn(() => []),
}));
// resolvePositionId (open-time version load) looks a position up by external_id.
// Stubbed to return NO row: this is the design's version-history regression
// condition (after the L4 reorder the row is not written when the preview opens,
// so the external_id lookup finds nothing). Version history can therefore ONLY
// populate via reloadVersionsForPosition(jobId, knownPositionId) -- which is the
// whole point of the L4 seam (Test D).
vi.mock("../../lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  })),
}));
vi.mock("../../lib/supabase/upsertPosition", () => ({
  upsertPosition: vi.fn(async () => "pos-1"),
}));
vi.mock("../../lib/supabase/upsertApplication", () => ({
  upsertApplication: vi.fn(async () => undefined),
}));
vi.mock("../../lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));
vi.mock("../../lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => true),
}));

import { useManualTailor } from "./useManualTailor.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import { upsertPosition } from "../../lib/supabase/upsertPosition";
import { upsertApplication } from "../../lib/supabase/upsertApplication";
import { persistGeneratedDocuments } from "../../lib/supabase/persistGeneration";
import { fetchDocumentVersions } from "../../lib/supabase/documentVersions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A real File: FormData.append stringifies non-Blobs, so a plain object would
// come back "[object Object]" (see useManualTailor.test.js:47-52).
const RESUME = new File(["resume bytes"], "resume.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

// The good-run /api/tailor payload (shape read from the route + the pipeline's
// own reads; mirrors useManualTailor.test.js:okPayload). Cover letter present so
// the preview opens with both scopes' content.
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Harness: the real useDocumentPreview + the real useManualTailor, sharing one
// tailoringMap and updateTailoringJob, wired the way page.js wires them. The
// rendered <button> is the reachable Generate control.
// ---------------------------------------------------------------------------
let previewApi = null;
let manualApi = null;
let latestMap = null;
const previewRef = { current: null };
const manualRef = { current: null };
let currentUserCfg = { id: "user-1" };
let nextOpts = {};
let downloadSpy = null;
let container = null;
let root = null;

function Harness() {
  const [tailoringMap, setTailoringMap] = useState({});
  latestMap = tailoringMap;
  const updateTailoringJob = (jobId, updater) =>
    setTailoringMap((cur) => ({
      ...cur,
      [jobId]: typeof updater === "function" ? updater(cur[jobId] || {}) : { ...(cur[jobId] || {}), ...updater },
    }));
  const startBackgroundResearch = () => {};

  const preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob,
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: downloadSpy,
    startBackgroundResearch,
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: currentUserCfg,
  });
  previewApi = preview;
  previewRef.current = preview;

  const manual = useManualTailor({
    resumeFile: RESUME,
    coverLetterFile: null,
    contextFiles: [],
    additionalContext: "",
    aggressiveness: 3,
    tailorEngine: "embedded",
    currentUser: currentUserCfg,
    setTrackedJobs: () => {},
    updateTailoringJob,
    maybeOfferLibraryUpdate: () => {},
    withClearedEditedScopes: () => ({ resume: false, cover: false }),
    finishByOpeningPreview: preview.finishByOpeningPreview,
    startBackgroundResearch,
    // L4 success seam: reload version history for the freshly-persisted row.
    onGenerationPersisted: ({ jobId, positionId }) =>
      previewRef.current.reloadVersionsForPosition?.(jobId, positionId),
    // L4 failure seam (the non-swallow): surface the persist failure on the
    // preview's error channel.
    onGenerationPersistError: ({ jobId, error }) =>
      previewRef.current.notePersistFailure?.(jobId, error),
  });
  manualApi = manual;
  manualRef.current = manual;

  return createElement(
    "button",
    {
      "data-testid": "generate",
      onClick: (e) => {
        // Exactly page.js's fire-and-forget: the click handler kicks off
        // tailorPosting and does not await it.
        manualRef.current.tailorPosting(e, nextOpts);
      },
    },
    "Generate",
  );
}

async function mountHarness() {
  await act(async () => {
    root.render(createElement(Harness));
  });
}

// Drain several microtask ticks inside act() so a chain of already-resolved
// awaits (buildTemplateLines -> fetch -> json -> setState -> background task)
// completes. NOT a timer: nothing here waits on wall-clock; pending deferreds
// stay pending.
async function settle(ticks = 8) {
  await act(async () => {
    for (let i = 0; i < ticks; i += 1) await Promise.resolve();
  });
}

async function clickGenerate() {
  await act(async () => {
    container.querySelector('[data-testid="generate"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const previewOpen = () => previewApi.resumePreview.open;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => okPayload() }));
  upsertPosition.mockImplementation(async () => "pos-1");
  upsertApplication.mockImplementation(async () => undefined);
  persistGeneratedDocuments.mockImplementation(async () => undefined);
  fetchDocumentVersions.mockImplementation(async () => []);
  currentUserCfg = { id: "user-1" };
  nextOpts = { overridePosting: "A posting", syntheticJobId: "job-1", openPreview: true };
  downloadSpy = vi.fn(async () => null);
  previewApi = null;
  manualApi = null;
  latestMap = null;
  previewRef.current = null;
  manualRef.current = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete globalThis.fetch;
});

// ===========================================================================
// Test A -- INITIATION ORDER: the preview opens before persistence resolves.
// ===========================================================================
describe("L4/AC-L4 -- the preview opens without waiting on persistence (initiation order, N74-safe)", () => {
  it("reaches resumePreview.open=true only AFTER generation and BEFORE the persistence round-trips resolve", async () => {
    // ORDERING, not wall-clock (N74): fetch is held as an unresolved deferred to
    // prove the modal does NOT open before the document exists (under-fire
    // control); persistence (upsertPosition) is held permanently unresolved to
    // prove the modal opens WITHOUT waiting on it (the latency win).
    const fetchD = deferred();
    globalThis.fetch = vi.fn(() => fetchD.promise);
    upsertPosition.mockReturnValue(new Promise(() => {})); // persistence never resolves

    await mountHarness();
    await clickGenerate();
    await settle();

    // UNDER-FIRE CONTROL: generation is not done yet (fetch pending), so the
    // preview must NOT be open. A build that opens the modal on click,
    // regardless of the generated result, fails here.
    expect(previewOpen(), "the preview opened before the document was generated").toBe(false);

    // Generation completes; persistence (upsertPosition) is still pending forever.
    await act(async () => {
      fetchD.resolve({ ok: true, json: async () => okPayload() });
    });
    await settle();

    // NON-VACUITY: persistence really was reached (so "opened before it resolved"
    // is a real claim, not "persistence never ran"). Identical on HEAD and L4 --
    // HEAD suspends here; L4 runs it in the background.
    expect(upsertPosition, "persistence was never even attempted").toHaveBeenCalledTimes(1);

    // THE WIN, RED ON HEAD: HEAD awaits the (now-forever-pending) persistence
    // block BEFORE finishByOpeningPreview (:271-303 then :307), so the modal
    // never opens. L4 opens it first and persists in the background.
    expect(
      previewOpen(),
      "the preview did not open while persistence was still pending -- it is still gated behind the persistence await",
    ).toBe(true);
    expect(previewApi.resumePreview.jobId, "the opened preview is not the generated job").toBe("job-1");
  });
});

// ===========================================================================
// Test B -- a background persist FAILURE is surfaced, never swallowed.
// ===========================================================================
describe("L4/DS-5 -- a persistence failure is surfaced through the preview error channel, not swallowed", () => {
  it("shows a persist failure on the preview's error channel while keeping the modal open", async () => {
    // upsertApplication is the one persistence helper that CAN throw
    // (lib/supabase/applicationStatusWriter.js:272). upsertPosition resolves so
    // the throw is reached.
    upsertPosition.mockImplementation(async () => "pos-1");
    upsertApplication.mockImplementation(async () => {
      throw new Error("persist boom");
    });

    await mountHarness();
    await clickGenerate();
    await settle();

    // NON-VACUITY: the throwing helper really ran.
    expect(upsertApplication, "the throwing persistence helper never ran").toHaveBeenCalledTimes(1);

    // RED ON HEAD: HEAD lets the throw propagate to tailorPosting's catch
    // (:320), which sets status:"error" and returns {ok:false} -- the modal
    // never opens and no error reaches the preview channel. L4 catches the
    // background failure, keeps the modal open, and surfaces it.
    expect(previewOpen(), "a persist failure closed (or never opened) the preview").toBe(true);
    const err = previewApi.resumePreview.error;
    expect(
      err.resume || err.cover,
      "the persistence failure was swallowed -- nothing reached the preview's error channel (this repo's recurring silent-failure class)",
    ).toBeTruthy();
  });

  it("CONTROL: a SUCCESSFUL persist raises no error alarm (guards against a build that always alarms)", async () => {
    // Over-fire control for the test above. Green on HEAD (the success path
    // opens the modal with a clear error channel). RED against a mutant that
    // sets a persist error unconditionally.
    await mountHarness();
    await clickGenerate();
    await settle();

    expect(persistGeneratedDocuments, "the success persistence path did not run").toHaveBeenCalledTimes(1);
    expect(previewOpen()).toBe(true);
    const err = previewApi.resumePreview.error;
    expect(err.resume, "a successful save falsely reported a résumé error").toBe("");
    expect(err.cover, "a successful save falsely reported a cover-letter error").toBe("");
  });
});

// ===========================================================================
// Test C -- no paid-generation loss: the document still reaches the preview.
// ===========================================================================
describe("L4 -- a persistence failure never discards the paid-for generated document", () => {
  it("still shows the generated document in the preview when persistence fails", async () => {
    upsertPosition.mockImplementation(async () => "pos-1");
    upsertApplication.mockImplementation(async () => {
      throw new Error("persist boom");
    });

    await mountHarness();
    await clickGenerate();
    await settle();

    // RED ON HEAD: the throw aborts tailorPosting before finishByOpeningPreview,
    // so the generated document (already in the tailoring map) is never shown --
    // the candidate loses a generation they paid for. L4 keeps it visible.
    expect(previewOpen(), "the finished document was discarded on a persist failure").toBe(true);
    expect(previewApi.resumePreview.jobId).toBe("job-1");

    // The document the candidate paid for is present and viewable (not a
    // saved-looking blank). Guards a build that opens an EMPTY preview.
    const entry = latestMap["job-1"] || {};
    expect(entry.resultLines, "the generated résumé content did not reach the preview").toEqual([
      "TAILORED RESUME TEXT",
    ]);
    expect(entry.coverLetterResultLines).toEqual(["Dear hiring team"]);
  });
});

// ===========================================================================
// Test D -- version history refreshes after the background persist completes.
// ===========================================================================
describe("L4/DS-6 -- version history reloads after background persistence completes", () => {
  it("populates version history via onGenerationPersisted -> reloadVersionsForPosition(knownPositionId)", async () => {
    // The open-time load resolves the position by external_id, which this
    // suite stubs to find NO row (createClient mock) -- the design's regression
    // condition. So version history can ONLY come from the reload with the KNOWN
    // positionId that the background persist yields.
    upsertPosition.mockImplementation(async () => "pos-1");
    fetchDocumentVersions.mockImplementation(async (_client, scope) =>
      scope === "resume"
        ? [{ id: "r1", content: "TAILORED RESUME TEXT", content_lines: ["TAILORED RESUME TEXT"], created_at: "2026-09-29T00:00:00.000Z", docx_path: "" }]
        : [{ id: "c1", content: "Dear hiring team", content_lines: ["Dear hiring team"], created_at: "2026-09-29T00:00:00.000Z", docx_path: "" }],
    );

    await mountHarness();
    await clickGenerate();
    await settle();

    // NON-VACUITY: fetchDocumentVersions is keyed on a positionId; if the reload
    // never fired with the known id, it is never called with "pos-1".
    const calledWithKnownPosition = fetchDocumentVersions.mock.calls.some((c) => c[2] === "pos-1");
    expect(
      calledWithKnownPosition,
      "version history was never reloaded with the known positionId -- onGenerationPersisted -> reloadVersionsForPosition did not fire",
    ).toBe(true);

    // RED ON HEAD (and against any build that opens the preview early but never
    // fires onGenerationPersisted/reloadVersionsForPosition): the open-time
    // external_id lookup finds no row, so history stays empty.
    expect(
      previewApi.documentVersions.resume.map((v) => v.id),
      "résumé version history did not refresh after the background persist",
    ).toEqual(["r1"]);
    expect(previewApi.documentVersions.cover.map((v) => v.id)).toEqual(["c1"]);
  });

  it("CONTROL: without a completed persist, version history stays empty (no phantom populate)", async () => {
    // Hold persistence pending forever: onGenerationPersisted must not fire, so
    // the reload must not run and history must stay empty. Guards a build that
    // populates version history regardless of whether the row was persisted.
    upsertPosition.mockReturnValue(new Promise(() => {}));
    fetchDocumentVersions.mockImplementation(async () => [
      { id: "x1", content: "x", content_lines: ["x"], created_at: "2026-09-29T00:00:00.000Z", docx_path: "" },
    ]);

    await mountHarness();
    await clickGenerate();
    await settle();

    expect(
      previewApi.documentVersions.resume,
      "version history populated before the persistence that owns the positionId completed",
    ).toEqual([]);
    expect(fetchDocumentVersions.mock.calls.some((c) => c[2] === "pos-1")).toBe(false);
  });
});

// ===========================================================================
// Test E -- SCOPE GUARD: the queued/auto path keeps persistence INLINE.
// ===========================================================================
describe("L4/DS-4 -- the queued path (openPreview:false) keeps persistence inline and opens no modal", () => {
  it("does not resolve tailorPosting until persistence completes, and opens no preview", async () => {
    // Driven the way the real caller drives it: useManualPostings calls
    // tailorPosting directly and awaits the return to know the worker finished
    // (useManualPostings.js:266). This is a GUARD (green on HEAD, where the
    // queued path already awaits persistence); it is RED against the
    // over-correction mutant that backgrounds persistence on the queued path too.
    const persistD = deferred();
    upsertPosition.mockReturnValue(persistD.promise);

    await mountHarness();
    let resolved = false;
    let returnedVal = null;
    await act(async () => {
      manualRef.current
        .tailorPosting(null, { overridePosting: "A posting", syntheticJobId: "job-q", queued: true, openPreview: false })
        .then((v) => {
          resolved = true;
          returnedVal = v;
        });
    });
    await settle();

    // Persistence pending: the queued return must still be awaiting it inline.
    expect(upsertPosition, "persistence was not even started on the queued path").toHaveBeenCalledTimes(1);
    expect(
      resolved,
      "the queued run resolved BEFORE persistence completed -- persistence was backgrounded on a path that must stay inline (the queue would report a worker done before its row exists)",
    ).toBe(false);
    // A queued, multi-posting run opens no modal per posting.
    expect(previewOpen(), "the queued path opened a preview modal").toBe(false);

    // Non-vacuity: once persistence completes, the inline await resolves.
    await act(async () => {
      persistD.resolve("pos-q");
    });
    await settle();
    expect(resolved, "the queued run never resolved even after persistence completed").toBe(true);
    expect(returnedVal?.ok).toBe(true);
    expect(previewOpen(), "the queued path opened a modal after persistence").toBe(false);
  });
});

// ===========================================================================
// Test F -- LAST HOP: download works from the opened preview after a good run.
// ===========================================================================
describe("L4 last hop -- the shown document downloads from the opened preview", () => {
  it("downloads the open job's résumé through the real preview download path", async () => {
    // Non-regression guard (green on HEAD): the L4 reorder must not break the
    // download last hop. Discriminates a build that opens the WRONG job:
    // buildDownloadArgs reads the open job's entry, so templateDocxB64 would be
    // empty for a mismatched jobId. The download control lives in
    // DocumentPreviewDialog (out of this seat's scope); this drives the hook's
    // downloadDocumentPreview contract directly.
    await mountHarness();
    await clickGenerate();
    await settle();

    expect(previewOpen()).toBe(true);
    expect(previewApi.resumePreview.jobId).toBe("job-1");

    await act(async () => {
      await previewApi.downloadDocumentPreview("resume", "TAILORED RESUME TEXT");
    });
    await settle();

    expect(downloadSpy, "the download never reached the docx builder").toHaveBeenCalledTimes(1);
    const args = downloadSpy.mock.calls[0][0];
    expect(args.result, "the download did not carry the shown résumé text").toBe("TAILORED RESUME TEXT");
    expect(
      args.templateDocxB64,
      "the download did not read the OPEN job's generated bytes -- the preview opened the wrong entry",
    ).toBe("ZG9jeA==");
    expect(previewApi.resumePreview.error.resume, "the download surfaced an error").toBe("");
  });
});
