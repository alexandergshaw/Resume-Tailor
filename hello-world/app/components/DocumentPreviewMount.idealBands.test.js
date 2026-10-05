// @vitest-environment jsdom
//
// N105 Step 7 -- the production wiring behind the two-output surface, driven
// through the REAL DocumentPreviewMount -> DocumentPreviewDialog. The companion
// DocumentPreviewMount.idealSurface test pins the tab text, the HYPOTHETICAL
// banner and the live-region census for an entry with nothing removed; this file
// pins what only shows with rows: the Application-ready band mounted from the
// pipeline's gate output, its Copy-line action announcing through the preview's
// ONE live-region pair, the hypothetical download reaching its own bytes, the
// hypothetical previewing from its own text, and Revise / Focus / Framing staying
// off an Ideal job.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const READY = "Application-ready line one\nApplication-ready line two";
const REMOVED_TEXT = "Led a team of ten engineers across two continents.";

function idealEntry(extra = {}) {
  return {
    result: READY,
    resultLines: READY.split("\n"),
    hypotheticalDocxB64: "QkJC",
    hypotheticalFileName: "[HYPOTHETICAL] Staff Engineer - Acme",
    ideal: {
      hypothetical: { result: "Hypothetical best-case line", resultLines: ["Hypothetical best-case line"], isHypothetical: true },
      applicationReady: { result: READY, isHypothetical: false },
      review: null,
      removed: [
        { spanId: "s3", text: REMOVED_TEXT, section: "Experience", contextKey: "Acme", reasonCode: "unverified", anchor: null },
      ],
      leftOut: [{ spanId: "s4", text: "Won a national award.", reasonCode: "no-match" }],
      counts: { kept: 4, keptAccomplishments: 2, removed: 1, leftOut: 1 },
    },
    ...extra,
  };
}

function baseProps(tailoringMap, overrides = {}) {
  return {
    preview: {
      resumePreview: {
        open: true,
        title: "Staff Engineer",
        company: "Acme",
        tab: "resume",
        jobId: "job-1",
        posting: "",
        url: "",
        busy: {},
        notice: {},
        error: {},
      },
      previewScopeAvailable: vi.fn(() => true),
      loadPreviewModel: vi.fn(async () => ({ paragraphs: [] })),
      closeResumePreview: vi.fn(),
      saveDocumentPreview: vi.fn(),
      renameDocument: vi.fn(),
      resubmitDocumentPreview: vi.fn(),
      downloadDocumentPreview: vi.fn(),
      applyFocusArea: vi.fn(),
      documentVersions: {},
      currentVersionId: {},
      selectDocumentVersion: vi.fn(),
    },
    tailoringMap,
    research: { researchByJob: {}, companyResearchByJob: {}, openCompanyResearch: vi.fn() },
    chat: { askAiAbout: vi.fn() },
    tailorEngine: "embedded",
    previewReloadKey: 0,
    scrapePreviewPosting: vi.fn(),
    currentUser: { id: "user-1" },
    resumeFile: null,
    coverLetterFile: null,
    ...overrides,
  };
}

let container;
let root;
let writeText;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.clearAllMocks();
});

async function renderMount(props) {
  await act(async () => {
    root.render(createElement(DocumentPreviewMount, props));
  });
}

const buttons = () => [...document.querySelectorAll("button")];
const buttonByText = (re) => buttons().find((b) => re.test((b.textContent || "").trim()));
const tabByText = (re) => [...document.querySelectorAll('[role="tab"]')].find((t) => re.test((t.textContent || "").trim()));
const count = (selector) => document.querySelectorAll(selector).length;

async function clickTab(re) {
  const tab = tabByText(re);
  expect(tab, `a tab matching ${re} must exist`).toBeTruthy();
  await act(async () => {
    tab.click();
  });
}

describe("the Application-ready band, mounted from the pipeline's gate output", () => {
  it("shows what was removed and left out, and never reads clean (no reviewer ran)", async () => {
    await renderMount(baseProps({ "job-1": idealEntry() }));
    const body = document.body.textContent || "";
    expect(document.querySelector('section[aria-label="Application-ready resume review"]')).toBeTruthy();
    expect(body).toContain(REMOVED_TEXT);
    expect(body).toContain("Won a national award.");
    expect(body).not.toMatch(/no issues flagged/i);
    expect(body).toMatch(/partial review/i);
  });

  it("with no gate output at all it falls to the 'review did not run' state and lists nothing", async () => {
    const entry = idealEntry();
    delete entry.ideal.removed;
    delete entry.ideal.leftOut;
    delete entry.ideal.counts;
    await renderMount(baseProps({ "job-1": entry }));
    const body = document.body.textContent || "";
    expect(body).toMatch(/review did not run/i);
    expect(body).not.toContain(REMOVED_TEXT);
    expect(body).not.toMatch(/no issues flagged/i);
  });

  it("Copy line copies the removed claim and announces through the preview's own live-region pair", async () => {
    await renderMount(baseProps({ "job-1": idealEntry() }));
    const copy = buttonByText(/^Copy line$/);
    expect(copy, "a Copy line button must render for the removed row").toBeTruthy();
    await act(async () => {
      copy.click();
    });
    expect(writeText).toHaveBeenCalledWith(REMOVED_TEXT);
    const polite = document.querySelector('[data-copy-status="polite"]');
    expect(polite, "the preview's polite region must be mounted").toBeTruthy();
    expect(polite.textContent).toMatch(/copied the removed line/i);
  });

  it("mounts EXACTLY the one N95 pair whenever the review strip mounts -- ordinary AND Ideal -- and no band adds a second (N103 R-1 re-baseline)", async () => {
    // N103 R-1 (ledger-authorized edit). The N95 pair shares identical markup with
    // the always-mounted CopyFeedback region (both are role=status + data-copy-status),
    // so the pair cannot be isolated by selector. The faithful re-baseline measures
    // a STRIP-LESS baseline job (no reviewable text -> no N103 strip -> no N95 pair)
    // and asserts each reviewable render adds EXACTLY ONE pair over it.
    //
    // Teeth: the R-1 fix is that an ordinary reviewable job now mounts the pair
    // (base + 1) via the widened reviewStripMounted gate -- a build that does NOT
    // widen it leaves the ordinary render at `base` (not base+1) and reds; a
    // band-local LocalOutcome on the Ideal render makes it base+2 and reds; a
    // dropped pair makes it `base` and reds. The old relative form (Ideal =
    // ordinary + 1) now passes 0-delta and no longer bites; this is why the edit
    // is required. See N103.plan.r1.md S8 / F3.
    await renderMount(baseProps({ "job-1": {} }));
    const base = {
      polite: count('[data-copy-status="polite"]'),
      alert: count('[data-copy-status="alert"]'),
      status: count('[role="status"]'),
      roleAlert: count('[role="alert"]'),
    };

    await act(async () => {
      root.render(createElement(DocumentPreviewMount, baseProps({ "job-1": { result: "Resume text" } })));
    });
    // `\breview` matches "Review..."/"Reviewing..." but NOT "Preview" (R-7).
    expect(buttonByText(/\breview/i), "the ordinary render must mount the review strip").toBeTruthy();
    expect(count('[data-copy-status="polite"]')).toBe(base.polite + 1);
    expect(count('[data-copy-status="alert"]')).toBe(base.alert + 1);
    expect(count('[role="status"]')).toBe(base.status + 1);
    expect(count('[role="alert"]')).toBe(base.roleAlert + 1);

    await act(async () => {
      root.render(createElement(DocumentPreviewMount, baseProps({ "job-1": idealEntry() })));
    });
    // The Ideal render adds the SAME single pair and no band-local second pair.
    expect(count('[data-copy-status="polite"]')).toBe(base.polite + 1);
    expect(count('[data-copy-status="alert"]')).toBe(base.alert + 1);
    expect(count('[role="status"]')).toBe(base.status + 1);
    expect(count('[role="alert"]')).toBe(base.roleAlert + 1);
  });
});

describe("the HYPOTHETICAL tab", () => {
  it("its download button sends the hypothetical's OWN text and marked name to the download hook, with the hypothetical scope", async () => {
    const props = baseProps({ "job-1": idealEntry() });
    await renderMount(props);
    await clickTab(/hypothetical/i);
    const download = buttonByText(/download hypothetical \.docx/i);
    expect(download).toBeTruthy();
    await act(async () => {
      download.click();
    });
    expect(props.preview.downloadDocumentPreview).toHaveBeenCalledTimes(1);
    const [scope, payload] = props.preview.downloadDocumentPreview.mock.calls[0];
    expect(scope).toBe("hypothetical");
    expect(payload.text).toBe("Hypothetical best-case line");
    expect(payload.text).not.toContain("Application-ready");
    expect(payload.fileName).toMatch(/^\[HYPOTHETICAL\]/);
  });

  it("the button is disabled while a hypothetical download is in flight", async () => {
    const props = baseProps({ "job-1": idealEntry() });
    props.preview.resumePreview.busy = { hypothetical: true };
    await renderMount(props);
    await clickTab(/hypothetical/i);
    expect(buttonByText(/download hypothetical \.docx/i).disabled).toBe(true);
  });

  it("previews the hypothetical's own text, never asking the hook's loader (which would fall back to the application-ready resume)", async () => {
    const props = baseProps({ "job-1": idealEntry() });
    await renderMount(props);
    props.preview.loadPreviewModel.mockClear();
    await clickTab(/hypothetical/i);
    const body = document.body.textContent || "";
    expect(body).toContain("Hypothetical best-case line");
    expect(props.preview.loadPreviewModel).not.toHaveBeenCalledWith("hypothetical", expect.anything());
  });

  it("the Application-ready tab previews through the hook's loader as before", async () => {
    const props = baseProps({ "job-1": idealEntry() });
    await renderMount(props);
    expect(props.preview.loadPreviewModel).toHaveBeenCalled();
    expect(props.preview.loadPreviewModel.mock.calls.every(([scope]) => scope !== "hypothetical")).toBe(true);
  });

  it("Ask AI names the document as the HYPOTHETICAL one, not the candidate's record", async () => {
    const props = baseProps({ "job-1": idealEntry() });
    await renderMount(props);
    await clickTab(/hypothetical/i);
    await act(async () => {
      buttonByText(/^Ask AI$/).click();
    });
    expect(props.chat.askAiAbout).toHaveBeenCalledTimes(1);
    expect(props.chat.askAiAbout.mock.calls[0][0].label).toMatch(/HYPOTHETICAL resume \(not the candidate's real record\)/);
  });
});

describe("Revise, Focus and Framing stay off an Ideal job (UX-20)", () => {
  it("CONTROL: an ordinary entry on the embedded engine shows all three", async () => {
    await renderMount(baseProps({ "job-1": { result: "Resume text", coverLetterResultLines: ["Dear"] } }));
    expect(buttonByText(/^Revise$/)).toBeTruthy();
    expect(buttonByText(/^Focus:/)).toBeTruthy();
    expect(document.body.textContent || "").toMatch(/Framing:/);
  });

  it("an Ideal entry on the same engine shows none of them", async () => {
    await renderMount(baseProps({ "job-1": idealEntry() }));
    expect(buttonByText(/^Revise$/)).toBeFalsy();
    expect(buttonByText(/^Focus:/)).toBeFalsy();
    expect(document.body.textContent || "").not.toMatch(/Framing:/);
  });
});
