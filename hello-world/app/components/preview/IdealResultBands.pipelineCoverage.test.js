// @vitest-environment jsdom
//
// N105 AC-17 (consumer presentation) - a result whose review is not complete is
// never shown as clean, end to end.
//
// IdealResultBands.verdict.test.js pins this on hand-built reviews. What it cannot
// see is whether the review the REAL pipeline produces, carried through the REAL
// surface join, reads as partial: a hand-built `complete: false` is the test's own
// claim, while this run's `complete: false` comes from the reviewer. It also uses
// the hardest case for the rule, the one where everything else about the result
// looks perfect: the gate kept every line, removed nothing, left nothing out, and
// the reviewer raised no flag. Only `coverage.complete` stands between that result
// and "No issues flagged".
//
// Chain: runIdealPipeline (stub engine, live mechanical reviewer) -> idealSurfaceFor
// (the join the preview uses) -> <IdealResultBands /> and idealBandState.
//
// POSITIVE CONTROL: the same result with only the coverage swapped for a complete
// one renders the clean verdict, so the phrases being absent above is the rule at
// work and not a band that can no longer say them.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import IdealResultBands from "./IdealResultBands.js";
import { runIdealPipeline } from "@/lib/llm/ideal/idealPipeline.js";
import { idealSurfaceFor } from "@/lib/tailor/idealSurface.js";
import { BAND_COPY, idealBandState } from "@/lib/tailor/idealBandState.js";
import { CATEGORY } from "@/lib/review/contract.js";
import { buildIdealRealMaterial } from "@/app/api/tailor/idealRealMaterial.js";
import { EXAMPLE_RESUME_TEXT } from "@/lib/llm/ideal/__fixtures__/examplePair.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The clean-verdict phrases (UX 5.8 P1); none may appear in the band's chrome
// unless the one licensed combination holds.
const FORBIDDEN = [
  /no issues flagged/i,
  /no weaknesses/i,
  /nothing (was )?(flagged|found)/i,
  /found nothing/i,
  /no (problems|concerns|issues)\b/i,
  /all clear/i,
  /looks good/i,
  /passed/i,
  /\bverified\b/i,
  /safe to send/i,
];

// A result with nothing to report: every line is the user's own, no metric, no
// posting requirement to miss, and the hypothetical is the same document.
const LINES = [
  "Jordan Rivera",
  "jordan.rivera@example.com",
  "",
  "PROFESSIONAL EXPERIENCE",
  "Brightwave Systems — Software Engineer (Mar 2020 - Present)",
  "Wrote the on-call runbook for the billing database",
  "",
  "EDUCATION",
  "Lakeview University — B.S. Computer Science (2013-2017)",
];

const engine = {
  name: "gemini",
  supportsIdeal: true,
  async tailorIdeal() {
    const draft = { result: LINES.join("\n"), resultLines: LINES, jobTitle: "Payments Platform Engineer", companyName: "Northwind Commerce" };
    return {
      postingAnalysis: { requirements: [] },
      keywordMap: { entries: [] },
      hypothetical: draft,
      applicationReadyCandidate: draft,
    };
  },
};

const ALL_SEVEN = Object.values(CATEGORY);
const COMPLETE_COVERAGE = { complete: true, engineMode: "full", evaluatedCategories: ALL_SEVEN };

let surface;
beforeAll(async () => {
  const out = await runIdealPipeline({
    engine,
    args: { jobPosting: "A payments role.", resumeText: EXAMPLE_RESUME_TEXT },
    realMaterial: buildIdealRealMaterial(EXAMPLE_RESUME_TEXT),
  });
  surface = idealSurfaceFor({ result: out.result, ideal: out.ideal }, { title: "Payments Platform Engineer", company: "Northwind Commerce" });
});

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
});

async function renderBand(ideal) {
  await act(async () => {
    root.render(createElement(IdealResultBands, { ideal, currentText: surface.currentText, handEdited: surface.handEdited }));
  });
  return container.textContent || "";
}

const stateOf = (ideal) => idealBandState({ ideal, currentText: surface.currentText, handEdited: surface.handEdited });
const withCoverage = (coverage) => ({ ...surface.ideal, review: { ...surface.ideal.review, coverage } });

describe("AC-17 - the pipeline's own review, joined for the preview, is never read as clean", () => {
  it("PRECONDITION: the result has nothing to report except that its review is not complete", () => {
    const review = surface.ideal.review;
    expect(review.flags).toEqual([]);
    expect(review.unresolvedQualifications).toEqual([]);
    expect(review.removed).toEqual([]);
    expect(review.leftOut).toEqual([]);
    expect(review.counts.keptAccomplishments).toBeGreaterThan(0);
    expect(surface.handEdited).toBe(false);
    expect(review.coverage.complete).toBe(false);
  });

  it("the band state is not clean and says the review was partial", () => {
    const state = stateOf(surface.ideal);
    expect(state.verdictClean).toBe(false);
    expect(state.review).toBe("partial");
    expect(state.headline).toBe(BAND_COPY.partial);
  });

  it("the rendered band carries the partial headline and no clean-verdict phrase", async () => {
    const text = await renderBand(surface.ideal);
    expect(text).toContain("Partial review - mechanical checks only");
    for (const re of FORBIDDEN) expect(text, `partial band must not match ${re}`).not.toMatch(re);
  });

  it("complete:false vetoes the verdict on its own: even with all seven categories listed", async () => {
    const ideal = withCoverage({ complete: false, engineMode: "full", evaluatedCategories: ALL_SEVEN });
    expect(stateOf(ideal).verdictClean).toBe(false);
    const text = await renderBand(ideal);
    for (const re of FORBIDDEN) expect(text, `complete:false band must not match ${re}`).not.toMatch(re);
  });

  it("a coverage that is missing or unusable is partial too, never clean", async () => {
    for (const coverage of [undefined, null, {}, { complete: false }, { evaluatedCategories: ALL_SEVEN }]) {
      const ideal = withCoverage(coverage);
      expect(stateOf(ideal).verdictClean, JSON.stringify(coverage)).toBe(false);
      const text = await renderBand(ideal);
      for (const re of FORBIDDEN) expect(text, `${JSON.stringify(coverage)} must not match ${re}`).not.toMatch(re);
    }
  });

  it("POSITIVE CONTROL: the same result with a complete coverage IS the clean verdict", async () => {
    const ideal = withCoverage(COMPLETE_COVERAGE);
    expect(stateOf(ideal).verdictClean).toBe(true);
    expect(await renderBand(ideal)).toMatch(/no issues flagged/i);
  });
});
