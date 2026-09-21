// @vitest-environment jsdom
//
// N40 (design.r2.md §5B/§5C) -- the soft-line-break rebuild defect, driven
// from the two components that call resolveDocumentBlob themselves and from
// the chip menu that reaches docx.js's own two call sites:
//
//   * STATUS BAR CHIP DRAG (StatusBar.js onDragStart -> resolveDocumentBlob):
//     the real StatusBar is mounted and a `dragstart` is dispatched on the
//     chip's document control, the way a user drags the tailored résumé into
//     an ATS upload field. The file lands in the event's dataTransfer.
//   * STATUS BAR "Download résumé + cover letter" (menu -> the REAL
//     createDocumentDownloaders().downloadResumeForChipJob -> downloadDocxFiles
//     -> docx.js's RÉSUMÉ and COVER call sites): the "More actions" button is
//     clicked, then the menu item, for a restored chip (résumé bytes only in
//     storage, so the résumé takes branch 4) with an edited cover letter
//     (branch 3, all four embedded variants).
//   * TRACKING ROW DRAG (TrackingTab.js onDragStart -> resolveDocumentBlob):
//     the real TrackingTab is mounted at desktop width and a `dragstart` is
//     dispatched on the row's download control. A saved résumé with no stored
//     .docx rebuilds onto the uploaded résumé (branch 5).
//   * TRACKING ROW CLICK (TrackingTab.js onClick -> the real downloadDocxFiles
//     -> docx.js's résumé call site, branch 5).
//
// None of these calls a handler or resolveDocumentBlob directly: every blob
// here came out of a real control's event.
//
// THE RÉSUMÉ FIXTURE is candidate-authored: a Word résumé whose contact block
// ("Seattle, WA" / email | phone) and role heading (title / dates) are each ONE
// paragraph split with Shift+Enter, the most common place soft breaks live in
// real résumés. The engine's bundled résumé has none (design.r2.md §5B measured
// 0 of 37 paragraphs), so it cannot exercise these call sites; it appears in
// rebuildBreaks.classGuard.test.js as the no-regression fixture instead.
//
// MEASUREMENT: test/helpers/rebuildBreaks.js -- paragraph count, and per
// paragraph the run text with every w:br/w:cr as a token plus w:pPr. An
// unchanged-lines rebuild must alter 0 paragraphs; an edit, only its own.
//
// jsdom limits, stated rather than faked: a real drag gesture (pointer down,
// movement threshold, drop target) is not simulated; the dispatched
// `dragstart` is the event the browser fires once one begins, carrying a
// minimal DataTransfer stand-in (jsdom has no DataTransfer).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import {
  EMBEDDED_VARIANTS,
  COVER_SHAPES,
  RESUME_SHAPES,
  embeddedCover,
  breakResumeDocx,
  asDocxFile,
  paragraphRecords,
  rebuildProblems,
  asEditorText,
  DOCX_MIME,
} from "../../test/helpers/rebuildBreaks.js";

const h = vi.hoisted(() => ({ downloads: [], storage: {} }));

vi.mock("../../lib/document/download.js", () => ({
  triggerBlobDownload: (blob, name) => {
    h.downloads.push({ blob, name });
  },
}));

vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    storage: {
      from: () => ({
        download: async (path) =>
          h.storage[path] ? { data: h.storage[path], error: null } : { data: null, error: { message: `not found: ${path}` } },
      }),
    },
  }),
}));

import StatusBar from "./StatusBar.js";
import TrackingTab from "./TrackingTab.js";
import { createDocumentDownloaders, isDocxResume } from "../../lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RES = {};
const COVER = {};
beforeAll(async () => {
  for (const breakKind of ["br", "cr"]) {
    const r = await breakResumeDocx({ breakKind });
    RES[breakKind] = { ...r, before: await paragraphRecords(r.b64) };
  }
  for (const v of EMBEDDED_VARIANTS) {
    const c = await embeddedCover(v);
    COVER[v] = { ...c, before: await paragraphRecords(c.docxB64) };
  }
}, 60000);

let container;
let root;
beforeEach(() => {
  h.downloads.length = 0;
  for (const k of Object.keys(h.storage)) delete h.storage[k];
  // Desktop width: StatusBar's horizontal dock and TrackingTab's table rows.
  window.matchMedia = vi.fn((query) => ({
    matches: false,
    media: String(query),
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Wait (bounded) for an async handler's observable; the assertion after still fails if it never lands. */
async function flushUntil(predicate, max = 40) {
  for (let i = 0; i < max && !predicate(); i += 1) await flush();
}

/** Dispatch the browser's `dragstart` on `node`; returns the files the handler hands to dataTransfer. */
async function dragStart(node) {
  const files = [];
  const dataTransfer = {
    effectAllowed: "",
    clearData() {},
    setData() {},
    items: { add: (f) => files.push(f) },
  };
  const ev = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dataTransfer });
  await act(async () => {
    node.dispatchEvent(ev);
  });
  await flushUntil(() => files.length > 0);
  return files;
}

async function click(node) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// ---------------------------------------------------------------------------
// StatusBar
// ---------------------------------------------------------------------------

const JOB = { id: "manual-n40", title: "Senior Software Engineer", company: "Acme Corp", url: "", description: "x" };

function statusBarProps({ tailoringMap, resumeFile, downloadResumeForChipJob }) {
  return {
    trackedJobs: [JOB],
    setTrackedJobs: vi.fn(),
    tailoringMap,
    jobResults: [],
    resumeFile,
    toolbarScrollRef: { current: null },
    toolbarCanScrollLeft: false,
    toolbarCanScrollRight: false,
    handleToolbarWheel: vi.fn(),
    handleToolbarScroll: vi.fn(),
    scrollToolbar: vi.fn(),
    isDocxResume,
    getDownloadFileNameForTitle: () => "Acme Corp - Senior Software Engineer - Resume.docx",
    askAiAbout: vi.fn(),
    buildJobContextString: () => "",
    setMainTab: vi.fn(),
    setActiveSection: vi.fn(),
    downloadResumeForChipJob: downloadResumeForChipJob || vi.fn(async () => null),
    handleToggleApplied: vi.fn(),
    handleIgnoreJob: vi.fn(),
    handleUntrackJob: vi.fn(),
    openResumePreview: vi.fn(),
    openCompanyResearch: vi.fn(),
    onRegenerate: vi.fn(),
    appliedByExternalId: null,
  };
}

function chipDocumentControl() {
  const node = container.querySelector('[role="button"][title*="drag to upload"]');
  expect(node, "the chip's draggable document control did not render").toBeTruthy();
  expect(node.getAttribute("draggable")).toBe("true");
  return node;
}

describe("status bar chip drag keeps the résumé's soft line breaks", () => {
  for (const breakKind of ["br", "cr"]) {
    for (const shape of Object.keys(RESUME_SHAPES)) {
      it(`${breakKind}: ${shape}`, async () => {
        const res = RES[breakKind];
        const { lines, changed } = RESUME_SHAPES[shape](res);
        const tailoringMap = {
          [JOB.id]: {
            status: "done",
            result: asEditorText(lines),
            resultLines: lines,
            docxB64: res.b64, // the in-session engine document -> branch 3
            docxPath: "",
            edited: { resume: true, cover: false },
          },
        };
        const uploaded = asDocxFile(res.buf, "uploaded-resume.docx");
        await act(async () => {
          root.render(createElement(StatusBar, statusBarProps({ tailoringMap, resumeFile: uploaded })));
        });
        const files = await dragStart(chipDocumentControl());
        expect(files, "the drag handed no file to dataTransfer").toHaveLength(1);
        expect(files[0].type).toBe(DOCX_MIME);
        expect(rebuildProblems(res.before, await paragraphRecords(files[0]), changed)).toEqual([]);
      });
    }
  }
});

describe("status bar 'Download résumé + cover letter' keeps both documents' soft line breaks", () => {
  for (const variant of EMBEDDED_VARIANTS) {
    for (const shape of ["control", "bodyEdit"]) {
      it(`${variant}: ${shape}`, async () => {
        const res = RES.br;
        const cover = COVER[variant];
        const r = RESUME_SHAPES[shape](res);
        const c = COVER_SHAPES[shape](cover);
        // A chip restored after a reload: the résumé's bytes live only in
        // storage (branch 4); the cover letter's engine bytes are in session
        // and it has been hand-edited (branch 3).
        h.storage["user-1/generated/n40.docx"] = new Blob([res.buf], { type: DOCX_MIME });
        const tailoringMap = {
          [JOB.id]: {
            status: "done",
            result: asEditorText(r.lines),
            resultLines: r.lines,
            docxB64: "",
            docxPath: "user-1/generated/n40.docx",
            coverLetterResultLines: c.lines,
            coverLetterDocxB64: cover.docxB64,
            edited: { resume: true, cover: true },
          },
        };
        // downloadResumeForChipJob refuses an edited chip with no .docx
        // résumé uploaded, so one is present -- the <w:cr/> twin of the stored
        // document, so a silent fall-through to the uploaded template (branch
        // 5) would show up as [cr] tokens instead of [br].
        const uploaded = asDocxFile(RES.cr.buf, "uploaded-resume.docx");
        const { downloadResumeForChipJob } = createDocumentDownloaders({
          resumeFile: uploaded,
          coverLetterFile: null,
          tailoringMap,
          applicationData: [],
        });
        await act(async () => {
          root.render(createElement(StatusBar, statusBarProps({ tailoringMap, resumeFile: uploaded, downloadResumeForChipJob })));
        });
        await click(container.querySelector('button[aria-label="More actions"]'));
        const item = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((n) =>
          /Download résumé \+ cover letter/.test(n.textContent || ""),
        );
        expect(item, "the menu has no Download item").toBeTruthy();
        await click(item);
        await flushUntil(() => h.downloads.length >= 2);

        const resume = h.downloads.find((d) => /- Resume\.docx$/.test(d.name));
        const cl = h.downloads.find((d) => /- CL\.docx$/.test(d.name));
        expect(resume, "no résumé was downloaded").toBeTruthy();
        expect(cl, "no cover letter was downloaded").toBeTruthy();
        expect(rebuildProblems(res.before, await paragraphRecords(resume.blob), r.changed)).toEqual([]);
        expect(rebuildProblems(cover.before, await paragraphRecords(cl.blob), c.changed)).toEqual([]);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// TrackingTab
// ---------------------------------------------------------------------------

function trackingProps({ app, resumeFile, downloadDocxFiles }) {
  const noop = () => {};
  return {
    currentUser: { id: "u1" },
    applicationLoading: false,
    applicationError: "",
    applicationData: [app],
    visibleApplicationData: [app],
    applicationStages: {},
    interviewSearch: "",
    setInterviewSearch: noop,
    interviewSort: { field: null, dir: "asc" },
    companyColWidth: 140,
    roleColWidth: 180,
    resumeFile,
    openAddApplicationDialog: noop,
    toggleInterviewSort: noop,
    setInterviewSort: noop,
    sortLabelSx: () => ({}),
    startColResize: noop,
    askAiAbout: noop,
    buildApplicationContextString: () => "",
    buildStageContextString: () => "",
    openCommsInAppDialog: noop,
    openAddCommunicationDialog: noop,
    openEditApplicationDialog: noop,
    handleDeleteApplication: noop,
    setAppDialog: noop,
    setStageError: noop,
    setStageDialog: noop,
    isDocxResume,
    downloadDocxFiles,
    getDownloadFileNameForTitle: () => "Acme Corp - Senior Software Engineer - Resume.docx",
    stageDialog: { open: false },
    stageError: "",
    stageSaving: false,
    handleSaveStage: noop,
    communicationsDialog: { open: false, items: [] },
    setCommunicationsDialog: noop,
    addCommunicationDialog: { open: false, body: "", files: [], kind: "email", subject: "", direction: "outbound", occurred_at: "" },
    setAddCommunicationDialog: noop,
    communicationError: "",
    setCommunicationError: noop,
    communicationSaving: false,
    handleSaveCommunication: noop,
    editAppDialog: { open: false },
    setEditAppDialog: noop,
    editAppSaving: false,
    editAppError: "",
    editAppResumeFile: null,
    setEditAppResumeFile: noop,
    handleSaveEditApplication: noop,
    addAppDialog: { open: false },
    setAddAppDialog: noop,
    addAppSaving: false,
    addAppError: "",
    addAppResumeFile: null,
    setAddAppResumeFile: noop,
    handleSaveAddApplication: noop,
    appDialog: { open: false, rowIndex: -1, kind: "" },
    loadCommunicationsForApp: noop,
    highlightedAppId: null,
    emailClassificationsByAppId: {},
    digestsById: {},
    researchingIds: new Set(),
    researchOne: noop,
  };
}

function savedApplication(lines) {
  return {
    id: "app-n40",
    status: "applied",
    applied_at: "2026-09-01T00:00:00.000Z",
    application_url: null,
    positions: { id: "pos-n40", company: "Acme Corp", title: "Senior Software Engineer", url: null, description: "x" },
    // No stored .docx: the row rebuilds onto the uploaded résumé (branch 5).
    generated_resumes: { content: asEditorText(lines), content_lines: lines, docx_path: "" },
  };
}

async function mountTrackingRow(res, lines) {
  const uploaded = asDocxFile(res.buf, "uploaded-resume.docx");
  const { downloadDocxFiles } = createDocumentDownloaders({
    resumeFile: uploaded,
    coverLetterFile: null,
    tailoringMap: {},
    applicationData: [],
  });
  await act(async () => {
    root.render(createElement(TrackingTab, trackingProps({ app: savedApplication(lines), resumeFile: uploaded, downloadDocxFiles })));
  });
  const control = container.querySelector('button[aria-label="Download or drag to upload tailored .docx"]');
  expect(control, "the row's download control did not render").toBeTruthy();
  return control;
}

describe("tracking row drag and download keep the résumé's soft line breaks", () => {
  for (const breakKind of ["br", "cr"]) {
    for (const shape of Object.keys(RESUME_SHAPES)) {
      it(`drag, ${breakKind}: ${shape}`, async () => {
        const res = RES[breakKind];
        const { lines, changed } = RESUME_SHAPES[shape](res);
        const files = await dragStart(await mountTrackingRow(res, lines));
        expect(files, "the drag handed no file to dataTransfer").toHaveLength(1);
        expect(rebuildProblems(res.before, await paragraphRecords(files[0]), changed)).toEqual([]);
      });
    }

    it(`click (download), ${breakKind}: bodyEdit`, async () => {
      const res = RES[breakKind];
      const { lines, changed } = RESUME_SHAPES.bodyEdit(res);
      await click(await mountTrackingRow(res, lines));
      await flushUntil(() => h.downloads.length >= 1);
      expect(h.downloads, "the click downloaded nothing").toHaveLength(1);
      expect(rebuildProblems(res.before, await paragraphRecords(h.downloads[0].blob), changed)).toEqual([]);
    });
  }
});
