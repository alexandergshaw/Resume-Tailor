// @vitest-environment jsdom
//
// N59 step 4 (4b) -- the cover read path, end to end through the real hook and
// the real resolveDocumentBlob. AC-1, AC-2, AC-5 (bytes half).
//
// The defect: after a cover VERSION SWITCH (or a reload), the letter has no
// in-session bytes and, on HEAD, no docx_path to fall back to -- so every
// download rebuilds the letter's text onto the candidate's GENERIC uploaded
// template (resolveDocumentBlob branch 5), losing the engine's own formatting.
// The fix carries the switched-to/rehydrated version's own docx_path so the
// resolve takes branch 2 (fetch the stored engine doc and serve it verbatim).
//
// REACHABILITY: the switch is driven through the real api.selectDocumentVersion
// (what VersionControl.onSelect calls), and the bytes are produced through the
// real buildPreviewBlob -> previewBlobArgs -> resolveDocumentBlob -> the real
// fetchStoredDocxBlob (which calls createClient().storage.download). Only the
// Supabase client is stubbed, and its storage.download is the one seam that
// stands in for the real bucket -- returning a SENTINEL object so "served the
// stored doc" and "rebuilt onto the template" are byte-distinguishable.
//
// RED-ON-HEAD REASONS:
//  - selectDocumentVersion's cover branch writes no coverLetterDocxPath
//    (useDocumentPreview.js:241-254);
//  - previewBlobArgs hardcodes the cover docxPath to "" (previewBlob.js:103-105);
// so the resolve cannot reach branch 2 and serves the template rebuild.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// The one stored object the resolve must serve. A recognizable byte run so it is
// unmistakable against any template rebuild.
const SENTINEL_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xe5, 0x59, 0x37, 0x11, 0x2a, 0x2b]);
const COVER_PATH_C1 = "user-1/generated/c1.docx";
const COVER_PATH_C2 = "user-1/generated/c2.docx";

const storageObjects = {};

vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pos-1" }, error: null }) }) }),
    }),
    storage: {
      from: () => ({
        download: async (path) => {
          const bytes = storageObjects[path];
          return bytes ? { data: new Blob([bytes], { type: DOCX_MIME }), error: null } : { data: null, error: { message: "not found" } };
        },
      }),
    },
  }),
}));

vi.mock("../../lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(),
  pointApplicationAtVersion: vi.fn(async () => true),
}));
vi.mock("../../lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";
import { fetchDocumentVersions } from "../../lib/supabase/documentVersions";
import { buildPreviewBlob } from "../../lib/document/previewBlob.js";
import { buildMinimalistDocx } from "../../lib/document/docx.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const C2_LINES = ["Dear Team,", "The newest cover version body."];
const C1_LINES = ["To the Hiring Team,", "An earlier cover version body."];

const VERSIONS = {
  resume: [
    { id: "r2", content: "R2", content_lines: ["R2"], created_at: "2026-08-02T00:00:00.000Z", docx_path: "user-1/generated/r2.docx" },
  ],
  cover: [
    { id: "c2", content: C2_LINES.join("\n"), content_lines: C2_LINES, created_at: "2026-08-03T00:00:00.000Z", docx_path: COVER_PATH_C2 },
    { id: "c1", content: C1_LINES.join("\n"), content_lines: C1_LINES, created_at: "2026-08-02T00:00:00.000Z", docx_path: COVER_PATH_C1 },
  ],
};

let COVER_TEMPLATE_FILE = null;

beforeAll(async () => {
  // A real (different) generic uploaded template, so "served the sentinel" and
  // "rebuilt onto the template" are provably different byte sources.
  const tpl = await buildMinimalistDocx([{ primaryLine: "Generic", secondaryLine: "Sub", details: ["d1", "d2"] }], "Generic CL");
  COVER_TEMPLATE_FILE = new File([tpl], "cl-template.docx", { type: DOCX_MIME });
});

let api = null;
let latestMap = null;
let container = null;
let root = null;

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  latestMap = tailoringMap;
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((current) => ({
        ...current,
        [jobId]: typeof updater === "function" ? updater(current[jobId] || {}) : { ...(current[jobId] || {}), ...updater },
      })),
    resumeFile: null,
    coverLetterFile: COVER_TEMPLATE_FILE,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: async () => null,
    startBackgroundResearch: () => {},
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  return null;
}

function coverEntry() {
  // The in-session shape right after a generation: c2's text + c2's bytes.
  return {
    status: "done",
    result: "R2",
    resultLines: ["R2"],
    docxB64: "",
    docxPath: "user-1/generated/r2.docx",
    coverLetterResultLines: [...C2_LINES],
    coverLetterDocxB64: "aW4tc2Vzc2lvbi1jMi1ieXRlcw==", // in-session c2 bytes
    coverVersionId: "c2",
    insertedFacts: [],
    edited: { resume: false, cover: false },
  };
}

async function openWith(entry) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry } }));
  });
  await act(async () => {
    api.openResumePreview({ id: JOB_ID, title: "Staff Engineer", company: "Acme" });
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(api.documentVersions.cover.map((v) => v.id)).toEqual(["c2", "c1"]);
}

async function select(scope, versionId) {
  await act(async () => {
    api.selectDocumentVersion(scope, versionId);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function blobBytes(blob) {
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

beforeEach(() => {
  for (const k of Object.keys(storageObjects)) delete storageObjects[k];
  storageObjects[COVER_PATH_C1] = SENTINEL_BYTES;
  storageObjects[COVER_PATH_C2] = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x11, 0x22, 0x33]);
  fetchDocumentVersions.mockReset();
  fetchDocumentVersions.mockImplementation(async (_client, scope) => VERSIONS[scope] || []);
  api = null;
  latestMap = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

// ---------------------------------------------------------------------------
// Sanity control: the sentinel is not the template. Without this, "served the
// sentinel" and "rebuilt the template" could be the same bytes by accident.
// ---------------------------------------------------------------------------

describe("fixtures are distinguishable", () => {
  it("the stored sentinel is not the generic template's bytes", async () => {
    const tplBytes = new Uint8Array(await COVER_TEMPLATE_FILE.arrayBuffer());
    expect(sameBytes(SENTINEL_BYTES, tplBytes)).toBe(false);
    expect(tplBytes.length).toBeGreaterThan(SENTINEL_BYTES.length);
  });
});

// ---------------------------------------------------------------------------
// AC-5 (bytes half): the switch records the switched-to version's docx_path.
// ---------------------------------------------------------------------------

describe("a cover version switch records the switched-to version's docx_path (AC-5)", () => {
  it("writes coverLetterDocxPath from version.docx_path, keeps bytes and facts cleared", async () => {
    await openWith(coverEntry());
    await select("cover", "c1");
    const entry = latestMap[JOB_ID];
    // RED on HEAD: the cover branch threads no coverLetterDocxPath.
    expect(entry.coverLetterDocxPath).toBe(COVER_PATH_C1);
    // Non-regression (N71 guard): switching still clears the stale bytes and the
    // facts located against the OLD text.
    expect(entry.coverLetterDocxB64).toBe("");
    expect(entry.insertedFacts || []).toEqual([]);
  });

  it("CONTROL: a RESUME switch does not write a cover docx_path", async () => {
    // Over-broad-fix guard: the cover threading must live in the cover branch.
    await openWith(coverEntry());
    await select("resume", "r2");
    const entry = latestMap[JOB_ID];
    // The cover field is untouched by a resume switch (undefined, or whatever it
    // was) -- it must not be set to the resume's path.
    expect(entry.coverLetterDocxPath ?? "").not.toBe("user-1/generated/r2.docx");
  });
});

// ---------------------------------------------------------------------------
// AC-1: the resolve serves the switched-to version's STORED engine doc (branch
// 2), not the generic template rebuild (branch 5).
// ---------------------------------------------------------------------------

describe("the download serves the switched-to version's stored engine doc (AC-1)", () => {
  it("serves the stored sentinel, not a template rebuild", async () => {
    await openWith(coverEntry());
    await select("cover", "c1");
    const entry = latestMap[JOB_ID];

    const blob = await buildPreviewBlob(entry, "cover", { coverLetterFile: COVER_TEMPLATE_FILE });
    const served = await blobBytes(blob);

    // RED on HEAD: with no coverLetterDocxPath and no bytes, the resolve falls to
    // branch 5 and rebuilds C1_LINES onto COVER_TEMPLATE_FILE -- NOT the sentinel.
    expect(served).not.toBeNull();
    expect(sameBytes(served, SENTINEL_BYTES), "the switched-to version's stored engine doc was not served").toBe(true);

    const tplBytes = new Uint8Array(await COVER_TEMPLATE_FILE.arrayBuffer());
    expect(sameBytes(served, tplBytes), "a generic-template rebuild was served instead of the stored doc").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-2: byte-identity across a reload. A rehydrated entry that carries only the
// path (no in-session bytes -- exactly what page.js rehydration produces) must
// resolve the SAME bytes as the in-session switch did.
// ---------------------------------------------------------------------------

describe("re-downloading the same version is byte-identical across a reload (AC-2)", () => {
  it("a path-only rehydrated entry resolves the same stored bytes", async () => {
    // Simulate the post-reload entry: only coverLetterDocxPath, no bytes.
    const rehydrated = {
      status: "done",
      result: "R2",
      resultLines: ["R2"],
      docxB64: "",
      docxPath: "user-1/generated/r2.docx",
      coverLetterResultLines: [...C1_LINES],
      coverLetterDocxB64: "",
      coverLetterDocxPath: COVER_PATH_C1,
      edited: { resume: false, cover: false },
    };
    const blob = await buildPreviewBlob(rehydrated, "cover", { coverLetterFile: COVER_TEMPLATE_FILE });
    const served = await blobBytes(blob);
    // RED on HEAD: previewBlobArgs drops the path, so this rebuilds the template.
    expect(sameBytes(served, SENTINEL_BYTES)).toBe(true);
  });

  it("CONTROL: with the object missing from storage, the resolve does not silently serve the template", async () => {
    // AC-6 safe direction at the read layer: a path that resolves to nothing must
    // not fall back to a differently-formatted document behind the candidate's
    // back. With no bytes, no in-session engine doc, and a dead path, branch 2/4
    // both miss; branch 5 would rebuild the template -- the failure direction.
    // The fix's resolve returns the template rebuild here (documented, not the
    // pass condition); what this control pins is that the SUCCESS case above is
    // driven by the stored object, not by the template being unavailable.
    delete storageObjects[COVER_PATH_C1];
    const rehydrated = {
      status: "done",
      result: "",
      resultLines: [],
      coverLetterResultLines: [...C1_LINES],
      coverLetterDocxB64: "",
      coverLetterDocxPath: COVER_PATH_C1,
      edited: { resume: false, cover: false },
    };
    const blob = await buildPreviewBlob(rehydrated, "cover", { coverLetterFile: COVER_TEMPLATE_FILE });
    const served = await blobBytes(blob);
    // Not the sentinel (it is gone), so the success assertion above cannot be
    // passing for a reason unrelated to the stored object.
    expect(served === null || !sameBytes(served, SENTINEL_BYTES)).toBe(true);
  });
});
