// @vitest-environment jsdom
//
// Wave 5C pulled the 99-line `<DocumentPreviewDialog .../>` mount block
// (formerly app/page.js:3172-3270) out into DocumentPreviewMount.js. The
// "page.js renders the extracted DocumentPreviewMount" suite below is a
// source-text adoption check: it reads source text rather than rendering,
// because the property being pinned there is "does page.js actually use the
// extracted component" (and "did the file actually shrink"), not any
// rendered behaviour. A page.js that still carries the inline
// `<DocumentPreviewDialog` JSX, with DocumentPreviewMount.js sitting fully
// built beside it and never mounted, would pass every one of those
// assertions while leaving the god-component exactly as large as before --
// and a `DocumentPreviewMount` that renders nothing at all would pass them
// too. The "DocumentPreviewMount actually renders" suite further down closes
// that gap by mounting the real component and asserting the dialog it wraps
// appears in the DOM, using the JobDescriptionTab.test.js pattern
// (createRoot + act, jsdom via this per-file environment override).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const PAGE = "../page.js";

describe("page.js renders the extracted DocumentPreviewMount", () => {
  it("imports DocumentPreviewMount from ./components/DocumentPreviewMount", () => {
    const src = read(PAGE);
    expect(src).toMatch(/from ["']\.\/components\/DocumentPreviewMount["']/);
  });

  it("renders <DocumentPreviewMount", () => {
    const src = read(PAGE);
    expect(src).toMatch(/<DocumentPreviewMount/);
  });

  it("no longer contains the inline DocumentPreviewDialog mount", () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/<DocumentPreviewDialog/);
    expect(src).not.toMatch(/from ["']\.\/components\/DocumentPreviewDialog["']/);
  });

  it("actually shrank page.js rather than just adding a file beside it", () => {
    // It was 3309 lines before the split (split("\n").length, matching the
    // ratchet in lib/drive/lineCeiling.test.js -- NOT wc -l, which counts
    // one fewer for a file with a trailing newline). A token extraction that
    // moved a handful of lines out would satisfy "under 3309" only by luck;
    // this pins the real shrink the 99-line mount block's removal produces.
    expect(read(PAGE).split("\n").length).toBeLessThan(3250);
  });
});

// Minimal-but-real props: `tailoringMap` has no entry for the job, so every
// `tailoringMap[jobId]?.foo` in DocumentPreviewMount resolves through its
// optional chain to undefined/false, which is exactly the shape the real
// mount has for a job that hasn't been tailored yet -- no need to fake tailor
// output to prove the component renders and threads its props.
function baseProps(overrides = {}) {
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
    tailoringMap: {},
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
    ...overrides,
  };
}

describe("DocumentPreviewMount actually renders (MAJOR-3)", () => {
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
  });

  it("renders the DocumentPreviewDialog it wraps, with the props it was given reaching it", async () => {
    const props = baseProps();
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });

    // MUI's Dialog portals its content to document.body, not into the local
    // container -- confirmed here as a tripwire so a future edit of this test
    // doesn't silently start asserting against an always-empty `container`
    // and pass for the wrong reason.
    expect(container.textContent).toBe("");
    expect(document.body.textContent.length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Tailored documents");
    // `heading = [company, jobTitle].filter(Boolean).join(" · ")` in
    // DocumentPreviewDialog -- proves `jobTitle`/`company` were threaded
    // through from `preview.resumePreview`, not just that *some* dialog
    // rendered.
    expect(document.body.textContent).toContain("Acme · Staff Engineer");

    // Prove a callback prop actually reaches the dialog and fires: the
    // unconditional "Close" button in DialogActions calls `onClose`, which
    // DocumentPreviewMount wires to `preview.closeResumePreview`.
    const closeButton = [...document.body.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Close",
    );
    expect(closeButton).toBeTruthy();
    await act(async () => {
      closeButton.click();
    });
    expect(props.preview.closeResumePreview).toHaveBeenCalledTimes(1);
  });

  it("does not render the dialog when preview.resumePreview.open is false", async () => {
    const props = baseProps({
      preview: { ...baseProps().preview, resumePreview: { ...baseProps().preview.resumePreview, open: false } },
    });
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    expect(document.body.textContent).not.toContain("Tailored documents");
  });
});
