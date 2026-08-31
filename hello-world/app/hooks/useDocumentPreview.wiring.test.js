// @vitest-environment jsdom
//
// Wave 1A wiring. Two things that no piece-level test can reach.
//
// (1) ADOPTION. This is an EXTRACTION, and lib/document/previewBlob.test.js
//     structurally cannot prove it happened: every one of its assertions
//     passes just as happily against a useDocumentPreview.js that still holds
//     its own inline buildPreviewBlob / editedForScope / withEditedScope and
//     never imports the new module. This project has already shipped exactly
//     that failure once -- 27 green tests for a component extraction against a
//     caller that imported none of it -- which is why lib/feed/liveFeedWiring.test.js
//     exists and why this half is written in its shape: a limit check PLUS a
//     shrink assertion, because a token extraction that moved fifty lines out
//     would satisfy a limit check by luck.
//
// (2) D-1, the version-switch defect (ARCH.md 3, DATA.md D-1). selectDocumentVersion
//     rewrites result/resultLines, clears resumePreviewHtml and sets
//     edited:false -- and never touches entry.docxB64/docxPath. So
//     resolveDocumentBlob's first branch (lib/document/docx.js:488) serves the
//     NEWEST generation's bytes for the OLDER version's text, on the preview
//     and on the download alike. No test anywhere referenced
//     selectDocumentVersion before this file.
//
//     The assertions below are the OBSERVABLE outcome -- the actual bytes that
//     come out of the real resolveDocumentBlob after the switch -- never "some
//     field was set". A field assertion passes against a field wired to the
//     wrong value, and a fake resolveDocumentBlob would only re-state the
//     arguments lib/document/previewBlob.test.js already pins. Only Supabase
//     is stubbed; the byte pipeline is real.
//
// The docblock on line 1 is a per-file jsdom override; vitest.config.js stays
// environment: "node".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

const h = vi.hoisted(() => {
  const NEWEST_RESUME = "NEWEST-GENERATION-RESUME-DOCX";
  const FIRST_RESUME = "FIRST-VERSION-RESUME-DOCX";
  const NEWEST_COVER = "NEWEST-GENERATION-COVER-DOCX";
  return {
    NEWEST_RESUME,
    FIRST_RESUME,
    NEWEST_COVER,
    // The `resumes` storage bucket, keyed by the docx_path each generation row
    // carries (saveGeneratedResume.js:71-79 writes `${userId}/generated/${id}.docx`).
    STORAGE: {
      "user-1/generated/r2.docx": NEWEST_RESUME,
      "user-1/generated/r1.docx": FIRST_RESUME,
    },
  };
});

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
          const text = h.STORAGE[path];
          if (!text) return { data: null, error: { message: `not found: ${path}` } };
          return { data: new Blob([new TextEncoder().encode(text)]), error: null };
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
import { buildPreviewBlob } from "../../lib/document/previewBlob.js";
import { fetchDocumentVersions, pointApplicationAtVersion } from "../../lib/supabase/documentVersions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// (1) Adoption -- [src]
// ---------------------------------------------------------------------------

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const HOOK = "./useDocumentPreview.js";
const MODULE = "../../lib/document/previewBlob.js";

describe("useDocumentPreview actually adopts lib/document/previewBlob.js", () => {
  it("imports the extracted module", () => {
    expect(read(HOOK)).toMatch(/from\s+["'][^"']*document\/previewBlob(?:\.js)?["']/);
  });

  it("calls buildPreviewBlob but no longer defines it", () => {
    const src = read(HOOK);
    // Positive control for the absence assertion: the hook must still USE the
    // builder. Without it, deleting the call site entirely would pass.
    expect(src).toMatch(/buildPreviewBlob\(/);
    expect(src).not.toMatch(/function\s+buildPreviewBlob/);
  });

  it("calls the shared editedForScope/withEditedScope rather than its own copies", () => {
    const src = read(HOOK);
    // Same pairing: still used (they have five call sites in this hook), no
    // longer defined here.
    expect(src).toMatch(/editedForScope\(/);
    expect(src).toMatch(/withEditedScope\(/);
    expect(src).not.toMatch(/function\s+editedForScope/);
    expect(src).not.toMatch(/function\s+withEditedScope/);
  });

  it("calls the shared scopeText rather than keeping its own copy", () => {
    const src = read(HOOK);
    // MINOR-1: scopeText was extracted into previewBlob.js but the hook kept
    // a byte-identical local copy (previewScopeText), which is a duplicate,
    // not a move -- the exact drift this suite exists to catch for the other
    // two helpers. Positive control first: the hook must still USE it.
    expect(src).toMatch(/scopeText\(/);
    expect(src).not.toMatch(/function\s+previewScopeText/);
  });

  it("no longer calls resolveDocumentBlob itself", () => {
    // buildPreviewBlob was resolveDocumentBlob's only caller in this hook. If
    // the call survives here, the "extraction" left a second byte path behind
    // and the Drive feature would be built on the copy that did not move.
    expect(read(HOOK)).not.toMatch(/resolveDocumentBlob\s*\(/);
    // Positive control: the new module is where that call now lives.
    expect(read(MODULE)).toMatch(/resolveDocumentBlob\s*\(/);
  });

  it("shrank to roughly the size the extraction predicts", () => {
    // 963 lines before this change. The two blocks that move are
    // :51-71 (21 lines: the shared comment plus editedForScope/withEditedScope)
    // and :390-418 (29 lines: the comment plus buildPreviewBlob) = 50 out,
    // ~1 import back, ~4 for the D-1 fix => ~918 (ARCH.md 1(a) says ~913).
    // A "< 1000" check would pass against a token extraction, which is
    // exactly the failure mode this assertion exists for. Do not raise the
    // constant, and do not trim comments to meet it.
    const lines = read(HOOK).split("\n").length;
    expect(lines).toBeLessThan(935);
    expect(lines).toBeGreaterThan(400);
  });

  it("the new module is a real module, under the ceiling", () => {
    const lines = read(MODULE).split("\n").length;
    expect(lines).toBeGreaterThan(30);
    expect(lines).toBeLessThan(1000);
  });

  it("pins row 4 as a deliberate divergence (AC-S8)", () => {
    // The hand-edited restored chip: the preview rebuilds on the stored engine
    // document while the local download rebuilds on the user's generic
    // uploaded template. The Drive path is the correct half. Silently
    // "fixing" it would change the local download's shipped bytes; silently
    // widening it would drag more cases into the divergence. A named comment
    // is what keeps either from happening by accident.
    const src = read(MODULE);
    expect(src).toMatch(/row 4/i);
    expect(src).toMatch(/diverg/i);
  });

  it("pins the extraction's live mock hazard (AC-R3)", () => {
    // app/hooks/useManualTailor.test.js:22-24 mocks lib/document/docx with a
    // factory providing ONLY buildTemplateLinesForUpload. Any test that mocks
    // that module AND transitively loads previewBlob.js gets `undefined` at
    // CALL time, not at import time -- so it surfaces as a confusing runtime
    // failure in an unrelated suite rather than as a resolution error.
    const src = read(MODULE);
    expect(src).toMatch(/useManualTailor/);
    expect(src).toMatch(/buildTemplateLinesForUpload/);
  });
});

// ---------------------------------------------------------------------------
// (2) D-1 -- the version switch, asserted on bytes
// ---------------------------------------------------------------------------

const JOB_ID = "job-1";

const VERSIONS = {
  resume: [
    {
      id: "r2",
      content: "NEWEST RESUME TEXT",
      content_lines: ["NEWEST RESUME TEXT"],
      created_at: "2026-08-02T00:00:00.000Z",
      docx_path: "user-1/generated/r2.docx",
    },
    {
      id: "r1",
      content: "FIRST RESUME TEXT",
      content_lines: ["FIRST RESUME TEXT"],
      created_at: "2026-08-01T00:00:00.000Z",
      docx_path: "user-1/generated/r1.docx",
    },
  ],
  // generated_cover_letters has no docx_path column, so a cover version has
  // no stored document to substitute (DATA.md D-1, D-4).
  cover: [
    {
      id: "c2",
      content: "NEWEST COVER TEXT",
      content_lines: ["NEWEST COVER TEXT"],
      created_at: "2026-08-02T00:00:00.000Z",
    },
    {
      id: "c1",
      content: "FIRST COVER TEXT",
      content_lines: ["FIRST COVER TEXT"],
      created_at: "2026-08-01T00:00:00.000Z",
    },
  ],
};

const b64 = (text) => btoa(text);

async function textOf(blob) {
  if (!blob) return null;
  return new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
}

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
    // Verbatim from app/page.js:1831-1839.
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
    downloadDocxFiles: async () => null,
    startBackgroundResearch: () => {},
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  return null;
}

async function openWith(entry) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry } }));
  });
  await act(async () => {
    api.openResumePreview({ id: JOB_ID, title: "Staff Engineer", company: "Acme" });
  });
  // The version history loads in the background (loadVersionsForJob is
  // fire-and-forget by every caller), so it needs its own flush.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // Guard: selectDocumentVersion returns early when the id is not in the
  // loaded history, which would make every assertion below vacuous.
  expect(api.documentVersions.resume.map((v) => v.id)).toEqual(["r2", "r1"]);
  expect(api.documentVersions.cover.map((v) => v.id)).toEqual(["c2", "c1"]);
}

async function select(scope, versionId) {
  await act(async () => {
    api.selectDocumentVersion(scope, versionId);
  });
  await act(async () => {});
}

const blobFor = (scope) =>
  buildPreviewBlob(latestMap[JOB_ID], scope, { resumeFile: null, coverLetterFile: null });

function inSessionEntry() {
  return {
    status: "done",
    result: "NEWEST RESUME TEXT",
    resultLines: ["NEWEST RESUME TEXT"],
    // The in-session engine document: the newest generation's bytes.
    docxB64: b64(h.NEWEST_RESUME),
    docxPath: "",
    coverLetterResultLines: ["NEWEST COVER TEXT"],
    coverLetterDocxB64: b64(h.NEWEST_COVER),
    edited: { resume: false, cover: false },
  };
}

function restoredEntry() {
  return {
    ...inSessionEntry(),
    // After a reload docxB64 is absent, but docxPath is set from the
    // APPLICATION-POINTER generation (app/page.js:1617) -- which is why
    // "just clear docxB64" is not a fix: control falls straight through to
    // resolveDocumentBlob's second branch and serves the pointer generation.
    docxB64: "",
    docxPath: "user-1/generated/r2.docx",
  };
}

beforeEach(() => {
  fetchDocumentVersions.mockReset();
  fetchDocumentVersions.mockImplementation(async (_client, scope) => VERSIONS[scope] || []);
  pointApplicationAtVersion.mockReset();
  pointApplicationAtVersion.mockResolvedValue(true);
  api = null;
  latestMap = null;
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

describe("selecting an older version serves THAT version's bytes (D-1)", () => {
  it("in-session engine document: the older version's stored docx, not the newest generation's", async () => {
    await openWith(inSessionEntry());

    // Positive control. Before any switch the preview really does build the
    // newest generation's bytes -- so "the older version's bytes" below
    // cannot be the only thing this harness is capable of producing, and the
    // failure of the assertion after it is about the switch, not the fixture.
    expect(await textOf(await blobFor("resume"))).toBe(h.NEWEST_RESUME);

    await select("resume", "r1");

    // Today this is still NEWEST_RESUME: selectDocumentVersion leaves
    // entry.docxB64 untouched and docx.js:488 serves it verbatim.
    expect(await textOf(await blobFor("resume"))).toBe(h.FIRST_RESUME);
  });

  it("reloaded entry (docxPath only): the older version's stored docx, not the pointer generation's", async () => {
    await openWith(restoredEntry());

    expect(await textOf(await blobFor("resume"))).toBe(h.NEWEST_RESUME);

    await select("resume", "r1");

    expect(await textOf(await blobFor("resume"))).toBe(h.FIRST_RESUME);
  });

  it("switching back to the newest version serves the newest bytes again", async () => {
    // The switch has to be reversible, not one-way. An implementation that
    // blanked the byte source unconditionally would pass both tests above and
    // fail this one.
    await openWith(inSessionEntry());
    await select("resume", "r1");
    expect(await textOf(await blobFor("resume"))).toBe(h.FIRST_RESUME);

    await select("resume", "r2");
    expect(await textOf(await blobFor("resume"))).toBe(h.NEWEST_RESUME);
  });

  it("a resume version switch does not disturb the cover letter's bytes", async () => {
    await openWith(inSessionEntry());
    await select("resume", "r1");
    expect(await textOf(await blobFor("cover"))).toBe(h.NEWEST_COVER);
  });

  it("cover letter: stops serving the newest generation's bytes", async () => {
    // generated_cover_letters has no docx_path, so there is no stored
    // document to substitute: the cover branch clears coverLetterDocxB64 and
    // falls to the uploaded cover-letter template, or -- as here, with none
    // uploaded -- to nothing (DATA.md D-1's second consequence, D-4).
    // Continuing to hand back the newest generation's bytes for the older
    // version's text is the one outcome that must not survive.
    await openWith(inSessionEntry());

    // Positive control, as above.
    expect(await textOf(await blobFor("cover"))).toBe(h.NEWEST_COVER);

    await select("cover", "c1");

    expect(await blobFor("cover")).toBeNull();
  });

  it("a cover version switch does not disturb the resume's bytes", async () => {
    await openWith(inSessionEntry());
    await select("cover", "c1");
    expect(await textOf(await blobFor("resume"))).toBe(h.NEWEST_RESUME);
  });
});

describe("the version switch keeps the behaviour it already had", () => {
  it("shows the selected version's text and marks only that scope pristine", async () => {
    await openWith({
      ...inSessionEntry(),
      edited: { resume: true, cover: true },
    });
    await select("resume", "r1");

    const entry = latestMap[JOB_ID];
    expect(entry.result).toBe("FIRST RESUME TEXT");
    expect(entry.resultLines).toEqual(["FIRST RESUME TEXT"]);
    expect(entry.resumePreviewHtml).toBeUndefined();
    // Per-scope: selecting a resume version must never discard a hand-edited
    // cover letter's edited state.
    expect(entry.edited).toEqual({ resume: false, cover: true });
    expect(api.currentVersionId.resume).toBe("r1");
  });

  it("repoints the application row at the selected version", async () => {
    await openWith(inSessionEntry());
    await select("cover", "c1");
    expect(pointApplicationAtVersion).toHaveBeenCalledTimes(1);
    expect(pointApplicationAtVersion.mock.calls[0][1]).toEqual({
      scope: "cover",
      versionId: "c1",
      userId: "user-1",
      positionId: "pos-1",
    });
  });

  it("ignores a version id that is not in the loaded history", async () => {
    await openWith(inSessionEntry());
    await select("resume", "does-not-exist");
    expect(await textOf(await blobFor("resume"))).toBe(h.NEWEST_RESUME);
    expect(pointApplicationAtVersion).not.toHaveBeenCalled();
  });
});
