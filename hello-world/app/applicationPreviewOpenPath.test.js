// @vitest-environment jsdom
//
// N132 AC-4 (jobId, incl. synthetic app:<id>), AC-5/AC-7 (entry populated at
// open / on-demand), AC-8 (in-session content wins) + AC-6 end-to-end, for the
// page-level OPEN PATH `openApplicationPreview(app)`.
//
// WHAT THIS FILE IS -- AND IS NOT (read before trusting a green run).
// `openApplicationPreview` lives INSIDE the app/page.js default-exported
// component and is not importable, and mounting the whole page god-component
// in jsdom is impractical. So this file composes the REAL useDocumentPreview
// hook and the REAL rehydratedEntryFromApp helper EXACTLY as the plan's §6
// handler contract specifies (N132.plan.r1.md §6 / design §2.1), behind a REAL
// button a REAL click drives. It therefore proves:
//   * the §6 contract is SATISFIABLE -- a handler built to it produces the
//     right resumePreview/tailoringMap (jobId, population, precedence, tab);
//   * and, once the module + hook land, it goes green.
// It does NOT prove that page.js's actual openApplicationPreview matches §6 or
// is wired to the controls. That wiring is covered elsewhere:
//   * button -> handler prop: ApplicationCard.viewEdit / TrackingTab.viewEdit;
//   * hook opts.entry seam: useDocumentPreview.openEntry.
// The one seam no jsdom test reaches is page.js composing those three; the 4b
// report flags it for the implementer's own wiring + the browser pass.
//
// RED REASON (on HEAD): `../lib/tracking/applicationPreviewEntry.js` does not
// exist, so the import below throws and every case errors. After plan Steps
// 1-3 land, each must go green (AC-6's cover-tab case also needs the Step-2
// hook fix, since the handler writes-then-opens in one tick).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useDocumentPreview } from "./hooks/useDocumentPreview.js";
import { rehydratedEntryFromApp } from "../lib/tracking/applicationPreviewEntry.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The plan §6 handler body, verbatim. This is the CONTRACT under test, not a
// production import (see the header). If §6 changes, this changes with it.
function openApplicationPreview(app, { tailoringMap, setTailoringMap, preview }) {
  const positions = app?.positions || null;
  const jobId = positions?.external_id ? String(positions.external_id) : `app:${app?.id}`;
  const existing = tailoringMap[jobId];
  const entry = rehydratedEntryFromApp(app, { existing, fallbackTitle: positions?.title || "" });
  if (!entry) return;
  const keepExisting = !!(existing?.result || existing?.status === "tailoring");
  if (!keepExisting) setTailoringMap((cur) => ({ ...cur, [jobId]: entry }));
  const openEntry = keepExisting ? existing : entry;
  const tab = preview.previewScopeAvailable(openEntry, "resume") ? "resume" : "cover";
  preview.openResumePreview(
    {
      id: jobId,
      title: openEntry.generatedJobTitle || positions?.title || "",
      company: positions?.company || "",
      description: positions?.description || "",
      url: app.application_url || positions?.url || "",
    },
    { tab, entry: openEntry },
  );
}

let api = null;
let latestMap = null;
let container = null;
let root = null;
let research = null;

function Probe({ initialMap, app }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  latestMap = tailoringMap;
  const preview = useDocumentPreview({
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
    startBackgroundResearch: research,
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: null,
  });
  api = preview;
  return createElement(
    "button",
    {
      "data-testid": "open",
      onClick: () => openApplicationPreview(app, { tailoringMap, setTailoringMap, preview }),
    },
    "open",
  );
}

async function renderAndClick(initialMap, app) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap, app }));
  });
  await act(async () => {
    container.querySelector('[data-testid="open"]').dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  api = null;
  latestMap = null;
  research = vi.fn();
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

// ------------------------------------------------------------------ fixtures

const RESUME = { content: "Alex Shaw\nStaff Engineer", content_lines: ["Alex Shaw", "Staff Engineer"], docx_path: "resumes/r.docx" };
const COVER = { content: "Dear Hiring Manager,\nHello.", content_lines: ["Dear Hiring Manager,", "Hello."], docx_path: "covers/c.docx" };

function makeApp(overrides = {}) {
  return {
    id: "app-uuid-1",
    application_url: "https://jobs.example.com/apply/1",
    positions: { id: "pos-1", external_id: "job-ext-1", title: "Staff Engineer", company: "Acme", description: "Build.", url: "https://acme.example.com/job" },
    generated_resumes: RESUME,
    generated_cover_letters: COVER,
    ...overrides,
  };
}

// ===========================================================================
// AC-4 -- jobId resolution (real external_id vs synthetic app:<id>).
// ===========================================================================

describe("AC-4 the modal opens keyed to this app's job id", () => {
  it("external_id present => resumePreview.jobId === String(external_id)", async () => {
    await renderAndClick({}, makeApp());
    expect(api.resumePreview.open).toBe(true);
    expect(api.resumePreview.jobId).toBe("job-ext-1");
  });

  it("external_id numeric => stringified", async () => {
    await renderAndClick({}, makeApp({ positions: { id: "pos-2", external_id: 998877, title: "T", company: "C" } }));
    expect(api.resumePreview.jobId).toBe("998877");
  });

  it("external_id null => synthetic 'app:<id>' key (collision-free per app)", async () => {
    await renderAndClick({}, makeApp({ positions: { id: "pos-3", external_id: null, title: "T", company: "C" } }));
    expect(api.resumePreview.jobId).toBe("app:app-uuid-1");
  });
});

// ===========================================================================
// AC-5 / AC-7 -- the entry is populated on demand so the modal is not empty.
// ===========================================================================

describe("AC-5/AC-7 on-demand population at open", () => {
  it("resume app, map initially empty => tailoringMap[jobId] gains result/resultLines", async () => {
    await renderAndClick({}, makeApp({ generated_cover_letters: null }));
    const entry = latestMap["job-ext-1"];
    expect(entry, "no entry was written on open").toBeTruthy();
    expect(entry.result).toBe(RESUME.content);
    expect(entry.resultLines).toEqual(RESUME.content_lines);
  });

  it("cover app, map initially empty => coverLetterResultLines is non-empty", async () => {
    await renderAndClick({}, makeApp({ generated_resumes: null }));
    const entry = latestMap["job-ext-1"];
    expect(entry.coverLetterResultLines.length).toBeGreaterThan(0);
  });

  it("[control] a no-docs app is a no-op: the modal does not open and no entry is written", async () => {
    await renderAndClick({}, makeApp({ generated_resumes: null, generated_cover_letters: null }));
    expect(api.resumePreview.open).toBe(false);
    expect(latestMap["job-ext-1"]).toBeUndefined();
  });
});

// ===========================================================================
// AC-8 -- in-session content wins (never overwritten by the stored load).
// ===========================================================================

describe("AC-8 in-session content takes precedence", () => {
  it("existing.result present => the stored load does NOT overwrite it, and that content opens", async () => {
    const inSession = { status: "done", result: "IN SESSION RESUME", resultLines: ["IN SESSION RESUME"], coverLetterResultLines: [] };
    await renderAndClick({ "job-ext-1": inSession }, makeApp());
    expect(api.resumePreview.open).toBe(true);
    // Not overwritten by RESUME.content.
    expect(latestMap["job-ext-1"].result).toBe("IN SESSION RESUME");
  });

  it("status:'tailoring' (mid-generation) => not overwritten", async () => {
    const tailoring = { status: "tailoring", result: "", resultLines: [], coverLetterResultLines: [] };
    await renderAndClick({ "job-ext-1": tailoring }, makeApp());
    expect(latestMap["job-ext-1"].status).toBe("tailoring");
    expect(latestMap["job-ext-1"].result).toBe("");
  });
});

// ===========================================================================
// AC-6 (end-to-end) -- resume-if-present-else-cover through the full path.
// The cover case also exercises the Step-2 same-tick fix (write + open in one
// click tick), so it reds on HEAD both for the missing module AND, once the
// module lands, until the hook honours opts.entry.
// ===========================================================================

describe("AC-6 initial scope through the full open path", () => {
  it("resume present => opens on 'resume'", async () => {
    await renderAndClick({}, makeApp());
    expect(api.resumePreview.tab).toBe("resume");
  });

  it("cover only => opens on 'cover' same-tick", async () => {
    await renderAndClick({}, makeApp({ generated_resumes: null }));
    expect(api.resumePreview.tab).toBe("cover");
  });
});

// ===========================================================================
// BROWSER / OWNER-GATED -- not observable in jsdom. Named, and deliberately
// NOT simulated. A green run in this file is NOT evidence for any of these.
// ===========================================================================

describe.skip("AC-12 BROWSER: fidelity inherited from the shared preview path", () => {
  // jsdom cannot render parseDocxToModel output, exercise the real download,
  // or drive Drive OAuth. Covered by a visible-browser / owner pass
  // (measurement-instruments memory: the browser pane needs a visible window).
  it("the faithful .docx renders in the opened modal", () => {});
  it("the N83 live file-name applies on download from this modal", () => {});
  it("Drive save works from this modal", () => {});
  it("the N125 ideal bands render", () => {});
});

describe.skip("AC-13 BROWSER/optional: the AppViewDialog 'View/Edit' door (plan Step 6, deferrable)", () => {
  // Step 6 (the AppViewDialog onOpenPreview prop) is RECOMMENDED, not required;
  // the row control alone satisfies the owner request. If a round includes
  // Step 6: the open-path (closes AppViewDialog, opens the rich modal for the
  // same app) is jsdom-testable; the rendered docx is BROWSER. Left skipped
  // until Step 6 is in scope.
  it("from the text Resume view, View/Edit closes the dialog and opens the rich modal", () => {});
});
