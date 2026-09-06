// @vitest-environment jsdom
//
// DEFECT 2: /api/tailor's `warnings` array (engine-fallback notices,
// embedded-engine degradations like an unmatched focus area or an unparsed
// steering note, applied recurring edits, a non-technical-role hint,
// project-pages truncation) reaches no client. resubmitDocumentPreview
// already read ONE narrow slice of it -- a single regex match for the
// literal substring "focus area", and only stitched that into the notice on
// a focus-CHANGE re-tailor. Every other warning shape, and even that same
// focus-area warning on a PLAIN revise (no focus change), was silently
// dropped -- an unparsed steering note in particular leaves the user with a
// "Revised..." success notice and a résumé that didn't actually change.
//
// This mirrors app/hooks/useManualTailor.test.js's DEFECT 2 tests: the fix
// generalizes the existing narrow read into the full array, combined into
// the SAME notice channel the dialog already renders
// (DocumentPreviewMount.js: notice={preview.resumePreview.notice}), not a
// new surface.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../lib/document/docx", () => ({
  buildTemplateLinesForUpload: vi.fn(async () => ["line one", "line two"]),
}));
vi.mock("../../lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  })),
}));
vi.mock("../../lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(async () => []),
  pointApplicationAtVersion: vi.fn(async () => undefined),
}));
vi.mock("../../lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const RESUME = new File(["resume bytes"], "resume.docx", {
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

// What /api/tailor actually resolves with on a good revise run.
function okPayload(overrides) {
  return {
    result: "REVISED RESUME TEXT",
    resultLines: ["REVISED RESUME TEXT"],
    jobTitle: "Staff Engineer",
    coverLetterResultLines: [],
    coverLetterResult: "",
    coverLetterError: "",
    coverLetterDocxB64: "",
    docxB64: "",
    report: null,
    coverVariant: null,
    ...overrides,
  };
}

function mockFetchOnce(payload) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => payload }));
}

let api = null;
let container = null;
let root = null;

// currentUser: null keeps this focused on the notice-building contract --
// position lookup / version history / persistence all short-circuit on "no
// signed-in user" (see resolvePositionId), so no further Supabase wiring is
// needed to observe resubmitDocumentPreview's return value and notice.
function Probe({ initialMap }) {
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
    resumeFile: RESUME,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: vi.fn(),
    startBackgroundResearch: vi.fn(),
    setPreviewReloadKey: vi.fn(),
    onDocumentEdited: vi.fn(),
    currentUser: null,
  });
  return null;
}

async function mount(entry) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry || {} } }));
  });
}

async function openPreview(posting) {
  await act(async () => {
    api.openResumePreview({ id: JOB_ID, title: "Staff Engineer", company: "Acme", description: posting });
  });
  // loadVersionsForJob is fire-and-forget; let it settle (same pattern as
  // useDocumentPreview.wiring.test.js / .download.test.js).
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function resubmit(scope, instructions, opts) {
  let result;
  await act(async () => {
    result = await api.resubmitDocumentPreview(scope, instructions, opts);
  });
  return result;
}

beforeEach(() => {
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

describe("resubmitDocumentPreview -- surfacing /api/tailor's warnings (DEFECT 2)", () => {
  it("surfaces an engine warning on a plain revise, not just a focus change", async () => {
    mockFetchOnce(
      okPayload({
        warnings: [
          "The embedded engine applies revision notes as emphasize/avoid/aggressiveness directives, and couldn't find any in your note.",
        ],
      }),
    );
    await mount();
    await openPreview("Some job posting text.");
    const ok = await resubmit("resume", "make it punchier");
    expect(ok).toBe(true);
    expect(api.resumePreview.notice.resume).toContain("couldn't find any in your note");
  });

  it("shows the base revise notice alongside the warning, not instead of it", async () => {
    mockFetchOnce(okPayload({ warnings: ["Some engine warning."] }));
    await mount();
    await openPreview("Some job posting text.");
    await resubmit("resume", "make it punchier");
    expect(api.resumePreview.notice.resume).toContain("Revised the resume");
    expect(api.resumePreview.notice.resume).toContain("Some engine warning.");
  });

  it("surfaces a non-focus-area warning on a focus-change re-tailor too", async () => {
    mockFetchOnce(okPayload({ warnings: ['Applied your recurring edit: "foo" → "bar".'] }));
    await mount();
    await openPreview("Some job posting text.");
    await resubmit("resume", "", { focusArea: "Data Science" });
    expect(api.resumePreview.notice.resume).toContain("Applied your recurring edit");
  });

  it("stays silent when the engine reports no warnings", async () => {
    mockFetchOnce(okPayload({ warnings: [] }));
    await mount();
    await openPreview("Some job posting text.");
    await resubmit("resume", "make it punchier");
    expect(api.resumePreview.notice.resume).toBe("Revised the resume with your instructions.");
  });
});
