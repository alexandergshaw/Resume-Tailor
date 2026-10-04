// @vitest-environment jsdom
//
// N105 Step 7 -- the two-output preview surface, driven through the REAL
// DocumentPreviewMount -> DocumentPreviewDialog (the production render path). The
// landed DocumentPreviewMount.visibleScopes test already pins that the Ideal
// tab APPEARS and the phantom tab does NOT; this file lands RED the deferred
// render rows that still do not exist: the unmistakable HYPOTHETICAL banner /
// marker surfaces (M1-M4), the literal tab text ("Application-ready" /
// "HYPOTHETICAL"), and the live-region census (UX-40).
//
// Reachability: the hypothetical surface is reached the way a user reaches it --
// render the mount with an Ideal entry, then CLICK the real hypothetical tab.
// No direct import of the (not-yet-existent) band/banner leaf.
//
// RED reasons at HEAD: the mount builds no `scopes.hypothetical` content and
// passes no result band, so clicking the hypothetical tab shows no banner; the
// tab text is still SCOPE_LABEL ("Resume" / "Hypothetical resume"), not the
// marker vocabulary.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IDEAL_ENTRY = {
  "job-1": {
    result: "Application-ready line one\nApplication-ready line two",
    resultLines: ["Application-ready line one", "Application-ready line two"],
    hypotheticalDocxB64: "QkJC",
    hypotheticalFileName: "[HYPOTHETICAL] Staff Engineer - Acme",
    ideal: {
      hypothetical: { result: "Hypothetical best-case line", isHypothetical: true },
      applicationReady: { result: "Application-ready line one\nApplication-ready line two", isHypothetical: false },
      review: null,
    },
  },
};
const ORDINARY_ENTRY = { "job-1": { result: "Resume text", coverLetterResultLines: ["Dear"] } };

function baseProps(tailoringMap) {
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
  };
}

let container;
let root;

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
  vi.clearAllMocks();
});

async function renderMount(tailoringMap) {
  await act(async () => {
    root.render(createElement(DocumentPreviewMount, baseProps(tailoringMap)));
  });
}

// MUI Dialog + Tabs portal to document.body.
const tabs = () => [...document.querySelectorAll('[role="tab"]')];
const tabLabels = () => tabs().map((t) => (t.textContent || "").trim());

async function clickTab(matcher) {
  const tab = tabs().find((t) => matcher.test((t.textContent || "").trim()));
  expect(tab, `a tab matching ${matcher} must exist`).toBeTruthy();
  await act(async () => {
    tab.click();
  });
}

describe("N105 Step 7 -- tab text is the marker vocabulary", () => {
  it("an Ideal result labels the resume tab 'Application-ready' and the last tab 'HYPOTHETICAL'", async () => {
    await renderMount(IDEAL_ENTRY);
    const labels = tabLabels();
    // RED at HEAD: labels are ["Resume","Cover letter","Hiring email","Hypothetical resume (none)"].
    expect(labels[0]).toMatch(/application-ready/i);
    expect(labels[labels.length - 1]).toBe("HYPOTHETICAL");
  });
});

describe("N105 Step 7 -- the HYPOTHETICAL banner / marker surfaces", () => {
  it("clicking the hypothetical tab shows a non-dismissible 'HYPOTHETICAL - not for submission' banner whose file name begins with the token", async () => {
    await renderMount(IDEAL_ENTRY);
    await clickTab(/hypothetical/i);

    const body = document.body.textContent || "";
    // M2 banner title (C14). RED at HEAD: no banner is rendered at all.
    expect(body).toMatch(/HYPOTHETICAL\s*[-–—]\s*not for submission/i);
    // M4 bespoke download button text.
    const downloadBtn = [...document.querySelectorAll("button")].find((b) =>
      /download hypothetical \.docx/i.test((b.textContent || "").trim()),
    );
    expect(downloadBtn, "a 'Download hypothetical .docx' button must render in the band").toBeTruthy();

    // M3 the read-only file name, BEGINNING with the token (OC-3 / D-8 prefix).
    expect(body).toMatch(/\[?HYPOTHETICAL\]?\s*Staff Engineer/);

    // Non-dismissible, non-collapsible: no control inside the banner closes/hides
    // it. Find the title by EXACT text (so a wrapper that merely contains the
    // title is not mistaken for the banner), then scope to its own region.
    const titleNode = [...document.querySelectorAll("*")].find((n) =>
      /^HYPOTHETICAL\s*[-–—]\s*not for submission$/i.test((n.textContent || "").trim()),
    );
    expect(titleNode, "the banner title node must exist").toBeTruthy();
    const bannerRegion = titleNode.closest('[role="region"], [role="note"], section') || titleNode.parentElement;
    const dismissers = [...bannerRegion.querySelectorAll("button")].filter((b) =>
      /dismiss|close|collapse|hide|got it/i.test(
        `${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`,
      ),
    );
    expect(dismissers).toEqual([]);
  });

  it("NEGATIVE CONTROL: on the Application-ready (resume) tab no HYPOTHETICAL banner or download is shown", async () => {
    // Control for the row above: proves the banner is scoped to the hypothetical
    // tab, not emitted on every tab. (Green at HEAD because no banner exists
    // anywhere; load-bearing once the banner is built.)
    await renderMount(IDEAL_ENTRY);
    // default tab is the application-ready/resume tab
    const body = document.body.textContent || "";
    expect(body).not.toMatch(/not for submission/i);
    const hypDownload = [...document.querySelectorAll("button")].some((b) =>
      /download hypothetical \.docx/i.test((b.textContent || "").trim()),
    );
    expect(hypDownload).toBe(false);
  });

  it("NO-PHANTOM (render level): an ordinary level 1-5 entry shows no hypothetical tab and no banner", async () => {
    await renderMount(ORDINARY_ENTRY);
    expect(tabLabels().filter((l) => /hypothetical/i.test(l))).toEqual([]);
    expect(document.body.textContent || "").not.toMatch(/not for submission/i);
  });
});

describe("N105 Step 7 -- UX-40 live-region census", () => {
  it("the Ideal surface adds no duplicate role=status pair beyond the ordinary preview", async () => {
    // GUARD / control. The dialog's FIRST [role=status]/[role=alert] belong to
    // DriveResultRegion (landed invariant); the N95 pair is reused, not doubled.
    // Green at HEAD (no band yet); load-bearing once the band mounts -- a mutant
    // that gives the band its own role=status/aria-live node reds this.
    await renderMount(ORDINARY_ENTRY);
    const ordinaryStatus = document.querySelectorAll('[role="status"]').length;
    const ordinaryAlert = document.querySelectorAll('[role="alert"]').length;

    await act(async () => {
      root.render(createElement(DocumentPreviewMount, baseProps(IDEAL_ENTRY)));
    });
    await clickTab(/hypothetical/i);

    expect(document.querySelectorAll('[role="status"]').length).toBe(ordinaryStatus);
    expect(document.querySelectorAll('[role="alert"]').length).toBe(ordinaryAlert);
  });
});
