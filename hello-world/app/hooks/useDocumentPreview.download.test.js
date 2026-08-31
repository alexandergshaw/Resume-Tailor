// @vitest-environment jsdom
//
// MAJOR-1 regression (Wave 1 verification). The D-1 fix makes
// selectDocumentVersion clear entry.docxB64 on a version switch so the
// PREVIEW stops serving the newest generation's bytes for an older
// version's text -- correct. But entry.docxB64 doubles as the DOWNLOAD
// path's rebuild TEMPLATE too: useDocumentPreview.js's downloadDocumentPreview
// passes it as args.templateDocxB64, and previously forwarded entry.docxPath
// (the older version's own stored doc) only when serveFinished -- i.e. only
// for an UNEDITED download. So: generate -> switch to an older version ->
// hand-edit -> Download used to have nothing left to rebuild onto, and fell
// back to the user's generic uploaded template (silently losing engine
// formatting) or to null ("Upload the source resume as .docx to download.").
// downloadResumeForChipJob (lib/document/docx.js) had the same shape.
//
// This test proves the OBSERVABLE outcome on real bytes through the real
// resolveDocumentBlob / buildDocxFromUploadedTemplate / JSZip pipeline --
// never a prop/argument assertion, which would pass just as happily against
// a prop wired to the wrong thing. Two fixture templates are built with the
// SAME paragraph count as the edited text (5), so alignLinesToSlots (LCS-based,
// see lib/document/alignLines.js) degrades to a pure positional fill with no
// insert/remove for either template -- a "fill" only ever replaces a
// paragraph's TEXT, never its run formatting (see setParagraphText). The
// uploaded GENERIC template alone has a secondaryLine paragraph, which is the
// only paragraph styled with color 4A5568; the ENGINE template (the older
// version's own stored .docx) has no such field. So if the rebuilt
// document.xml contains "4A5568", the download fell back to the uploaded
// template and lost the engine formatting; if it does not, it correctly used
// the stored engine document instead.
//
// Nothing production-relevant is mocked here: createDocumentDownloaders,
// downloadDocxFiles, resolveDocumentBlob, buildDocxFromUploadedTemplate and
// buildMinimalistDocx are all the real lib/document/docx.js. Only the
// Supabase client (position lookup + storage download) and its two sibling
// modules (documentVersions, persistGeneration) are stubbed, exactly like
// useDocumentPreview.wiring.test.js.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Mutable container populated in beforeAll (real docx bytes need an async
// build) but referenced by the hoisted mock factory below, which itself must
// stay synchronous.
const h = vi.hoisted(() => ({ storage: {}, downloads: [] }));

vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: "pos-1" }, error: null }) }),
      }),
    }),
    storage: {
      from: () => ({
        download: async (path) => {
          h.downloads.push(path);
          const blob = h.storage[path];
          if (!blob) return { data: null, error: { message: `not found: ${path}` } };
          return { data: blob, error: null };
        },
      }),
    },
  }),
}));

vi.mock("../../lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(),
  pointApplicationAtVersion: vi.fn(),
}));

vi.mock("../../lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";
import { createDocumentDownloaders, buildMinimalistDocx } from "../../lib/document/docx.js";
import { fetchDocumentVersions, pointApplicationAtVersion } from "../../lib/supabase/documentVersions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";

const RESUME_VERSIONS = [
  {
    id: "r2",
    content: "NEWEST TEXT",
    content_lines: ["NEWEST TEXT"],
    created_at: "2026-08-02T00:00:00.000Z",
    docx_path: "user-1/generated/r2.docx",
  },
  {
    id: "r1",
    content: "OLD VERSION TEXT",
    content_lines: ["OLD VERSION TEXT"],
    created_at: "2026-08-01T00:00:00.000Z",
    docx_path: "user-1/generated/r1.docx",
  },
];

// Five paragraphs, none styled with color 4A5568 -- the older version's own
// stored engine document.
const ENGINE_ENTRIES = [
  { primaryLine: "Engine Primary", details: ["Engine D1", "Engine D2", "Engine D3"] },
];

// Also five paragraphs, but WITH a secondaryLine -- the only field
// buildMinimalistDocumentXml styles with color 4A5568 -- standing in for the
// user's generic uploaded résumé template.
const GENERIC_ENTRIES = [
  { primaryLine: "Generic Primary", secondaryLine: "Generic Secondary", details: ["Generic D1", "Generic D2"] },
];

const EDITED_LINES = ["Edited L1", "Edited L2", "Edited L3", "Edited L4", "Edited L5"];
const EDITED_TEXT = EDITED_LINES.join("\n");

let GENERIC_TEMPLATE_FILE;

beforeAll(async () => {
  const engineBlob = await buildMinimalistDocx(ENGINE_ENTRIES, "Engine Title");
  h.storage["user-1/generated/r1.docx"] = engineBlob;

  const genericBlob = await buildMinimalistDocx(GENERIC_ENTRIES, "Generic Title");
  GENERIC_TEMPLATE_FILE = new File([genericBlob], "my-resume.docx", { type: DOCX_MIME });
});

let api = null;
let container = null;
let root = null;

function Probe({ initialMap, downloadDocxFiles }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((current) => ({
        ...current,
        [jobId]:
          typeof updater === "function"
            ? updater(current[jobId] || {})
            : { ...(current[jobId] || {}), ...updater },
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

function inSessionEntry() {
  return {
    status: "done",
    result: "NEWEST TEXT",
    resultLines: ["NEWEST TEXT"],
    // The in-session engine doc for the NEWEST generation -- irrelevant to
    // every assertion below, since the switch to r1 clears it before the
    // download happens.
    docxB64: "unused-newest-placeholder",
    docxPath: "",
    coverLetterResultLines: [],
    coverLetterDocxB64: "",
    edited: { resume: false, cover: false },
  };
}

async function openWith(entry, downloadDocxFiles) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry }, downloadDocxFiles }));
  });
  await act(async () => {
    api.openResumePreview({ id: JOB_ID, title: "Staff Engineer", company: "Acme" });
  });
  // Version history loads in the background (fire-and-forget), same as
  // useDocumentPreview.wiring.test.js.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // Guard: a version id not found in history is a silent no-op, which would
  // make the switch below vacuous.
  expect(api.documentVersions.resume.map((v) => v.id)).toEqual(["r2", "r1"]);
}

async function selectVersion(versionId) {
  await act(async () => {
    api.selectDocumentVersion("resume", versionId);
  });
  await act(async () => {});
}

beforeEach(() => {
  h.downloads.length = 0;
  fetchDocumentVersions.mockReset();
  fetchDocumentVersions.mockImplementation(async (_client, scope) =>
    scope === "resume" ? RESUME_VERSIONS : [],
  );
  pointApplicationAtVersion.mockReset();
  pointApplicationAtVersion.mockResolvedValue(true);
  api = null;
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

describe("download after a version switch + hand-edit (MAJOR-1)", () => {
  let createdBlobs;
  let realClick;

  beforeEach(() => {
    createdBlobs = [];
    // jsdom implements neither of these (see lib/document/download.test.js).
    URL.createObjectURL = vi.fn((blob) => {
      createdBlobs.push(blob);
      return `blob:mock/${createdBlobs.length - 1}`;
    });
    URL.revokeObjectURL = vi.fn(() => {});
    realClick = window.HTMLAnchorElement.prototype.click;
    window.HTMLAnchorElement.prototype.click = function noopClick() {};
  });

  afterEach(() => {
    window.HTMLAnchorElement.prototype.click = realClick;
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  it("rebuilds onto the older version's stored engine document, not the uploaded template or null", async () => {
    const { downloadDocxFiles } = createDocumentDownloaders({
      resumeFile: GENERIC_TEMPLATE_FILE,
      coverLetterFile: null,
      tailoringMap: {},
      applicationData: [],
    });

    await openWith(inSessionEntry(), downloadDocxFiles);
    await selectVersion("r1");
    await act(async () => {
      api.saveDocumentPreview("resume", EDITED_TEXT);
    });
    await act(async () => {
      await api.downloadDocumentPreview("resume", EDITED_TEXT);
    });

    // Not the "Upload the source resume as .docx to download." failure, and
    // not any other error either.
    expect(api.resumePreview.error.resume).toBe("");

    // It fetched r1's OWN stored document -- the version actually selected --
    // not r2's, and not zero times (zero would mean it skipped straight past
    // the storage pointer to the uploaded template).
    expect(h.downloads).toContain("user-1/generated/r1.docx");

    expect(createdBlobs).toHaveLength(1);
    const zip = await JSZip.loadAsync(await createdBlobs[0].arrayBuffer());
    const xml = await zip.file("word/document.xml").async("string");

    // The hand-edit actually made it into the downloaded bytes.
    for (const line of EDITED_LINES) expect(xml).toContain(line);

    // THE regression assertion: color 4A5568 only exists in the uploaded
    // GENERIC template's secondaryLine paragraph. Both fixtures have the same
    // paragraph count as EDITED_LINES, so the rebuild is a pure slot-fill
    // that preserves each slot's original run formatting untouched (see
    // lib/document/alignLines.js + setParagraphText) -- its presence here
    // means the download silently fell back to the generic uploaded résumé
    // and lost the engine formatting, which is exactly MAJOR-1.
    expect(xml).not.toContain("4A5568");
  });

  // MAJOR-A (Wave 1 re-verification): downloadResumeForChipJob (lib/document/docx.js)
  // has the identical templateDocxPath fix, at the identical call site shape, for the
  // floating status-bar chip's Download action -- but nothing called it, so nothing
  // pinned it. A rehydrated/version-switched chip entry looks like the fixture below:
  // docxB64 cleared, docxPath pointing at the stored engine doc, resume hand-edited.
  // Same real pipeline, same two byte-level assertions as the test above.
  it("chip download (downloadResumeForChipJob) rebuilds onto the stored engine document, not the uploaded template", async () => {
    const { downloadResumeForChipJob } = createDocumentDownloaders({
      resumeFile: GENERIC_TEMPLATE_FILE,
      coverLetterFile: null,
      tailoringMap: {
        [JOB_ID]: {
          result: EDITED_TEXT,
          resultLines: EDITED_LINES,
          docxB64: "",
          docxPath: "user-1/generated/r1.docx",
          edited: { resume: true, cover: false },
        },
      },
      applicationData: [],
    });

    const outcome = await downloadResumeForChipJob({ id: JOB_ID, title: "Staff Engineer", company: "Acme" });

    // Not the "Upload your source resume as .docx first." failure, and not any
    // other error either.
    expect(outcome).toBe(null);

    // It fetched the chip's OWN stored document, not zero times (zero would
    // mean it skipped straight past the storage pointer to the uploaded
    // template).
    expect(h.downloads).toContain("user-1/generated/r1.docx");

    expect(createdBlobs).toHaveLength(1);
    const zip = await JSZip.loadAsync(await createdBlobs[0].arrayBuffer());
    const xml = await zip.file("word/document.xml").async("string");

    // The hand-edit actually made it into the downloaded bytes.
    for (const line of EDITED_LINES) expect(xml).toContain(line);

    // THE regression assertion, same reasoning as above: color 4A5568 only
    // exists in the uploaded GENERIC template's secondaryLine paragraph. Its
    // presence here means the chip download silently fell back to the
    // uploaded résumé and lost the engine formatting.
    expect(xml).not.toContain("4A5568");
  });
});
