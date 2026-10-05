// @vitest-environment jsdom
//
// N104 Waves D/E (4b) - the REACHABILITY of the Regenerate control, driven through
// the REAL DocumentPreviewMount -> DocumentPreviewDialog (the production call site).
// This is the test the whole seat exists for: a leaf that renders perfectly but is
// never wired ships "a panel with no opening button". RED on HEAD: the mount builds
// no Regenerate row at all.
//
// It pins the gating that must be decided by the production path, not the leaf:
//   * an Ideal resume on Gemini exposes an ENABLED "Regenerate to address
//     weaknesses" button (the control is reachable, one tab stop in reading order);
//   * the same job on an engine that cannot run Ideal exposes a "Switch to Gemini"
//     button instead, with Regenerate aria-disabled (engine reality, AC-5);
//   * a level 1-5 (non-Ideal) resume exposes NO Regenerate button (owner ruling b).
// The async guard, the atomic replace, Undo and the client submit are proven in
// their own faithful homes (regenerateJob, regenerateSubmit); this file proves the
// control is actually on screen and correctly gated.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const READY = "Application-ready line one\nApplication-ready line two";

// An Ideal entry whose review carries ONE resolvable wording gap (a posting keyword
// the draft is missing, on a requirement the resume is NOT unqualified for), so
// classifyWeaknesses puts it in `resolvable` and availability can reach `ready`.
function idealEntry(extra = {}) {
  return {
    result: READY,
    resultLines: READY.split("\n"),
    ideal: {
      hypothetical: { result: "Hypothetical best-case line", resultLines: ["Hypothetical best-case line"], isHypothetical: true },
      applicationReady: { result: READY, isHypothetical: false },
      postingAnalysis: { requirements: [{ id: "q1", text: "GraphQL APIs" }] },
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
        postingAnalysis: { requirements: [{ id: "q1", text: "GraphQL APIs" }] },
        lineCount: 2,
      },
      removed: [],
      leftOut: [],
      counts: { kept: 2, keptAccomplishments: 1, removed: 0, leftOut: 0 },
    },
    ...extra,
  };
}

function baseProps(tailoringMap, overrides = {}) {
  return {
    preview: {
      resumePreview: { open: true, title: "Staff Engineer", company: "Acme", tab: "resume", jobId: "job-1", posting: "", url: "", busy: {}, notice: {}, error: {} },
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
    },
    tailoringMap,
    research: { researchByJob: {}, companyResearchByJob: {}, openCompanyResearch: vi.fn() },
    chat: { askAiAbout: vi.fn() },
    tailorEngine: "gemini",
    previewReloadKey: 0,
    scrapePreviewPosting: vi.fn(),
    currentUser: { id: "user-1" },
    resumeFile: null,
    coverLetterFile: null,
    ...overrides,
  };
}

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  }
  try {
    localStorage.clear();
  } catch {
    /* jsdom */
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderMount(props) {
  await act(async () => root.render(createElement(DocumentPreviewMount, props)));
}

const buttons = () => [...document.querySelectorAll("button")];
const byText = (re) => buttons().find((b) => re.test((b.textContent || "").trim()));
const regenBtn = () => byText(/regenerate to address weaknesses|regenerating\.\.\.|regenerate again/i);

describe("DocumentPreviewMount - the Regenerate control is reachable for an Ideal resume (AC-6)", () => {
  it("renders an ENABLED 'Regenerate to address weaknesses' button on Gemini", async () => {
    await renderMount(baseProps({ "job-1": idealEntry() }, { tailorEngine: "gemini" }));
    const btn = regenBtn();
    expect(btn, "an Ideal resume on Gemini must expose the Regenerate control").toBeTruthy();
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    expect(btn.getAttribute("disabled")).toBeNull();
  });
});

describe("DocumentPreviewMount - engine reality is decided on the production path (AC-5)", () => {
  it("on embedded, the control is engine-cannot: a Switch to Gemini button, Regenerate aria-disabled", async () => {
    await renderMount(baseProps({ "job-1": idealEntry() }, { tailorEngine: "embedded" }));
    expect(byText(/switch to gemini/i), "a modal dialog needs an in-modal engine switch").toBeTruthy();
    const btn = regenBtn();
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("DocumentPreviewMount - a level 1-5 job never offers a regenerate (owner ruling b)", () => {
  it("a non-Ideal resume exposes NO 'Regenerate to address weaknesses' button", async () => {
    // Negative control: vacuously green on HEAD (nothing renders it anywhere); it
    // gains teeth against the reference, where the Ideal case DOES render it.
    await renderMount(baseProps({ "job-1": { result: "Plain tailored resume line." } }, { tailorEngine: "gemini" }));
    expect(regenBtn()).toBeFalsy();
  });
});
