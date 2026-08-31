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

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { buildMinimalistDocx } from "@/lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Same trap DocumentPreviewDialog.drive.test.js's header documents: jsdom
// (pinned ^29.1.1 here) implements NO `HTMLElement.prototype.innerText` at
// all. Only the join test further down enters edit mode and types, so this
// is scoped to this file exactly like that one -- never vitest.setup.js.
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
    vi.unstubAllGlobals();
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

// Wave 6A: `useDriveDocuments` mounts INSIDE this component (ARCH.md §4.3/§5)
// and its return value is handed to the dialog as one `drive` prop.
// `DriveResultRegion` requires a complete `announcement` object and THROWS
// on anything else (see that file's own header) -- so the real, deepest
// regression this integration point can suffer is the hook's return value
// reaching the dialog in a shape that component rejects. Fetch is stubbed
// (the connect.test.js pattern) purely so the hook's own network effects
// don't hit a real endpoint under test; nothing about the save/download
// flow itself is exercised here -- that belongs to
// DocumentPreviewDialog.drive.test.js, which drives the wrapper directly.
describe("DocumentPreviewMount mounts useDriveDocuments and wires it through (Wave 6A)", () => {
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

  it("renders DriveResultRegion's two live regions -- proving the hook's return value satisfies the region's required `announcement` shape end to end", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => null })),
    );
    const props = baseProps();
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    expect(document.body.querySelector('[role="status"]')).toBeTruthy();
    expect(document.body.querySelector('[role="alert"]')).toBeTruthy();
  });

  it("does not crash when the status check fails (statusCheckFailed) -- the hook still returns a complete announcement", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const props = baseProps();
    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    // Flush the hook's async status-check IIFE.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("Tailored documents");
    expect(document.body.querySelector('[role="status"]')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// WAVE6-VERIFY.md MAJOR-1 -- the seam this whole wave exists for, pinned at
// its JOIN rather than at either half separately. DocumentPreviewDialog.
// drive.test.js already pins "typed text reaches saveToDrive's activeText"
// with a MOCKED saveToDrive; useDriveDocuments.connect.test.js already pins
// the hook down to the bytes with a HAND-BUILT drive prop standing in for
// the dialog. Neither test can catch DocumentPreviewMount.js forgetting to
// pass `drive={drive}` to the dialog it renders -- the independent verifier
// proved this directly: removing that one prop left the ENTIRE shipped
// suite green, because DocumentPreviewDialog.js's old `drive = DEFAULT_DRIVE`
// default silently substituted `status: "unconfigured"` (DriveActions then
// renders nothing, so there was no button to click and nothing to notice).
//
// This test mounts the REAL DocumentPreviewMount -- real useDriveDocuments,
// real DocumentPreviewDialog, real handleSaveToDrive wrapper -- stubs only
// `fetch`, types into the editor, and clicks Save WITHOUT ever blurring.
// The typed text is pulled back out of the captured multipart request's
// `file` part with JSZip, so this proves the whole chain
// `editorRef.innerText -> activePayload().text -> saveToDrive -> performSave
// -> attemptOneScope -> buildPreviewBlob -> previewBlobArgs ->
// resolveDocumentBlob -> buildDocxFromUploadedTemplate -> POST body` is
// actually wired end to end, not just each half in isolation.
//
// Confirmed during development (not shipped as a mutation -- this file's
// job is the permanent pin, not the throwaway probe): removing
// `drive={drive}` from DocumentPreviewMount.js now reds this test twice
// over -- DocumentPreviewDialog.js no longer defaults a missing `drive` at
// all (it throws immediately, see that file's own invariant comment), and
// even before that fix existed, this test's own JSZip/document.xml
// assertions below would have caught DriveActions rendering nothing.
describe("DocumentPreviewMount join: the real Save-to-Drive wrapper reaches real POSTed bytes (MAJOR-1)", () => {
  let container;
  let root;

  // Same router shape as useDriveDocuments.connect.test.js's makeFetch/
  // defaultSaveHandler -- connected+configured so the warm-save path runs
  // with no OAuth popup involved, keeping this test focused on the byte
  // wiring rather than the consent flow (that's AC-A4's own tests, in
  // DocumentPreviewDialog.drive.test.js).
  function makeFetch(state) {
    return vi.fn(async (url, init) => {
      state.calls.push({ url, init });
      if (url.startsWith("/api/drive/status")) {
        return { ok: true, status: 200, json: async () => ({ connected: true, configured: true, email: "u@example.com" }) };
      }
      if (url.startsWith("/api/drive/documents")) {
        return { ok: true, status: 200, json: async () => ({ documents: {} }) };
      }
      if (url.startsWith("/api/drive/save")) {
        const meta = JSON.parse(init.body.get("meta"));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            scope: meta.scope,
            fileId: "file-resume-1",
            name: meta.name,
            webViewLink: "https://docs.google.com/document/d/file-resume-1/edit",
            version: "v1",
          }),
        };
      }
      throw new Error(`Unhandled fetch in join test: ${url}`);
    });
  }

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  // JSZip's own async pipeline (buildDocxFromUploadedTemplate -> generateAsync)
  // schedules its chunked work across SEVERAL real macrotask ticks, not just
  // microtasks -- a single flush() (proven sufficient for the pure status/
  // documents/hash effects above) left the save still in flight, measured
  // directly against this test. Polling a real condition rather than a fixed
  // flush() count keeps this robust to that implementation detail instead of
  // pinning "exactly how many ticks JSZip happens to need today".
  async function flushUntil(predicate, maxTicks = 40) {
    for (let i = 0; i < maxTicks; i += 1) {
      if (predicate()) return;
      await flush();
    }
    if (!predicate()) throw new Error(`flushUntil: condition never became true within ${maxTicks} ticks`);
  }

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

  it("typed text, saved without blurring, reaches the actual .docx bytes POSTed to /api/drive/save", async () => {
    const STORED_TEXT = "STORED PRE-EDIT RESUME TEXT";
    const templateBlob = await buildMinimalistDocx([], STORED_TEXT);
    const templateBuf = await templateBlob.arrayBuffer();
    let binary = "";
    new Uint8Array(templateBuf).forEach((b) => { binary += String.fromCharCode(b); });
    const templateB64 = btoa(binary);

    const entry = {
      result: STORED_TEXT,
      resultLines: [STORED_TEXT],
      // Supplied directly so ensureLoaded's view-mode render never calls
      // loadPreviewModel -- irrelevant to this test, which only exercises
      // edit mode.
      resumePreviewHtml: `<p>${STORED_TEXT}</p>`,
      docxB64: templateB64,
      docxPath: "",
      edited: { resume: false, cover: false },
      resumeFileName: "",
      coverLetterFileName: "",
    };

    const state = { calls: [] };
    vi.stubGlobal("fetch", makeFetch(state));

    const props = baseProps({
      preview: {
        ...baseProps().preview,
        previewScopeAvailable: vi.fn((_e, scope) => scope === "resume"),
      },
      tailoringMap: { "job-1": entry },
    });

    await act(async () => {
      root.render(createElement(DocumentPreviewMount, props));
    });
    await flush(); // settle the hook's status/documents/hash effects

    const editButton = [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === "Edit");
    expect(editButton).toBeTruthy();
    await act(async () => {
      editButton.click();
    });

    const editor = document.body.querySelector('[contenteditable="true"]');
    expect(editor).toBeTruthy();
    editor.innerHTML = "<p>FRESHLY TYPED ALPHA</p><p>FRESHLY TYPED BETA</p>";
    await act(async () => {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = document.getElementById("drive-save-control-label");
    expect(saveButton).toBeTruthy();
    // Click WITHOUT ever blurring the editor -- the 600ms auto-save
    // debounce has not fired, and editorRef.current still holds the fresh
    // DOM the browser never got a blur event for.
    await act(async () => {
      saveButton.click();
    });
    await flushUntil(() => state.calls.some((c) => c.url.startsWith("/api/drive/save")));

    const saveCalls = state.calls.filter((c) => c.url.startsWith("/api/drive/save"));
    expect(saveCalls).toHaveLength(1);

    const uploadedBlob = saveCalls[0].init.body.get("file");
    const zip = await JSZip.loadAsync(await uploadedBlob.arrayBuffer());
    const xml = await zip.file("word/document.xml").async("string");

    expect(xml).toContain("FRESHLY TYPED ALPHA");
    expect(xml).toContain("FRESHLY TYPED BETA");
    expect(xml).not.toContain(STORED_TEXT);

    const meta = JSON.parse(saveCalls[0].init.body.get("meta"));
    expect(meta.scope).toBe("resume");
    expect(typeof meta.contentHash).toBe("string");
    expect(meta.contentHash.length).toBeGreaterThan(0);
  });
});
