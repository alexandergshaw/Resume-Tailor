// @vitest-environment jsdom
//
// N73 crit 3 -- THE LATE PATH STILL WORKS. Moving the warm earlier for the
// candidate-initiated manual path (useManualTailor.research.test.js) must NOT
// strip the warm out of the preview-open sites. Several generation flows never
// get an early warm: the auto-tailor path (page.js handleTailorJob) and the
// feed path (page.js handleTailorFeedPosting) do not open a preview at
// generation, and a queued multi-posting run opens no per-posting modal. For
// ALL of them the ONLY thing that ever warms research is the preview-open warm
// in this hook -- openResumePreview (useDocumentPreview.js:306-313) and
// finishByOpeningPreview (:914). If a refactor "moves" the warm to generation
// and deletes these, those flows would silently never research at all.
//
// These are GUARD tests: GREEN on HEAD (the warms exist today). They are here
// to fail if N73's change removes them. Their discrimination is proven in the
// seat report by a mutant that deletes each warm. Each has a control (no cover
// -> no warm) so it also catches an over-firing warm.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => true),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";

let api = null;
let warm = null;
let container = null;
let root = null;

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((current) => ({
        ...current,
        [jobId]:
          typeof updater === "function" ? updater(current[jobId] || {}) : { ...(current[jobId] || {}), ...updater },
      })),
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: async () => null,
    startBackgroundResearch: warm,
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    // Signed out: resolvePositionId returns null before any Supabase call, so
    // loadVersionsForJob is a no-op and the harness needs no storage mock.
    currentUser: null,
  });
  return null;
}

async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap }));
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  warm = vi.fn();
  api = null;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

describe("openResumePreview keeps warming research (the late-arrival flows depend on it)", () => {
  it("warms with the job's own id and company when a cover letter exists", async () => {
    await mount({ [JOB_ID]: { coverLetterResultLines: ["Dear hiring team"], result: "R", resultLines: ["R"] } });
    await act(async () => {
      api.openResumePreview({ id: JOB_ID, company: "Acme", title: "Staff Engineer" });
    });
    await settle();
    expect(warm, "openResumePreview stopped warming research -- late-arrival flows will never research").toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0][0]).toMatchObject({ jobId: JOB_ID, company: "Acme" });
  });

  it("does not warm when the job has no cover letter (control: no over-fire)", async () => {
    await mount({ [JOB_ID]: { coverLetterResultLines: [], result: "R", resultLines: ["R"] } });
    await act(async () => {
      api.openResumePreview({ id: JOB_ID, company: "Acme", title: "Staff Engineer" });
    });
    await settle();
    expect(warm, "warmed research for a preview with no cover letter to hold the facts").not.toHaveBeenCalled();
  });
});

describe("finishByOpeningPreview keeps warming research", () => {
  it("warms with the ctx job id when the run produced a cover letter", async () => {
    await mount({});
    await act(async () => {
      api.finishByOpeningPreview({
        jobId: "job-2",
        jobTitle: "Staff Engineer",
        company: "Beta",
        posting: "posting text",
        applyCover: true,
        coverLetterResultLines: ["Dear hiring team"],
      });
    });
    await settle();
    expect(warm, "finishByOpeningPreview stopped warming research").toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0][0]).toMatchObject({ jobId: "job-2", company: "Beta" });
  });

  it("does not warm when the run produced no cover letter (control)", async () => {
    await mount({});
    await act(async () => {
      api.finishByOpeningPreview({
        jobId: "job-2",
        jobTitle: "Staff Engineer",
        company: "Beta",
        posting: "posting text",
        applyCover: true,
        coverLetterResultLines: [],
      });
    });
    await settle();
    expect(warm, "warmed research with no cover letter produced").not.toHaveBeenCalled();
  });
});
