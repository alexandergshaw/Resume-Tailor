// @vitest-environment jsdom
//
// N103 Step 5 (4b) -- the thin result shell DocumentReviewResult. It composes the
// subject header (title + lineCount), the presentation notice (from S4) and the
// REUSED ReviewFlagsPanel. It owns NO label table, NO tier logic, NO blockquote
// flag renderer (AC-7/AC-8) -- a flag row's label and group title must be exactly
// the ones flagPresentation produces, which a bespoke panel would not reproduce.
//
// Contract assumed by this test (the 4b hand-off fixes it):
//   <DocumentReviewResult outcome={ReviewOutcome} presentation={S4 output} />
//
// RED on HEAD: the component does not exist. Satisfiability is proven against the
// scratchpad reference.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DocumentReviewResult from "./DocumentReviewResult.js";
import { presentFlag, PANEL_COPY } from "@/lib/review/flagPresentation";
import { CATEGORY } from "@/lib/review/contract";

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
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const EXCERPT = "Improved performance by 300% across the org.";

function reviewedOutcome() {
  return {
    status: "reviewed",
    draftKind: "applicationReady",
    title: "Resume",
    lineCount: 8,
    flags: [{ category: CATEGORY.UNVERIFIABLE_METRIC, spanId: "s1", draftKind: "applicationReady", message: "The figure \"300%\" has no baseline.", excerpt: EXCERPT }],
    unresolvedQualifications: [],
    verdictKind: "partial",
    missingChecks: [],
    checkedChecks: [],
    engineMode: "mechanical-only",
    inputs: { posting: true, realMaterial: true },
  };
}

const PRESENTATION = {
  state: "partial",
  headline: "Partial review - mechanical checks only.",
  notice: { checked: ["figures with no baseline"], notChecked: ["role and seniority claims"], sentences: [] },
  footer: "These notes are for this session only and change nothing in your document.",
  announce: "Review finished. 1 to check. Partial review: some checks did not run.",
};

async function render(props) {
  await act(async () => root.render(createElement(DocumentReviewResult, props)));
}

describe("DocumentReviewResult -- reuses ReviewFlagsPanel's vocabulary (AC-7)", () => {
  it("renders a flag row with the STABLE flagPresentation label and tier group title", async () => {
    await render({ outcome: reviewedOutcome(), presentation: PRESENTATION });
    const body = document.body.textContent || "";
    // The label comes from the registry, not a local table.
    expect(body).toContain(presentFlag("applicationReady", CATEGORY.UNVERIFIABLE_METRIC).label);
    // ...sitting under the shared group title.
    expect(body).toContain(PANEL_COPY.confirmTitle);
  });

  it("quotes the offending line in a [data-quoted] node (the panel's quoting convention)", async () => {
    await render({ outcome: reviewedOutcome(), presentation: PRESENTATION });
    const quoted = [...document.querySelectorAll("[data-quoted]")].map((n) => n.textContent || "");
    expect(quoted.some((t) => t.includes(EXCERPT))).toBe(true);
  });

  it("names the subject and its line count in the header", async () => {
    await render({ outcome: reviewedOutcome(), presentation: PRESENTATION });
    const body = document.body.textContent || "";
    expect(body).toMatch(/8\s*lines?/i);
  });

  it("shows the partial headline, never a reassuring verdict", async () => {
    await render({ outcome: reviewedOutcome(), presentation: PRESENTATION });
    const body = document.body.textContent || "";
    expect(body).toMatch(/partial review/i);
    expect(body).not.toMatch(/no issues flagged/i);
  });
});
