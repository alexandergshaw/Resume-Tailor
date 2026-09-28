// @vitest-environment jsdom
//
// N69 (SPACING) — the two hook-level hops CB-D-3 depends on, against the REAL
// useDocumentPreview:
//   1. a setter (setDocumentSpacing) writes the whole-document spacing onto the
//      job's tailoring entry (so page.js can persist it — CB-D-3 clause i);
//   2. downloadDocumentPreview THREADS that entry.spacing into the download
//      args — the hop that, if missing, makes the control change the screen but
//      not the file (the CB-D-1 "vanishes silently" trap).
//
// This is the correct level for hop (2): CB-D-1 (docx.spacing.download.test.js)
// already proves on real bytes that downloadDocxFiles honors a `spacing` arg;
// what remains is that the preview download actually PASSES entry.spacing as
// that arg. To keep the argument assertion from passing for a wrong wiring, it
// carries a discriminator (a different entry.spacing yields a different arg) and
// a no-op control (no entry.spacing yields no override).
//
// RED-on-HEAD: `setDocumentSpacing` does not exist on the hook, and
// downloadDocumentPreview builds `args` (useDocumentPreview.js:510-542) with no
// `spacing` field.
//
// Supabase + sibling modules stubbed exactly as useDocumentPreview.download.test.js.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "pos-1" }, error: null }) }) }) }),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "n/a" } }) }) },
  }),
}));
vi.mock("../../lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => true),
}));
vi.mock("../../lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";

let api = null;
let capturedMap = null;
let container = null;
let root = null;

function Probe({ initialMap, downloadDocxFiles }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  capturedMap = tailoringMap;
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((current) => ({
        ...current,
        [jobId]: typeof updater === "function" ? updater(current[jobId] || {}) : { ...(current[jobId] || {}), ...updater },
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

async function mount(entry, downloadDocxFiles = vi.fn(async () => null)) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry }, downloadDocxFiles }));
  });
  await act(async () => {
    api.openResumePreview({ id: JOB_ID, title: "Staff Engineer", company: "Acme" });
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return downloadDocxFiles;
}

const RESUME_ENTRY = () => ({
  status: "done",
  result: "RESUME BODY",
  resultLines: ["RESUME BODY"],
  docxB64: "engine-bytes",
  coverLetterResultLines: [],
  coverLetterDocxB64: "",
  edited: { resume: false, cover: false },
});

beforeEach(() => {
  api = null;
  capturedMap = null;
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

describe("setDocumentSpacing — writes whole-document spacing onto the entry (CB-D-3 clause i, RED on HEAD: no such setter)", () => {
  it("stores the value on the active job's tailoring entry", async () => {
    await mount(RESUME_ENTRY());
    expect(typeof api.setDocumentSpacing, "hook does not expose setDocumentSpacing").toBe("function");
    await act(async () => {
      api.setDocumentSpacing("resume", { lineSpacing: 1.5, paragraphSpacingPt: 12 });
    });
    expect(capturedMap[JOB_ID].spacing).toEqual({ lineSpacing: 1.5, paragraphSpacingPt: 12 });
  });
});

describe("downloadDocumentPreview — threads entry.spacing into the download args (RED on HEAD: args carries no spacing)", () => {
  it("passes the entry's spacing to downloadDocxFiles", async () => {
    const spacing = { lineSpacing: 2, paragraphSpacingPt: 6 };
    const spy = await mount({ ...RESUME_ENTRY(), spacing });
    await act(async () => {
      await api.downloadDocumentPreview("resume", "RESUME BODY");
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].spacing).toEqual(spacing);
  });

  it("DISCRIMINATOR: a different entry.spacing yields a different arg (not a hardcoded constant)", async () => {
    const spacing = { lineSpacing: 1.15, paragraphSpacingPt: 0 };
    const spy = await mount({ ...RESUME_ENTRY(), spacing });
    await act(async () => {
      await api.downloadDocumentPreview("resume", "RESUME BODY");
    });
    expect(spy.mock.calls[0][0].spacing).toEqual(spacing);
  });

  it("NO-OP CONTROL: no entry.spacing yields no override (must survive)", async () => {
    const spy = await mount(RESUME_ENTRY());
    await act(async () => {
      await api.downloadDocumentPreview("resume", "RESUME BODY");
    });
    // Either absent or explicitly null — never a value the user did not set.
    expect(spy.mock.calls[0][0].spacing ?? null).toBe(null);
  });
});
