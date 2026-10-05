// @vitest-environment jsdom
//
// N103 Step 8 (implementer additions) -- the review strip next to the N105 band, and
// the inputs the mount gives it, through the REAL DocumentPreviewMount ->
// DocumentPreviewDialog:
//   * no double verdict: on an Ideal job's Application-ready tab whose band shows a
//     live reviewer result for exactly this text, activating Review says so and
//     shows no second flag list; once the text is hand-edited (the band no longer
//     covers it) the full review runs on what is on screen;
//   * the strip stacks BELOW the band and never sits inside it;
//   * the HYPOTHETICAL tab gets the strip too, as a hypothetical (the band never
//     reviews that draft);
//   * the cover tab gets the strip, and the email tab never does;
//   * the uploaded resume is read lazily, only when Review is activated.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { buildTemplateLinesForUpload } from "../../lib/document/docx";

// Only the resume reader is stubbed (a real .docx needs real bytes); everything else
// in the module is the real one.
vi.mock("../../lib/document/docx", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildTemplateLinesForUpload: vi.fn(async () => [
      "VP of Platform, Acme (2018-2023)",
      "Scaled a 300-person engineering organization as VP of Platform.",
    ]),
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const READY = "Application-ready line one\nApplication-ready line two";
const FLOOR = ["missing-keyword", "vague-unsupported", "repetition", "unverifiable-metric"];

function idealEntry(extra = {}, ideal = {}) {
  return {
    result: READY,
    resultLines: READY.split("\n"),
    hypotheticalFileName: "[HYPOTHETICAL] Staff Engineer - Acme",
    ideal: {
      hypothetical: { result: "Scaled the org by 900%.", resultLines: ["Scaled the org by 900%."], isHypothetical: true },
      applicationReady: { result: READY, isHypothetical: false },
      review: {
        flags: [],
        unresolvedQualifications: [],
        removed: [],
        leftOut: [],
        counts: { kept: 2, keptAccomplishments: 2, removed: 0, leftOut: 0 },
        coverage: { engineMode: "mechanical-only", complete: false, evaluatedCategories: FLOOR },
      },
      removed: [],
      leftOut: [],
      counts: { kept: 2, keptAccomplishments: 2, removed: 0, leftOut: 0 },
      ...ideal,
    },
    ...extra,
  };
}

function baseProps(tailoringMap, overrides = {}) {
  return {
    preview: {
      resumePreview: { open: true, title: "Staff Engineer", company: "Acme", tab: "resume", jobId: "job-1", posting: "", url: "", busy: {}, notice: {}, error: {} },
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

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderMount(props) {
  await act(async () => root.render(createElement(DocumentPreviewMount, props)));
}

const buttons = () => [...document.querySelectorAll("button")];
const reviewButton = () => buttons().find((b) => /\breview/i.test((b.textContent || "").trim()) && !/partial review/i.test(b.textContent || ""));
const tabByText = (re) => [...document.querySelectorAll('[role="tab"]')].find((t) => re.test((t.textContent || "").trim()));
const quoted = () => [...document.querySelectorAll("[data-quoted]")].map((n) => n.textContent || "");

async function clickReview() {
  const btn = reviewButton();
  expect(btn, "a review control must be reachable").toBeTruthy();
  await act(async () => {
    btn.click();
  });
}

describe("no double verdict on an Ideal job (the band already shows a live review)", () => {
  it("a fresh Application-ready tab answers 'already covered' and runs no second review", async () => {
    await renderMount(baseProps({ "job-1": idealEntry() }));
    await clickReview();
    const body = document.body.textContent || "";
    expect(body).toMatch(/already covers this text/i);
    expect(quoted()).toEqual([]);
  });

  it("once the resume is hand-edited the band no longer covers it, so the full review runs on the text on screen", async () => {
    await renderMount(baseProps({ "job-1": idealEntry({ result: "Improved revenue by 400% across the org.", resultLines: ["Improved revenue by 400% across the org."], edited: { resume: true } }) }));
    await clickReview();
    expect(document.body.textContent || "").not.toMatch(/already covers this text/i);
    expect(quoted().some((t) => t.includes("400%"))).toBe(true);
  });
});

describe("where the strip sits and which tabs get one", () => {
  it("the strip is a sibling AFTER the band's section, never inside it", async () => {
    await renderMount(baseProps({ "job-1": idealEntry() }));
    const band = document.querySelector('section[aria-label="Application-ready resume review"]');
    const strip = reviewButton().closest("section");
    expect(band).toBeTruthy();
    expect(strip).toBeTruthy();
    expect(band.contains(strip)).toBe(false);
    // querySelectorAll answers in document order, so a later index is a later node.
    const sections = [...document.querySelectorAll("section")];
    expect(sections.indexOf(strip)).toBeGreaterThan(sections.indexOf(band));
  });

  it("the HYPOTHETICAL tab gets the strip, reviewed as a hypothetical (Unsourced figure, not Figure cannot be checked)", async () => {
    await renderMount(baseProps({ "job-1": idealEntry() }));
    await act(async () => {
      tabByText(/hypothetical/i).click();
    });
    await clickReview();
    const body = document.body.textContent || "";
    expect(body).toContain("Unsourced figure");
    expect(body).not.toContain("Figure cannot be checked");
    expect(quoted().some((t) => t.includes("900%"))).toBe(true);
  });

  it("the cover tab gets a strip, and the email tab never does", async () => {
    await renderMount(baseProps({ "job-1": { result: "Resume text", coverLetterResultLines: ["Dear team,", "I grew revenue by 250%."], hiringEmail: "x" } }));
    await act(async () => {
      tabByText(/cover letter/i).click();
    });
    await clickReview();
    expect(quoted().some((t) => t.includes("250%"))).toBe(true);
    await act(async () => {
      tabByText(/hiring email/i).click();
    });
    expect(reviewButton()).toBeUndefined();
  });
});

describe("the uploaded resume is the strip's real material (read on activation)", () => {
  const CLAIM = "Scaled a 300-person engineering organization as VP of Platform.";
  const tailoring = { "job-1": { result: CLAIM, resultLines: [CLAIM] } };

  it("with the file the claim it supports is NOT flagged, and the result does not say the material was missing", async () => {
    await renderMount(baseProps(tailoring, { resumeFile: { name: "resume.docx" } }));
    expect(buildTemplateLinesForUpload).not.toHaveBeenCalled();
    await clickReview();
    expect(buildTemplateLinesForUpload).toHaveBeenCalledTimes(1);
    const body = document.body.textContent || "";
    expect(body).not.toMatch(/uploaded resume was not available/i);
    expect(body).not.toContain("Role or seniority not in your resume");
  });

  it("CONTROL: without a file the same claim IS flagged and the result names the missing material", async () => {
    await renderMount(baseProps(tailoring, { resumeFile: null }));
    await clickReview();
    const body = document.body.textContent || "";
    expect(body).toMatch(/uploaded resume was not available/i);
    expect(body).toContain("Role or seniority not in your resume");
  });
});
