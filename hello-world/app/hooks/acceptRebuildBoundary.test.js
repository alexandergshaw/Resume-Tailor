// @vitest-environment jsdom
//
// N35 / 4b -- PM1 from `chunks/N40/plan.check.r2.md`, and the replacement for
// plan r3 §11's T17.
//
// WHAT PM1 FOUND. T17's Leg 2 asks for `lib/document/docx.js#buildDocxFromUploadedTemplate`
// to be spied and to record 0 calls on the accept path, with "the same entry
// with edited.cover = true records 1" as its positive control.
// `resolveDocumentBlob` calls that function through its MODULE-LOCAL BINDING
// (`docx.js:574`, `:580`, `:586`), so under Vite's ESM transform a namespace
// spy never intercepts it. The plan checker executed it with a control and a
// canary: the rebuild really ran (the bytes differed from the engine's) and
// the spy recorded 0; a direct namespace call recorded 1. The instrument is
// faithful and the answer is 0 either way, so T17's stated positive control
// would go RED as an INSTRUMENT FAILURE, not as a defect.
//
// WHAT THIS FILE DOES INSTEAD. Two instruments that can actually observe a
// rebuild, both of which the namespace spy could not be:
//
//   1. BYTE IDENTITY. The verbatim serve returns exactly the entry's
//      `coverLetterDocxB64`; a rebuild cannot, because it re-zips. This is
//      decisive and needs no interception at all.
//   2. A REAL MODULE BOUNDARY. `buildDocxFromUploadedTemplate` reaches
//      `JSZip.loadAsync`, and `jszip` is a package import -- a boundary
//      `vi.mock` really does intercept. Each call records its stack, and only
//      the calls whose stack names `buildDocxFromUploadedTemplate` are
//      counted, so an unrelated zip read cannot inflate the number. The
//      discrimination is proven below against BOTH directions: a direct
//      rebuild is counted, and an unrelated zip read is not.
//
// No export, wrapper or `disable` comment is added to `docx.js` to make any of
// this reachable -- which was the other half of PM1's warning.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const h = vi.hoisted(() => ({ downloads: [], zipLoads: [] }));

// The interception. `importOriginal` keeps the REAL JSZip -- this is a
// recorder, not a replacement, so every zip this file reads or writes is a
// real zip.
vi.mock("jszip", async (importOriginal) => {
  const mod = await importOriginal();
  const Real = mod.default;
  const realLoad = Real.loadAsync.bind(Real);
  Real.loadAsync = function loadAsyncRecorded(...args) {
    h.zipLoads.push(new Error("zip-load").stack || "");
    return realLoad(...args);
  };
  return { ...mod, default: Real };
});
vi.mock("@/lib/document/download.js", () => ({
  triggerBlobDownload: (blob, fileName) => {
    h.downloads.push({ blob, fileName });
  },
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "nf" } }) }) },
  }),
}));
vi.mock("@/lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => true),
}));
vi.mock("@/lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";
import { useCompanyResearch } from "./useCompanyResearch.js";
// `buildDocxFromUploadedTemplate` is deliberately NOT imported here, although
// it is the function this file's counter is named after. Importing it would
// make it an export whose only consumer is a test, which moves
// `lib/sourceScan/exportReachability.sweep.test.js`'s TEST_REFERENCED literal
// (363 -> 364) and turns two sweep rows red. That is the repo's standing
// signal that the test picked an entry point a human never reaches: the app
// reaches the rebuild through `downloadDocxFiles` and `resolveDocumentBlob`,
// and so does every canary below. The instrument gets MORE faithful and the
// gate stays green.
import { createDocumentDownloaders, buildMinimalistDocx, resolveDocumentBlob } from "@/lib/document/docx.js";
import { buildPreviewBlob, previewBlobArgs } from "@/lib/document/previewBlob.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const FACT_TEXT = "Acme opened a Dublin telemetry lab in 2026.";
const SELECTION = {
  facts: [
    {
      id: "art-dublin-lab",
      text: FACT_TEXT,
      url: "https://acme.example.com/newsroom/dublin-lab",
      title: "Acme opens Dublin telemetry lab",
      source: "Acme Newsroom",
      placement: "current",
      textOrigin: "template",
    },
  ],
  declinedUrls: [],
};

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let COVER_TEMPLATE_FILE = null;

async function blobToB64(blob) {
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

// THE COUNTER. Only zip reads attributable to the rebuild are counted, so an
// unrelated `JSZip.loadAsync` (the preview's own docx parse, say) cannot make
// a verbatim serve look like a rebuild.
function rebuildsSeen() {
  return h.zipLoads.filter((s) => s.includes("buildDocxFromUploadedTemplate")).length;
}
function resetCounter() {
  h.zipLoads.length = 0;
}

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
  const tpl = await buildMinimalistDocx(
    [{ primaryLine: "Generic", secondaryLine: "Sub", details: ["d1", "d2"] }],
    "Generic CL",
  );
  COVER_TEMPLATE_FILE = new File([tpl], "cl-template.docx", { type: DOCX_MIME });
});

// ---------------------------------------------------------------------------
// The instrument's own proof. Both directions, before anything else is read.
// ---------------------------------------------------------------------------

describe("the rebuild counter discriminates (PM1's replacement for the namespace spy)", () => {
  it("CANARY: a rebuild reached the way the CHIP DOWNLOAD reaches it is counted", async () => {
    // The real production entry point (`app/page.js:2066`'s argument shape),
    // not a direct call into the rebuild.
    resetCounter();
    const { downloadDocxFiles } = createDocumentDownloaders({
      resumeFile: null,
      coverLetterFile: COVER_TEMPLATE_FILE,
      tailoringMap: {},
      applicationData: [],
    });
    h.downloads.length = 0;
    const err = await downloadDocxFiles({
      jobTitle: "T",
      company: "C",
      result: "",
      resultLines: [],
      coverLetterResultLines: [...ENGINE_LINES],
      docxB64: "",
      // No engine bytes -> `downloadDocxFiles` computes `edited: true` and the
      // letter is rebuilt onto the uploaded template. This is PB1's defect
      // shape, used here only as a guaranteed source of a real rebuild.
      coverLetterDocxB64: "",
    });
    expect(err).toBeNull();
    expect(h.downloads.length).toBeGreaterThan(0);
    expect(rebuildsSeen()).toBeGreaterThan(0);
  });

  it("CANARY: `resolveDocumentBlob`'s INTERNAL call is counted -- the thing a namespace spy misses", async () => {
    resetCounter();
    const blob = await resolveDocumentBlob({
      engineDocxB64: ENGINE_B64,
      docxPath: "",
      edited: true,
      text: ENGINE_LINES.join("\n"),
      lines: ENGINE_LINES,
      uploadedTemplate: null,
    });
    expect(blob).toBeTruthy();
    // The rebuild really ran: the bytes are not the engine's any more.
    expect(await blobToB64(blob)).not.toBe(ENGINE_B64);
    // ... and unlike `vi.spyOn(docxModule, "buildDocxFromUploadedTemplate")`,
    // this instrument saw it. PM1's finding, inverted into a working control.
    expect(rebuildsSeen()).toBe(1);
  });

  it("CONTROL: an unrelated zip read is NOT counted", async () => {
    resetCounter();
    const { default: JSZip } = await import("jszip");
    await JSZip.loadAsync(Buffer.from(ENGINE_B64, "base64"));
    // The recorder saw the load ...
    expect(h.zipLoads.length).toBeGreaterThan(0);
    // ... and the attribution filter correctly refused to call it a rebuild.
    expect(rebuildsSeen()).toBe(0);
  });

  it("CONTROL: the verbatim serve reads no zip at all", async () => {
    resetCounter();
    const blob = await resolveDocumentBlob({
      engineDocxB64: ENGINE_B64,
      docxPath: "",
      edited: false,
      text: ENGINE_LINES.join("\n"),
      lines: ENGINE_LINES,
      uploadedTemplate: null,
    });
    expect(await blobToB64(blob)).toBe(ENGINE_B64);
    expect(rebuildsSeen()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Harness for the accept path.
// ---------------------------------------------------------------------------

let api = null;
let research = null;
let currentMap = null;
let container = null;
let root = null;

function Probe({ initialMap, downloadDocxFiles }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  currentMap = tailoringMap;
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((c) => ({
        ...c,
        [jobId]: typeof updater === "function" ? updater(c[jobId] || {}) : { ...(c[jobId] || {}), ...updater },
      })),
    resumeFile: null,
    coverLetterFile: COVER_TEMPLATE_FILE,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles,
    startBackgroundResearch: () => {},
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  return null;
}

function entryInSession(over = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverLetterPreviewHtml: undefined,
    coverVersionId: "ver-1",
    ...over,
  };
}

async function mountAndAccept(entry) {
  const { downloadDocxFiles } = createDocumentDownloaders({
    resumeFile: null,
    coverLetterFile: COVER_TEMPLATE_FILE,
    tailoringMap: {},
    applicationData: [],
  });
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry }, downloadDocxFiles }));
  });
  await act(async () => {
    api.openResumePreview(JOB, { tab: "cover" });
    research.openCompanyResearch(JOB);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  let result;
  await act(async () => {
    result = await research.acceptFacts(SELECTION);
  });
  return result;
}

beforeEach(() => {
  h.downloads.length = 0;
  resetCounter();
  api = null;
  research = null;
  currentMap = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes("/api/company-research")) {
      return new Response(JSON.stringify({ articles: [], warnings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ facts: [], removed: [], revision: 1, versionSaved: false, previousFacts: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete globalThis.fetch;
});

// ---------------------------------------------------------------------------
// The boundary itself.
// ---------------------------------------------------------------------------

describe("an accept on an unedited in-session letter never reaches the rebuild (T17, rebuilt)", () => {
  it("LEG 1 (bytes): the preview download serves the spliced bytes, byte for byte", async () => {
    const r = await mountAndAccept(entryInSession());
    expect(r.ok).toBe(true);
    const live = currentMap[JOB_ID];
    // The accept spliced the fact into BOTH the text and the bytes.
    expect(live.coverLetterResultLines.join("\n")).toContain(FACT_TEXT);
    expect(live.coverLetterDocxB64).toBeTruthy();
    expect(live.coverLetterDocxB64).not.toBe(ENGINE_B64);

    h.downloads.length = 0;
    resetCounter();
    await act(async () => {
      await api.downloadDocumentPreview("cover", { text: live.coverLetterResultLines.join("\n") });
    });
    const served = await blobToB64(h.downloads[h.downloads.length - 1].blob);
    expect(served).toBe(live.coverLetterDocxB64);
  });

  it("LEG 2 (rebuild count): the download rebuilds ZERO times, and the edited entry rebuilds once", async () => {
    const r = await mountAndAccept(entryInSession());
    expect(r.ok).toBe(true);
    const live = currentMap[JOB_ID];
    const text = live.coverLetterResultLines.join("\n");

    resetCounter();
    await act(async () => {
      await api.downloadDocumentPreview("cover", { text });
    });
    expect(rebuildsSeen()).toBe(0);

    // POSITIVE CONTROL -- the leg PM1 showed was unbuildable with a namespace
    // spy. The SAME entry with the cover hand-edited rebuilds exactly once,
    // through the same real download path, so the zero above is a real zero.
    resetCounter();
    await act(async () => {
      api.saveDocumentPreview("cover", `${text}\nA sentence the candidate typed.`);
    });
    await act(async () => {
      await api.downloadDocumentPreview("cover", { text: `${text}\nA sentence the candidate typed.` });
    });
    expect(rebuildsSeen()).toBe(1);
  });

  it("LEG 3 (arguments): the Drive/preview seam computes edited=false and serves verbatim", async () => {
    const r = await mountAndAccept(entryInSession());
    expect(r.ok).toBe(true);
    const live = currentMap[JOB_ID];
    const text = live.coverLetterResultLines.join("\n");

    // The exact seam `useDriveDocuments.js:591` calls, with the text
    // `DocumentPreviewDialog.js:512` supplies after the accept's reload bump.
    const args = previewBlobArgs(live, "cover", { coverLetterFile: COVER_TEMPLATE_FILE, text });
    expect(args.edited).toBe(false);
    expect(args.engineDocxB64).toBe(live.coverLetterDocxB64);

    resetCounter();
    const blob = await buildPreviewBlob(live, "cover", { coverLetterFile: COVER_TEMPLATE_FILE, text });
    expect(await blobToB64(blob)).toBe(live.coverLetterDocxB64);
    expect(rebuildsSeen()).toBe(0);

    // plan.check.r2 Pm4: the verbatim serve on this path ALSO requires the
    // supplied text to equal the stored text -- `previewBlobArgs` ORs in
    // `textChanged`. Pinned here because §2.2 never states it, and the
    // reload-key bump is the only thing that guarantees it.
    const stale = previewBlobArgs(live, "cover", {
      coverLetterFile: COVER_TEMPLATE_FILE,
      text: ENGINE_LINES.join("\n"),
    });
    expect(stale.edited).toBe(true);
  });

  it("the accept NEVER assigns `edited` -- the load-bearing fact behind all three legs", async () => {
    const before = entryInSession();
    const r = await mountAndAccept(before);
    expect(r.ok).toBe(true);
    const live = currentMap[JOB_ID];
    // Not "edited is falsy": the key must not have been written at all, in
    // either shape. An `edited: {cover: false}` written by the accept would
    // be a different (and later, silently breakable) contract.
    expect(Object.prototype.hasOwnProperty.call(live, "edited")).toBe(false);
  });
});

// WHAT THIS FILE CANNOT CATCH. `rebuildsSeen()` attributes by stack frame
// name. A build that renames `buildDocxFromUploadedTemplate`, or inlines it,
// makes the counter read 0 for every input -- which is why the two canaries
// above run FIRST and would fail in that world, and why LEG 1's byte identity
// is kept as an independent instrument that needs no attribution at all.
// It also says nothing about whether the rebuild, when it does run, produces
// a correct document; that is N54 and is out of this chunk's scope.
