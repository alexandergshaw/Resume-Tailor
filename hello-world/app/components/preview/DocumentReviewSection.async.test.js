// @vitest-environment jsdom
//
// N103 Step 6 (4b) -- the async discipline of the review control, which can only be
// proven with a DEFERRED chokepoint: not-spammable (a double-click starts ONE
// review), the in-flight "Reviewing..." affordance that never drops focus
// (`disabled` is never set), and late-result discard (a result that resolves after
// the document changed must never render over the new document).
//
// runDocumentReview is mocked so the test controls resolution timing. The real
// behaviour of the chokepoint is covered in DocumentReviewSection.test.js.
//
// RED on HEAD: both the component and the mocked module are absent, so collection
// cannot resolve the specifier. In the reference both exist and the mock applies.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/review/runDocumentReview.js", () => ({ runDocumentReview: vi.fn() }));

import DocumentReviewSection from "./DocumentReviewSection.js";
import { runDocumentReview } from "@/lib/review/runDocumentReview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  runDocumentReview.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// `\breview` matches "Review..."/"Reviewing..." but NOT "Preview" (R-7).
const reviewButton = () => [...container.querySelectorAll("button")].find((b) => /\breview/i.test((b.textContent || "").trim()));

function outcome(title, excerpt) {
  return {
    status: "reviewed",
    draftKind: "applicationReady",
    title,
    flags: [{ category: "unverifiable-metric", spanId: "s1", draftKind: "applicationReady", message: "m", excerpt }],
    unresolvedQualifications: [],
    verdictKind: "partial",
    missingChecks: [],
    checkedChecks: ["missing-keyword", "vague-unsupported", "repetition", "unverifiable-metric"],
    engineMode: "mechanical-only",
    lineCount: 1,
    inputs: { posting: true, realMaterial: true },
  };
}

const reqA = { kind: "applicationReady", title: "Doc A", resultLines: ["Alpha line one about shipping."] };
const reqB = { kind: "applicationReady", title: "Doc B", resultLines: ["Bravo line two about scaling."] };

async function render(props) {
  await act(async () => root.render(createElement(DocumentReviewSection, props)));
}

describe("DocumentReviewSection -- not spammable (one review per double-click)", () => {
  it("two synchronous clicks start exactly ONE review; a later click still works (spy is live)", async () => {
    let resolveFirst;
    runDocumentReview.mockImplementation(() => new Promise((res) => { resolveFirst = res; }));
    await render({ surface: "modal", engine: "embedded", request: reqA });

    const btn = reviewButton();
    await act(async () => {
      btn.click();
      btn.click();
    });
    expect(runDocumentReview).toHaveBeenCalledTimes(1);

    // Positive control: once the first review finishes, a new activation runs again.
    await act(async () => resolveFirst(outcome("Doc A", "ALPHA_EXCERPT")));
    await act(async () => {
      reviewButton().click();
    });
    expect(runDocumentReview).toHaveBeenCalledTimes(2);
  });

  it("while a review is in flight the control shows 'Reviewing...' and is never `disabled` (focus is not dropped)", async () => {
    runDocumentReview.mockImplementation(() => new Promise(() => {})); // never resolves
    await render({ surface: "modal", engine: "embedded", request: reqA });
    await act(async () => {
      reviewButton().click();
    });
    const btn = reviewButton();
    expect(btn.textContent || "").toMatch(/reviewing/i);
    expect(btn.hasAttribute("disabled")).toBe(false);
  });
});

describe("DocumentReviewSection -- late result discard", () => {
  it("a result that resolves AFTER the document changed is NOT rendered over the new document", async () => {
    let resolveStale;
    runDocumentReview.mockImplementationOnce(() => new Promise((res) => { resolveStale = res; }));
    await render({ surface: "modal", engine: "embedded", request: reqA });
    await act(async () => {
      reviewButton().click();
    });

    // The document under review changes before the first review resolves.
    await render({ surface: "modal", engine: "embedded", request: reqB });

    // The stale review now resolves; its excerpt must never reach the DOM.
    await act(async () => resolveStale(outcome("Doc A", "STALE_DOCA_EXCERPT")));
    expect(container.textContent || "").not.toContain("STALE_DOCA_EXCERPT");
  });
});
