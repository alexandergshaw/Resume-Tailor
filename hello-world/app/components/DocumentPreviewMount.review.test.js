// @vitest-environment jsdom
//
// N103 Step 8 (4b) -- the MODAL wiring, driven through the REAL
// DocumentPreviewMount -> DocumentPreviewDialog (DocumentPreviewDialog.js is
// unchanged; the strip arrives through the existing resultBands slot). This is the
// production call site, so it catches the prop-threading trap (a green leaf test
// with an unwired page). It pins:
//   * AC-4: the review control is reachable for an ORDINARY (non-Ideal) job -- the
//     mount must now build resultBands for every scope, not only Ideal.
//   * One activation runs the review on the mechanical path and shows findings.
//   * AC-9 offline: zero fetch calls.
//   * The onAskAi descriptor now carries documentScope { jobId, scope } so the chat
//     selector can tell a resume pin from a hypothetical pin (AC-2).
//
// RED on HEAD: the mount builds resultBands only for Ideal jobs, so an ordinary job
// has no /review/i control; and onAskAi passes no documentScope.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ORDINARY_RESUME = "Led a team responsible for various things.\nImproved revenue by 300% across the org.";

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
    tailorEngine: "embedded",
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
let originalFetch;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  originalFetch = globalThis.fetch;
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

async function renderMount(props) {
  await act(async () => root.render(createElement(DocumentPreviewMount, props)));
}

const buttons = () => [...document.querySelectorAll("button")];
const buttonByText = (re) => buttons().find((b) => re.test((b.textContent || "").trim()));

describe("DocumentPreviewMount -- the modal review control is reachable on an ordinary job (AC-4)", () => {
  it("renders a /review/i control for a non-Ideal resume and one click shows findings from the real reviewer", async () => {
    await renderMount(baseProps({ "job-1": { result: ORDINARY_RESUME } }));
    const btn = buttonByText(/\breview/i);
    expect(btn, "an ordinary resume must expose a review control").toBeTruthy();
    await act(async () => {
      btn.click();
    });
    const quoted = [...document.querySelectorAll("[data-quoted]")].map((n) => n.textContent || "");
    expect(quoted.some((t) => t.includes("300%"))).toBe(true);
  });

  it("the review itself adds NO network calls (offline, no key -- AC-9)", async () => {
    // The mount is a heavy integration surface that may fetch on load; the offline
    // guarantee is about the REVIEW, so assert the click adds zero calls (a delta).
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    globalThis.fetch = fetchSpy;
    await renderMount(baseProps({ "job-1": { result: ORDINARY_RESUME } }));
    const before = fetchSpy.mock.calls.length;
    await act(async () => {
      buttonByText(/\breview/i).click();
    });
    expect(fetchSpy.mock.calls.length).toBe(before);
  });
});

describe("DocumentPreviewMount -- onAskAi carries the documentScope descriptor (AC-2 wiring)", () => {
  it("Ask AI on the resume tab passes documentScope { jobId, scope } to chat.askAiAbout", async () => {
    const props = baseProps({ "job-1": { result: ORDINARY_RESUME } });
    await renderMount(props);
    const ask = buttonByText(/^Ask AI$/);
    expect(ask, "the dialog's Ask AI control must be present").toBeTruthy();
    await act(async () => {
      ask.click();
    });
    expect(props.chat.askAiAbout).toHaveBeenCalledTimes(1);
    // RED on HEAD: today's onAskAi passes { label, content, sourceJobId } and no documentScope.
    expect(props.chat.askAiAbout.mock.calls[0][0].documentScope).toEqual({ jobId: "job-1", scope: "resume" });
  });
});
