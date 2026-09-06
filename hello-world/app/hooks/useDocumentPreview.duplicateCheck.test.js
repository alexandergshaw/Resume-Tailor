// @vitest-environment jsdom
//
// Adversarial review of the duplicate-application wiring (W3B) found a real
// miss: useDocumentPreview.js's resubmitDocumentPreview (the preview
// dialog's "Revise" / focus-change re-tailor) issues a full paid
// /api/tailor call with no duplicate-application check at all, and it is
// reachable with no PRIOR check having run this session -- trackedJobs
// rehydrates from localStorage (app/page.js:469), so a chip tailored in a
// previous session survives a reload straight into an unchecked Revise.
//
// This mirrors app/hooks/useManualTailor.test.js's own
// "onCheckDuplicate" describe block: `onCheckDuplicate` is a plain,
// OPAQUE callback prop (page.js hands it dupeApply.runDuplicateCheck, but
// this hook has no opinion about what it does), fired through
// lib/tailor/duplicateCheckFire.js's fireDuplicateCheckSafely rather than
// inlined a second time here (useDocumentPreview.js has essentially no line
// budget left -- lib/drive/lineCeiling.test.js pins it under 935 lines).
//
// UNLIKE useManualTailor's manual-paste pipeline (which must wait for the
// response before it knows the company), this fire point knows the job's
// title/company/posting BEFORE the paid call -- it's an existing tracked
// job already open in the preview -- so it fires before `fetch`, not after.

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
    warnings: [],
    ...overrides,
  };
}

// Records call order across both the check and the network, so the "fires
// BEFORE the paid call" half of the requirement is actually observed, not
// just assumed from the two calls individually succeeding.
let callOrder = [];

function mockFetchOnce(payload) {
  globalThis.fetch = vi.fn(async () => {
    callOrder.push("fetch");
    return { ok: true, json: async () => payload };
  });
}

let api = null;
let container = null;
let root = null;

function Probe({ initialMap, onCheckDuplicate }) {
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
    onCheckDuplicate,
  });
  return null;
}

async function mount(onCheckDuplicate) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: {} }, onCheckDuplicate }));
  });
}

async function openPreview() {
  await act(async () => {
    api.openResumePreview({
      id: JOB_ID,
      title: "Staff Engineer",
      company: "Acme",
      description: "Some job posting text.",
    });
  });
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
  callOrder = [];
  mockFetchOnce(okPayload());
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

describe("resubmitDocumentPreview -- the duplicate-application check (onCheckDuplicate)", () => {
  it("is called with the candidate (title/company already known) and a jobId/entryPoint context, BEFORE the request is sent", async () => {
    const onCheckDuplicate = vi.fn(() => callOrder.push("check"));
    await mount(onCheckDuplicate);
    await openPreview();
    await resubmit("resume", "make it punchier");

    expect(onCheckDuplicate).toHaveBeenCalledTimes(1);
    const [candidate, ctx] = onCheckDuplicate.mock.calls[0];
    expect(candidate).toMatchObject({
      id: JOB_ID,
      title: "Staff Engineer",
      company: "Acme",
      description: "Some job posting text.",
    });
    expect(ctx).toMatchObject({ jobId: JOB_ID, entryPoint: "revise" });

    // The defining property this wave's review found missing: unlike
    // useManualTailor (which must wait for the response to know the
    // company), this fire point already knows everything it needs before
    // the network call, so it must not wait for the response either.
    expect(callOrder).toEqual(["check", "fetch"]);
  });

  it("fires on a focus-change re-tailor too, not only a plain revise", async () => {
    const onCheckDuplicate = vi.fn();
    await mount(onCheckDuplicate);
    await openPreview();
    await resubmit("resume", "", { focusArea: "Data Science" });
    expect(onCheckDuplicate).toHaveBeenCalledTimes(1);
  });

  it("does not fire when an entry guard rejects the revise before it starts (no posting/url, no resume file)", async () => {
    const onCheckDuplicate = vi.fn();
    await mount(onCheckDuplicate);
    // No openPreview() -- resumePreview.jobId is still null, so the
    // `!jobId` guard rejects this before any fire point is reached.
    const result = await resubmit("resume", "make it punchier");
    expect(result).toBe(false);
    expect(onCheckDuplicate).not.toHaveBeenCalled();
  });

  it("a throwing onCheckDuplicate does not abort the revise -- the paid call still fires and the result is still ok", async () => {
    const onCheckDuplicate = vi.fn(() => {
      throw new Error("duplicate check exploded");
    });
    await mount(onCheckDuplicate);
    await openPreview();
    const result = await resubmit("resume", "make it punchier");
    expect(result).toBe(true);
    expect(callOrder).toContain("fetch");
  });

  it("is optional -- omitting it entirely does not break the pipeline", async () => {
    await mount(undefined);
    await openPreview();
    const result = await resubmit("resume", "make it punchier");
    expect(result).toBe(true);
  });
});
