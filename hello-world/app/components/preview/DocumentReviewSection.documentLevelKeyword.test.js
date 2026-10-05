// @vitest-environment jsdom
//
// N115 round 2 -- the production wiring of the R-4 count.
//
// DocumentReviewResult draws a missing-keyword flag as its own row, and it draws the
// summary reviewPresentationState hands it. The two only agree when the SECTION (the
// one place that calls reviewPresentationState for that shell) counts the way the shell
// lists. These tests click the real control over a mocked reviewer, so they fail when the
// section does not pass the opt-in, however correct the pure functions are on their own.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/review/runDocumentReview.js", () => ({ runDocumentReview: vi.fn() }));

import DocumentReviewSection from "./DocumentReviewSection.js";
import { runDocumentReview } from "@/lib/review/runDocumentReview.js";
import { CATEGORY } from "@/lib/review/contract.js";

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

const FIRST_LINE = "Shipped microservices in Go";
const keyword = (term, requirementId) => ({
  category: CATEGORY.MISSING_KEYWORD,
  spanId: "s1",
  draftKind: "applicationReady",
  message: `The posting asks for "${term}" but this draft never mentions it.`,
  excerpt: FIRST_LINE,
  evidenceRef: { origin: "posting", spanId: requirementId },
  evidenceExcerpt: `Needs ${term}.`,
});
const vague = { category: CATEGORY.VAGUE_UNSUPPORTED, spanId: "s3", draftKind: "applicationReady", message: "too vague", excerpt: "Drove impactful outcomes" };
const metric = { category: CATEGORY.UNVERIFIABLE_METRIC, spanId: "s1", draftKind: "applicationReady", message: "no baseline", excerpt: FIRST_LINE };

const reviewed = (flags) => ({
  status: "reviewed",
  draftKind: "applicationReady",
  title: "Resume",
  lineCount: 8,
  flags,
  unresolvedQualifications: [],
  verdictKind: "partial",
  missingChecks: [],
  checkedChecks: ["missing-keyword", "vague-unsupported", "repetition", "unverifiable-metric"],
  engineMode: "mechanical-only",
  inputs: { posting: true, realMaterial: true },
});

const request = { kind: "applicationReady", title: "Resume", resultLines: ["Shipped the new onboarding flow end to end."] };

async function reviewWith(flags) {
  runDocumentReview.mockResolvedValue(reviewed(flags));
  const announce = vi.fn();
  await act(async () => root.render(createElement(DocumentReviewSection, { surface: "modal", request, announce })));
  const button = [...container.querySelectorAll("button")].find((b) => /\breview/i.test((b.textContent || "").trim()));
  await act(async () => {
    button.click();
  });
  return announce;
}

const panelRows = () =>
  [...container.querySelectorAll("li")].filter((li) => [...li.children].some((child) => child.tagName === "UL"));
const number = (text, pattern) => Number(pattern.exec(text)?.[1] ?? 0);

describe("DocumentReviewSection -- summary and announcement count the rows the result lists (R-4 count)", () => {
  it("2 keywords on one span + a line flag: 3 rows, a summary that says 3, an announcement that says 3", async () => {
    const announce = await reviewWith([keyword("Kubernetes", "q1"), keyword("PCI compliance", "q2"), vague]);
    expect(panelRows()).toHaveLength(3);
    expect(number(container.textContent || "", /(\d+) suggestions?/)).toBe(3);
    expect(number(announce.mock.calls[0][0].polite, /(\d+) to check/)).toBe(3);
  });

  it("with a Confirm flag on the keywords' span: 4 rows, 1 to confirm + 3 suggestions, announced as 4", async () => {
    const announce = await reviewWith([keyword("Kubernetes", "q1"), keyword("PCI compliance", "q2"), metric, vague]);
    expect(panelRows()).toHaveLength(4);
    expect(number(container.textContent || "", /(\d+) to confirm/)).toBe(1);
    expect(number(container.textContent || "", /(\d+) suggestions?/)).toBe(3);
    expect(number(announce.mock.calls[0][0].polite, /(\d+) to check/)).toBe(4);
  });

  it("CONTROL: with no keyword flag the counts are the merged-by-span numbers they always were", async () => {
    const announce = await reviewWith([metric, vague]);
    expect(panelRows()).toHaveLength(2);
    expect(number(container.textContent || "", /(\d+) to confirm/)).toBe(1);
    expect(number(container.textContent || "", /(\d+) suggestions?/)).toBe(1);
    expect(number(announce.mock.calls[0][0].polite, /(\d+) to check/)).toBe(2);
  });
});
