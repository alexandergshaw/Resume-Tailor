// @vitest-environment jsdom
//
// N105 Step 5 (AC-17, D-10) -- the PRODUCTION call site: DocumentPreviewMount
// computes `visibleScopes` from the job's tailoring entry and hands it to the
// dialog. Mutants this file reds: drop the `visibleScopes` prop from the mount
// (an Ideal entry then shows 3 tabs, not 4); pass raw SCOPES instead (an
// ordinary entry then shows a phantom hypothetical tab).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function baseProps(tailoringMap) {
  return {
    preview: {
      resumePreview: {
        open: true,
        title: "Staff Engineer",
        company: "Acme",
        tab: "resume",
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
    },
    tailoringMap,
    research: {
      researchByJob: {},
      companyResearchByJob: {},
      openCompanyResearch: vi.fn(),
    },
    chat: { askAiAbout: vi.fn() },
    tailorEngine: "embedded",
    previewReloadKey: 0,
    scrapePreviewPosting: vi.fn(),
    currentUser: { id: "user-1" },
    resumeFile: null,
    coverLetterFile: null,
  };
}

let container;
let root;

beforeEach(() => {
  vi.clearAllMocks();
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

async function renderMount(tailoringMap) {
  await act(async () => {
    root.render(createElement(DocumentPreviewMount, baseProps(tailoringMap)));
  });
}

const tabLabels = () =>
  [...document.querySelectorAll('[role="tab"]')].map((t) => (t.textContent || "").trim());

describe("DocumentPreviewMount supplies visibleScopes to the dialog (N105 D-10)", () => {
  it("an ordinary (level 1-5) entry renders the three legacy tabs and NO hypothetical tab", async () => {
    await renderMount({ "job-1": { result: "Resume text", coverLetterResultLines: ["Dear"] } });
    const labels = tabLabels();
    expect(labels).toHaveLength(3);
    expect(labels.filter((l) => /hypothetical/i.test(l))).toEqual([]);
  });

  it("no tailoring entry at all renders the three legacy tabs and NO hypothetical tab", async () => {
    await renderMount({});
    const labels = tabLabels();
    expect(labels).toHaveLength(3);
    expect(labels.filter((l) => /hypothetical/i.test(l))).toEqual([]);
  });

  it("an Ideal entry (application-ready + hypothetical result) adds the hypothetical tab LAST", async () => {
    await renderMount({
      "job-1": { result: "Application-ready text", ideal: { hypothetical: { result: "Hypothetical text" } } },
    });
    const labels = tabLabels();
    expect(labels).toHaveLength(4);
    expect(labels[3]).toMatch(/hypothetical/i);
    expect(labels.slice(0, 3).filter((l) => /hypothetical/i.test(l))).toEqual([]);
  });
});
