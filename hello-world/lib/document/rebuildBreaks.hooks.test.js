// @vitest-environment jsdom
//
// N40 (design.r2.md §5B/§5C) -- LIVE DEFECT: rebuilding an edited embedded
// cover letter drops its soft line breaks. `Sincerely,<w:br/>Alex Shaw` comes
// back as `Since<w:br/>rely,` plus a stray paragraph `Alex <w:br/>Shaw`, in
// every download and the Drive save after any hand edit.
//
// THIS FILE drives two of the five resolveDocumentBlob call sites through the
// hooks the preview dialog's own buttons call, never by calling
// resolveDocumentBlob or buildDocxFromUploadedTemplate directly:
//
//   * PREVIEW DOWNLOAD -- useDocumentPreview's saveDocumentPreview (the
//     editor's autosave) then downloadDocumentPreview (the Download button),
//     with the REAL createDocumentDownloaders().downloadDocxFiles, which
//     reaches lib/document/docx.js's COVER call site of resolveDocumentBlob.
//     The same call site also serves the chip download; that route is driven
//     from the chip itself in app/components/rebuildBreaks.components.test.js.
//   * DRIVE SAVE -- useDriveDocuments' saveToDrive, which reaches
//     lib/document/previewBlob.js's buildPreviewBlob call site (the one the
//     preview render shares). The blob is read back out of the multipart body
//     the hook posts to /api/drive/save.
//
// Reachability of the dialog's buttons themselves is NOT re-proven here: the
// Download button and the Drive control are covered by their own wiring suites
// (useDocumentPreview.download.test.js, DocumentPreviewDialog.drive.test.js).
// What is new here is what the bytes contain.
//
// THE MEASUREMENT is per paragraph (test/helpers/rebuildBreaks.js): the
// paragraph count, and for every paragraph its run text with each `w:br`/
// `w:cr` as a token, and its `w:pPr`. Never mammoth raw text, which cannot see
// this bug. Every rebuilt letter is compared with the engine's own .docx:
// an unchanged-lines rebuild must alter 0 paragraphs, an edited one exactly
// the edited paragraph.
//
// Only Supabase, the two Supabase-backed sibling modules, the download
// trigger and `fetch` are stubbed. docx.js, alignLines.js, previewBlob.js and
// the embedded engine are all real.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import {
  EMBEDDED_VARIANTS,
  COVER_SHAPES,
  embeddedCover,
  paragraphRecords,
  rebuildProblems,
  asEditorText,
} from "../../test/helpers/rebuildBreaks.js";

const h = vi.hoisted(() => ({ downloads: [] }));

vi.mock("./download.js", () => ({
  triggerBlobDownload: (blob, name) => {
    h.downloads.push({ blob, name });
  },
}));

vi.mock("../supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pos-1" }, error: null }) }) }),
    }),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "no storage here" } }) }) },
  }),
}));

vi.mock("../supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => true),
}));

vi.mock("../supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "../../app/hooks/useDocumentPreview.js";
import { useDriveDocuments } from "../../app/hooks/useDriveDocuments.js";
import { createDocumentDownloaders } from "./docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-n40";

// Generated once: the engine is deterministic, and a fixture per test would
// only re-derive identical bytes.
const FIX = {};
beforeAll(async () => {
  for (const v of EMBEDDED_VARIANTS) {
    for (const breakKind of ["br", "cr"]) {
      const f = await embeddedCover(v, { breakKind });
      FIX[`${v}/${breakKind}`] = { ...f, before: await paragraphRecords(f.docxB64) };
    }
  }
}, 60000);

let container;
let root;
beforeEach(() => {
  h.downloads.length = 0;
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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function coverEntry(fix, overrides = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: fix.lines.slice(),
    coverLetterDocxB64: fix.docxB64,
    edited: { resume: false, cover: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Preview download
// ---------------------------------------------------------------------------

let preview = null;
function PreviewProbe({ initialMap, downloadDocxFiles }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((cur) => ({
        ...cur,
        [jobId]: typeof updater === "function" ? updater(cur[jobId] || {}) : { ...(cur[jobId] || {}), ...updater },
      })),
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles,
    startBackgroundResearch: () => {},
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  return null;
}

/** Type into the cover editor (autosave), then press Download. Returns the downloaded blob. */
async function editAndDownloadCover(fix, lines) {
  const { downloadDocxFiles } = createDocumentDownloaders({
    resumeFile: null,
    coverLetterFile: null,
    tailoringMap: {},
    applicationData: [],
  });
  await act(async () => {
    root.render(createElement(PreviewProbe, { initialMap: { [JOB_ID]: coverEntry(fix) }, downloadDocxFiles }));
  });
  await act(async () => {
    preview.openResumePreview({ id: JOB_ID, title: "Senior Software Engineer", company: "Acme Corp" });
  });
  await flush();
  const text = asEditorText(lines);
  await act(async () => {
    preview.saveDocumentPreview("cover", text);
  });
  await act(async () => {
    await preview.downloadDocumentPreview("cover", text);
  });
  expect(preview.resumePreview.error.cover, "the download reported an error").toBe("");
  expect(h.downloads, "exactly one file downloaded").toHaveLength(1);
  expect(h.downloads[0].name).toMatch(/ - CL\.docx$/);
  return h.downloads[0].blob;
}

describe("preview download of an edited embedded cover letter keeps its soft line breaks", () => {
  for (const variant of EMBEDDED_VARIANTS) {
    for (const shape of Object.keys(COVER_SHAPES)) {
      it(`${variant}: ${shape}`, async () => {
        const fix = FIX[`${variant}/br`];
        const { lines, changed } = COVER_SHAPES[shape](fix);
        const blob = await editAndDownloadCover(fix, lines);
        expect(rebuildProblems(fix.before, await paragraphRecords(blob), changed)).toEqual([]);
      });
    }

    // The same letter with every soft break written as <w:cr/>. Kills a fix
    // that only splits on <w:br/>.
    for (const shape of ["control", "bodyEdit"]) {
      it(`${variant} (w:cr breaks): ${shape}`, async () => {
        const fix = FIX[`${variant}/cr`];
        const { lines, changed } = COVER_SHAPES[shape](fix);
        const blob = await editAndDownloadCover(fix, lines);
        expect(rebuildProblems(fix.before, await paragraphRecords(blob), changed)).toEqual([]);
      });
    }
  }

  it("CONTROL (passes on HEAD): an UNEDITED letter is served byte-for-byte, with no rebuild", async () => {
    // Pins that the tests above measure the rebuild and not the verbatim
    // branch: here the text is untouched and the edited flag never set, so
    // resolveDocumentBlob's branch 1 must hand back the engine's own bytes.
    const fix = FIX["industry/br"];
    const { downloadDocxFiles } = createDocumentDownloaders({
      resumeFile: null,
      coverLetterFile: null,
      tailoringMap: {},
      applicationData: [],
    });
    await act(async () => {
      root.render(createElement(PreviewProbe, { initialMap: { [JOB_ID]: coverEntry(fix) }, downloadDocxFiles }));
    });
    await act(async () => {
      preview.openResumePreview({ id: JOB_ID, title: "Senior Software Engineer", company: "Acme Corp" });
    });
    await flush();
    await act(async () => {
      await preview.downloadDocumentPreview("cover", asEditorText(fix.lines));
    });
    expect(h.downloads).toHaveLength(1);
    const got = new Uint8Array(await h.downloads[0].blob.arrayBuffer());
    const want = Uint8Array.from(atob(fix.docxB64), (c) => c.charCodeAt(0));
    expect(got.length).toBe(want.length);
    expect(got.every((b, i) => b === want[i])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Drive save
// ---------------------------------------------------------------------------

let drive = null;
function DriveProbe(props) {
  drive = useDriveDocuments(props);
  return null;
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function stubDriveFetch(calls) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (url.startsWith("/api/drive/status")) return jsonResponse({ connected: true, configured: true, email: "a@example.com" });
      if (url.startsWith("/api/drive/documents")) return jsonResponse({ documents: {} });
      if (url.startsWith("/api/drive/save")) {
        const meta = JSON.parse(init.body.get("meta"));
        return jsonResponse({
          scope: meta.scope,
          fileId: `file-${meta.scope}`,
          name: meta.name,
          webViewLink: `https://docs.google.com/document/d/file-${meta.scope}/edit`,
          version: "v1",
          mimeType: "application/vnd.google-apps.document",
          created: true,
          replaced: false,
          persisted: true,
        });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    }),
  );
}

/** Save to Drive with the cover letter active; returns the uploaded cover blob. */
async function saveCoverToDrive(entry, activeText) {
  const calls = [];
  stubDriveFetch(calls);
  await act(async () => {
    root.render(
      createElement(DriveProbe, {
        currentUser: { id: "user-1" },
        tailoringMap: { [JOB_ID]: entry },
        resumeFile: null,
        coverLetterFile: null,
        jobId: JOB_ID,
        jobTitle: "Senior Software Engineer",
        company: "Acme Corp",
        activeScope: "cover",
      }),
    );
  });
  await flush();
  await flush();
  await act(async () => {
    await drive.saveToDrive({ activeScope: "cover", activeText, activeFileName: "" });
  });
  await flush();
  const saves = calls.filter((c) => c.url.startsWith("/api/drive/save"));
  const cover = saves.find((c) => JSON.parse(c.init.body.get("meta")).scope === "cover");
  expect(cover, "no cover upload reached /api/drive/save").toBeTruthy();
  return cover.init.body.get("file");
}

describe("Drive save of an edited embedded cover letter keeps its soft line breaks", () => {
  for (const variant of EMBEDDED_VARIANTS) {
    it(`${variant}: control (edited flag set by autosave, lines unchanged)`, async () => {
      const fix = FIX[`${variant}/br`];
      const entry = coverEntry(fix, { edited: { resume: false, cover: true } });
      const blob = await saveCoverToDrive(entry, asEditorText(fix.lines));
      expect(rebuildProblems(fix.before, await paragraphRecords(blob), {})).toEqual([]);
    });

    it(`${variant}: bodyEdit (an uncommitted draft saved straight from the editor)`, async () => {
      // The stored entry is still the unedited letter; the edit exists only as
      // the dialog's draft text, which previewBlobArgs re-splits into lines.
      const fix = FIX[`${variant}/br`];
      const { lines, changed } = COVER_SHAPES.bodyEdit(fix);
      const blob = await saveCoverToDrive(coverEntry(fix), asEditorText(lines));
      expect(rebuildProblems(fix.before, await paragraphRecords(blob), changed)).toEqual([]);
    });

    it(`${variant} (w:cr breaks): control`, async () => {
      const fix = FIX[`${variant}/cr`];
      const entry = coverEntry(fix, { edited: { resume: false, cover: true } });
      const blob = await saveCoverToDrive(entry, asEditorText(fix.lines));
      expect(rebuildProblems(fix.before, await paragraphRecords(blob), {})).toEqual([]);
    });
  }
});
