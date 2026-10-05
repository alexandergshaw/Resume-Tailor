// @vitest-environment jsdom
//
// N104 Waves D/E - the Regenerate flow ASSEMBLED through the real DocumentPreviewMount:
// click -> post -> the entry is rewritten in one write -> the report shows -> Undo puts
// it back. The sibling DocumentPreviewMount.regenerate.test.js proves the control is on
// screen and gated; the controller, submit and leaves are proven in their own files.
// This file proves the pieces are joined, with the network stubbed (no key, no real
// request): the writer the mount is given (page.js's updateTailoringJob) is a real
// state owner here, so "the entry changed" is read off the state, not off a spy.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, useState } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BEFORE = "Application-ready line one\nApplication-ready line two";
const AFTER = "Application-ready line one\nBuilt GraphQL APIs for the platform\nApplication-ready line two";
const POSTING = "We need GraphQL APIs experience.";

const reqs = [{ id: "q1", text: "GraphQL APIs" }];

function entryBefore() {
  return {
    result: BEFORE,
    resultLines: BEFORE.split("\n"),
    jobDescription: POSTING,
    // A level-1-5 style cover letter so the Cover tab exists to switch to.
    coverLetterResultLines: ["Dear team,", "I would like to apply."],
    ideal: {
      hypothetical: { result: "Hypothetical line", resultLines: ["Hypothetical line"], isHypothetical: true },
      applicationReady: { result: BEFORE, isHypothetical: false },
      postingAnalysis: { requirements: reqs },
      keywordMap: { entries: [{ keyword: "GraphQL", section: "competencies", priority: 1, requirementIndex: 0 }] },
      review: {
        status: "reviewed",
        flags: [
          {
            category: "missing-keyword",
            spanId: "s1",
            message: 'The posting asks for "GraphQL" ("GraphQL APIs") but this draft never mentions it.',
            evidenceRef: { origin: "posting", spanId: "q1" },
          },
        ],
        unresolvedQualifications: [],
        coverage: { complete: false },
        lineCount: 2,
      },
      removed: [],
      leftOut: [],
      counts: { kept: 2, keptAccomplishments: 1, removed: 0, leftOut: 0 },
    },
  };
}

// What the server answers for a regenerate: the pipeline result plus the closure report.
function regenerateBody() {
  return {
    result: AFTER,
    resultLines: AFTER.split("\n"),
    docxB64: "",
    ideal: {
      hypothetical: { result: "Hypothetical line", resultLines: ["Hypothetical line"], isHypothetical: true },
      applicationReady: { result: AFTER, isHypothetical: false },
      postingAnalysis: { requirements: reqs },
      keywordMap: { entries: [] },
      review: { status: "reviewed", flags: [], unresolvedQualifications: [], coverage: { complete: false } },
      removed: [],
      leftOut: [],
      counts: { kept: 3, keptAccomplishments: 2, removed: 0, leftOut: 0 },
    },
    closure: {
      correspondenceUnavailable: false,
      closed: [{ category: "missing-keyword", requirementId: "q1", term: "GraphQL", label: "Posting keyword missing" }],
      stillOpen: [],
      countsBefore: { missingKeyword: 1, vague: 0, repetition: 0 },
      countsAfter: { missingKeyword: 0, vague: 0, repetition: 0 },
      lineCountBefore: 2,
      lineCountAfter: 3,
      genuinelyUnqualifiedStillOpen: [],
    },
    confirm: [],
    genuinelyUnqualified: [],
  };
}

const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

let container;
let root;
let latestMap;
let realFetch;
let tailorCalls;

function previewFor(jobId) {
  return {
    resumePreview: { open: true, title: "Staff Engineer", company: "Acme", tab: "resume", jobId, posting: "", url: "", busy: {}, notice: {}, error: {} },
    previewScopeAvailable: vi.fn(() => true),
    loadPreviewModel: vi.fn(async () => ({ paragraphs: [] })),
    closeResumePreview: vi.fn(),
    saveDocumentPreview: vi.fn(),
    renameDocument: vi.fn(),
    resubmitDocumentPreview: vi.fn(),
    downloadDocumentPreview: vi.fn(),
    applyFocusArea: vi.fn(),
    documentVersions: {},
    currentVersionId: {},
    selectDocumentVersion: vi.fn(),
  };
}

// Owns the tailoring map and the reload key exactly as page.js does, and hands the
// mount the same two callbacks.
function Harness({ jobId, engine, handEdited = false }) {
  const first = handEdited
    ? { ...entryBefore(), result: "Edited by hand\nSecond line", resultLines: ["Edited by hand", "Second line"], edited: { resume: true, cover: false } }
    : entryBefore();
  const [map, setMap] = useState({ "job-1": first, "job-2": { ...entryBefore(), result: "Other job text", resultLines: ["Other job text"] } });
  const [reloadKey, setReloadKey] = useState(0);
  latestMap = map;
  const update = (id, updater) =>
    setMap((cur) => ({ ...cur, [id]: typeof updater === "function" ? updater(cur[id] || {}) : { ...(cur[id] || {}), ...updater } }));
  return createElement(DocumentPreviewMount, {
    preview: previewFor(jobId),
    tailoringMap: map,
    research: { researchByJob: {}, companyResearchByJob: {}, openCompanyResearch: vi.fn() },
    chat: { askAiAbout: vi.fn() },
    tailorEngine: engine,
    previewReloadKey: reloadKey,
    scrapePreviewPosting: vi.fn(),
    currentUser: { id: "user-1" },
    resumeFile: new File(["Jane Doe\nEngineer\nBuilt GraphQL APIs\n"], "resume.txt", { type: "text/plain" }),
    coverLetterFile: null,
    updateTailoringJob: update,
    onPreviewReload: () => setReloadKey((k) => k + 1),
  });
}

async function renderHarness(props = {}) {
  await act(async () => root.render(createElement(Harness, { jobId: "job-1", engine: "gemini", ...props })));
}

const buttons = () => [...document.querySelectorAll("button")];
const byText = (re) => buttons().find((b) => re.test((b.textContent || "").trim()));
const regenBtn = () => byText(/regenerate to address weaknesses|regenerating\.\.\.|regenerate again/i);
const click = (el) => act(async () => el.click());
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  }
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
  tailorCalls = [];
  realFetch = globalThis.fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

// A fetch whose /api/tailor answer the test controls; every other URL is a 404.
function stubFetch(answer) {
  globalThis.fetch = vi.fn((url, init) => {
    if (url !== "/api/tailor") return Promise.resolve(jsonResponse({}, false, 404));
    tailorCalls.push(init.body);
    return answer(init.body);
  });
}

describe("the regenerate flow, assembled through the real mount", () => {
  it("one click posts a gated Ideal request carrying the pin and the review, then rewrites the entry in one write and shows the report", async () => {
    stubFetch(async () => jsonResponse(regenerateBody()));
    await renderHarness();
    await click(regenBtn());
    await settle();

    expect(tailorCalls).toHaveLength(1);
    const body = tailorCalls[0];
    expect(body.get("tailorMode")).toBe("ideal"); // never the standard (ungated) mode
    expect(body.get("aggressiveness")).toBeNull();
    expect(body.get("engine")).toBe("gemini");
    expect(body.get("jobPosting")).toBe(POSTING);
    expect(JSON.parse(body.get("pinnedAnalysis")).postingAnalysis.requirements).toEqual([{ id: "q1", text: "GraphQL APIs" }]);
    expect(JSON.parse(body.get("beforeReview")).flags).toHaveLength(1);

    expect(latestMap["job-1"].result).toBe(AFTER);
    expect(latestMap["job-1"].resultLines).toEqual(AFTER.split("\n"));
    expect(latestMap["job-1"].ideal.regenerateReport.headline).toBe("Regenerated. 1 of 1 suggestion is no longer flagged.");
    expect(latestMap["job-2"].result).toBe("Other job text"); // never another job's entry
    expect(document.querySelector('[aria-label="What regenerating changed"]')).toBeTruthy();
    expect(regenBtn().textContent.trim()).toBe("Regenerate again");
    expect(byText(/undo regenerate/i)).toBeTruthy();
  });

  it("Undo restores the entry exactly, withdraws itself, moves focus to the Regenerate button and says so", async () => {
    stubFetch(async () => jsonResponse(regenerateBody()));
    await renderHarness();
    const before = latestMap["job-1"];
    await click(regenBtn());
    await settle();
    await click(byText(/undo regenerate/i));

    expect(latestMap["job-1"].result).toBe(before.result);
    expect(latestMap["job-1"].resultLines).toEqual(before.resultLines);
    expect(latestMap["job-1"].ideal).toBe(before.ideal);
    expect(byText(/undo regenerate/i)).toBeFalsy();
    expect(document.querySelector('[aria-label="What regenerating changed"]')).toBeNull();
    expect(document.body.textContent).toContain("Restored the version from before the regenerate.");
    expect(document.activeElement).toBe(regenBtn());
  });

  it("a refused or failed run changes nothing, says so persistently, and the button works again", async () => {
    stubFetch(async () => jsonResponse({ error: "refused" }, false, 422));
    await renderHarness();
    const before = latestMap["job-1"];
    await click(regenBtn());
    await settle();

    expect(latestMap["job-1"]).toBe(before); // byte-identical: no write happened
    expect(document.body.textContent).toContain("The regenerate could not finish, so your resume is unchanged. Try again.");
    expect(document.querySelector('[data-copy-status="alert"]').textContent).toContain("could not finish");
    expect(byText(/undo regenerate/i)).toBeFalsy();
    expect(regenBtn().getAttribute("aria-disabled")).toBeNull();
  });

  it("a response that is not a regenerate (no closure report) is never applied", async () => {
    const plain = regenerateBody();
    delete plain.closure;
    stubFetch(async () => jsonResponse(plain));
    await renderHarness();
    const before = latestMap["job-1"];
    await click(regenBtn());
    await settle();
    expect(latestMap["job-1"]).toBe(before);
  });

  it("two clicks in one tick start ONE run, and a remounted strip still reads running", async () => {
    let release;
    stubFetch(() => new Promise((resolve) => { release = () => resolve(jsonResponse(regenerateBody())); }));
    await renderHarness();
    const btn = regenBtn();
    await act(async () => {
      btn.click();
      btn.click();
    });
    expect(tailorCalls).toHaveLength(1);
    expect(regenBtn().textContent.trim()).toBe("Regenerating...");
    expect(regenBtn().getAttribute("aria-busy")).toBe("true");
    // A review of a text about to be replaced waits for the run.
    expect(byText(/^review resume$/i).getAttribute("aria-disabled")).toBe("true");

    // The strip is keyed by job and tab: a trip to the Cover tab and back remounts it.
    const tab = (re) => [...document.querySelectorAll('[role="tab"]')].find((t) => re.test(t.textContent || ""));
    await click(tab(/cover/i));
    await click(tab(/application-ready|resume/i));
    expect(regenBtn().textContent.trim()).toBe("Regenerating...");
    expect(regenBtn().getAttribute("aria-disabled")).toBe("true");
    await act(async () => regenBtn().click());
    expect(tailorCalls).toHaveLength(1);

    await act(async () => release());
    await settle();
    expect(latestMap["job-1"].result).toBe(AFTER);
  });

  it("a result that lands after the user moved to another job is written to its own job only", async () => {
    let release;
    stubFetch(() => new Promise((resolve) => { release = () => resolve(jsonResponse(regenerateBody())); }));
    await renderHarness({ jobId: "job-1" });
    await click(regenBtn());
    await renderHarness({ jobId: "job-2" });
    await act(async () => release());
    await settle();

    expect(latestMap["job-1"].result).toBe(AFTER);
    expect(latestMap["job-2"].result).toBe("Other job text");
    expect(latestMap["job-2"].ideal.regenerateReport).toBeUndefined();
  });

  it("a hand-edited text is stale until the strip reviews it again, then regenerates from THAT review", async () => {
    stubFetch(async () => jsonResponse(regenerateBody()));
    await renderHarness({ handEdited: true });
    expect(regenBtn().getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("Review again to update the list, then regenerate.");
    await click(regenBtn());
    expect(tailorCalls).toHaveLength(0); // a stale review is never regenerated against

    const requestsBefore = globalThis.fetch.mock.calls.length;
    await click(byText(/^review resume$/i));
    await settle();
    expect(globalThis.fetch.mock.calls.length).toBe(requestsBefore); // the review itself is offline
    expect(regenBtn().getAttribute("aria-disabled")).toBeNull();
    // K12: the caption warns that the edits are replaced and that Undo brings them back.
    expect(document.body.textContent).toContain("Regenerating replaces your edits");

    await click(regenBtn());
    await settle();
    expect(tailorCalls).toHaveLength(1);
    const sent = JSON.parse(tailorCalls[0].get("beforeReview"));
    expect(sent.flags.some((f) => f.category === "missing-keyword")).toBe(true); // the review of the EDITED text
    expect(latestMap["job-1"].result).toBe(AFTER);
    await click(byText(/undo regenerate/i));
    expect(latestMap["job-1"].result).toBe("Edited by hand\nSecond line"); // K12's promise: the edits come back
    expect(latestMap["job-1"].edited).toEqual({ resume: true, cover: false });
  });

  it("on an engine that cannot regenerate, nothing is posted, and Switch to Gemini returns focus to the button", async () => {
    stubFetch(async () => jsonResponse(regenerateBody()));
    await renderHarness({ engine: "embedded" });
    await click(regenBtn()); // aria-disabled: a no-op
    expect(tailorCalls).toHaveLength(0);
    await click(byText(/switch to gemini/i));
    expect(document.activeElement).toBe(regenBtn());
  });
});
