// N105 Step 9 (4b) -- wiring the LIVE reviewer (N106, lib/review/) into the Ideal
// pipeline. Slice 1 injects NO LLM judge, so the live review is the deterministic
// mechanical floor: honest-partial, never clean.
//
// Binds to: Step 9 scope -- reviewDocuments on the two drafts; review:null is
// replaced by a live result carrying coverage; spanTexts (id->excerpt) populated
// for the idealSurface excerpt resolver; K2 carryover (review is advisory, the
// emitted application-ready bytes stay KEPT-only); mechanical-only honesty
// (engineMode "mechanical-only", complete:false); determinism / no network.
//
// WHY THESE ARE POWER ROWS.
//   * review-not-null + well-formed: the one line Step 9 replaces (review:null).
//   * no-overclaim: a mechanical-only slice can never report complete:true
//     (N106 AC-3/AC-17). A judge-less run that claims completeness is a lie the
//     band would render as a clean verdict.
//   * kept-only carryover (K2): the live review is panel-only. It must NOT
//     re-admit a flagged/dropped span into the EMITTED application-ready bytes.
//   * excerpt resolver end-to-end: flags carry span ids only; the pipeline must
//     populate ideal.spanTexts so idealSurfaceFor quotes the real lines. Driven
//     through the REAL pipeline -> REAL surface join, not the resolver alone
//     (the resolver's own unit cases live in idealSurface.test.js).
//
// MUTANTS (built & WATCHED in the scratchpad reference pass; see tests.r1 notes):
//   m1  leave `review: null` after Step 9                 -> reds (not-null/coverage/excerpt)
//   m2  force review.coverage.complete = true             -> reds (no-overclaim + well-formed)
//   m3  recompose emitted from [...kept, ...dropped]      -> reds (K2 carryover)
//   m4  populate spanTexts with wrong text (id as text)   -> reds (excerpt exact-line)
//   m5  review only the application-ready draft           -> reds (no hypothetical-draft flag)
//   no-op control: reorder two independent statements     -> all green
//
// RED on HEAD: idealPipeline.js sets `review: null` and emits no `spanTexts`, so
// every test here fails on its review-live precondition. Satisfiability proven by
// a reference implementation in a scratchpad copy (tests.r1 notes).

import { describe, it, expect, vi } from "vitest";
import { runIdealPipeline } from "./idealPipeline.js";
import { idealSurfaceFor } from "@/lib/tailor/idealSurface.js";
import { CATEGORY, LLM_CATEGORIES, assertWellFormed } from "@/lib/review/contract.js";

// The application-ready candidate carries a SUPPORTED, verifiable-metric line
// (kept) and a FABRICATION (dropped by the gate). The metric line is quantified
// with no baseline, so the mechanical reviewer raises exactly one
// unverifiable-metric flag on it -- a deterministic, in-document flag whose id
// the excerpt resolver must be able to quote.
const METRIC_LINE = "Improved checkout conversion by 35%";
const FABRICATION = "Scaled the platform to 10,000,000 users";
// The hypothetical's baselined metric raises NO flag; its text must still appear
// in ideal.spanTexts.hypothetical so the surface can quote hypothetical evidence.
const HYPO_METRIC = "Grew revenue from $1M to $5M";
// A quantified hypothetical line with NO baseline: the mechanical reviewer raises
// an unverifiable-metric flag carrying draftKind "hypothetical" -- the observable
// proof that the hypothetical draft was actually fed to reviewDocuments, not just
// decomposed into the spanTexts tables (Step 9 #1: BOTH drafts reviewed).
const HYPO_FLAGGED = "Boosted signups by 60%";

function stubEngine() {
  return {
    name: "gemini",
    supportsIdeal: true,
    async tailorIdeal() {
      const hypoLines = [
        "PROFESSIONAL EXPERIENCE",
        "Acme Corp — Principal Engineer (2020-2024)",
        HYPO_METRIC,
        HYPO_FLAGGED,
        FABRICATION,
      ];
      const candidateLines = [
        "PROFESSIONAL EXPERIENCE",
        "Acme Corp — Senior Engineer (2020-2024)",
        METRIC_LINE,
        FABRICATION,
      ];
      return {
        postingAnalysis: { requirements: [] },
        keywordMap: { entries: [] },
        hypothetical: {
          result: hypoLines.join("\n"),
          resultLines: hypoLines,
          jobTitle: "Payments Engineer",
          companyName: "Acme Corp",
        },
        applicationReadyCandidate: {
          result: candidateLines.join("\n"),
          resultLines: candidateLines,
          jobTitle: "Payments Engineer",
          companyName: "Acme Corp",
        },
      };
    },
  };
}

const realMaterial = {
  spans: [{ id: "r1", text: METRIC_LINE, contextKey: "Acme Corp" }],
  chronology: { employers: [{ name: "Acme Corp", start: "2020", end: "2024" }] },
};

async function run() {
  return runIdealPipeline({
    engine: stubEngine(),
    args: { jobPosting: "payments role", resumeText: "Jane Doe", resumeFileName: "resume.docx" },
    realMaterial,
  });
}

const OPTS = { title: "Payments Engineer", company: "Acme Corp" };
const surfaceFor = (out) => idealSurfaceFor({ result: out.result, ideal: out.ideal }, OPTS);

describe("runIdealPipeline Step 9 -- the live review replaces review:null", () => {
  it("ideal.review is a non-null, well-formed reviewDocuments result (not the slice-1 null)", async () => {
    const out = await run();
    // RED on HEAD: the orchestrator still sets review:null.
    expect(out.ideal.review).not.toBeNull();
    expect(out.ideal.review).toBeTypeOf("object");
    expect(assertWellFormed(out.ideal.review)).toBe(true);
    // The three contract surfaces are present and array-shaped.
    expect(Array.isArray(out.ideal.review.flags)).toBe(true);
    expect(Array.isArray(out.ideal.review.unresolvedQualifications)).toBe(true);
    expect(out.ideal.review.coverage).toBeTypeOf("object");
  });

  it("reviews BOTH drafts: flags carry each draftKind (m5: reviewing only one reds)", async () => {
    const out = await run();
    expect(out.ideal.review).not.toBeNull();
    const kinds = new Set(out.ideal.review.flags.map((f) => f.draftKind));
    // The application-ready draft flags its unverifiable metric; the hypothetical
    // draft flags its own. A build that feeds only one draft to reviewDocuments
    // loses that draft's flag -> this reds. (spanTexts is built independently, so
    // the table-presence check alone cannot see this.)
    expect(kinds.has("applicationReady")).toBe(true);
    expect(kinds.has("hypothetical")).toBe(true);
  });

  it("carries coverage; slice 1 is mechanical-only and NOT complete (no overclaim)", async () => {
    const out = await run();
    const cov = out.ideal.review?.coverage;
    // RED on HEAD: review is null, so coverage is undefined.
    expect(cov?.engineMode).toBe("mechanical-only");
    expect(cov?.complete).toBe(false);
    // The honest-partial set is the four deterministic floor categories only; no
    // LLM category may be claimed as evaluated when no judge ran.
    expect(Array.isArray(cov?.evaluatedCategories)).toBe(true);
    for (const c of LLM_CATEGORIES) {
      expect(cov.evaluatedCategories).not.toContain(c);
    }
    // CONTROL against an injected judge flipping the mode to "full": if a build
    // ever wires a model in slice 1, engineMode would read "full" and this reds.
    expect(cov.engineMode).not.toBe("full");
  });
});

describe("runIdealPipeline Step 9 -- K2: the live review is advisory, not a re-admission", () => {
  it("the emitted application-ready stays KEPT-only even though the review is now live", async () => {
    const out = await run();
    // Precondition that ties this to Step 9 (reds on HEAD): the review ran.
    expect(out.ideal.review).not.toBeNull();
    // POWER (m3): a build that recomposes from kept + the review's flagged/dropped
    // spans "so the reviewer's findings show in the file" puts the fabrication
    // back into the bytes -> these red. The kept-only property itself predates
    // Step 9; what is new is that it must survive the live review.
    expect(out.ideal.applicationReady.result).not.toMatch(/10,000,000 users/);
    expect(out.ideal.applicationReady.resultLines.join("\n")).not.toMatch(/10,000,000 users/);
    expect(out.result).not.toMatch(/10,000,000 users/);
    // Liveness control: the supported line is still emitted, so the test is not
    // satisfied by a build that emits nothing.
    expect(out.ideal.applicationReady.result).toContain(METRIC_LINE);
  });

  it("the fabrication is accounted for in the gate's removed/leftOut, not in the review's re-admission", async () => {
    const out = await run();
    expect(out.ideal.review).not.toBeNull();
    const accounted = [...(out.ideal.removed ?? []), ...(out.ideal.leftOut ?? [])]
      .map((r) => r.text || "")
      .join("\n");
    expect(accounted).toMatch(/10,000,000 users/);
  });
});

describe("runIdealPipeline Step 9 -- spanTexts feeds the excerpt resolver (ids -> quoted lines)", () => {
  it("populates ideal.spanTexts keyed by draftKind, with the reviewed drafts' lines", async () => {
    const out = await run();
    const spanTexts = out.ideal.spanTexts;
    // RED on HEAD: the orchestrator emits no spanTexts.
    expect(spanTexts).toBeTypeOf("object");
    expect(spanTexts.applicationReady).toBeTypeOf("object");
    expect(spanTexts.hypothetical).toBeTypeOf("object");
    // Both drafts are DECOMPOSED into the tables so the surface can quote either
    // one's lines. (That both are actually REVIEWED is pinned separately, by the
    // per-draftKind flag test above.)
    expect(Object.values(spanTexts.applicationReady)).toContain(METRIC_LINE);
    expect(Object.values(spanTexts.hypothetical)).toContain(HYPO_METRIC);
  });

  it("every flag resolves to the spanText its id names (m4: wrong/empty spanText reds)", async () => {
    const out = await run();
    expect(out.ideal.review).not.toBeNull();
    const flags = out.ideal.review.flags;
    // Non-vacuous: the mechanical floor raises at least the one metric flag, so
    // there IS a flag to resolve. A build whose reviewer under-fires reds here.
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      const table = out.ideal.spanTexts?.[flag.draftKind];
      expect(table).toBeTypeOf("object");
      const text = table[flag.spanId];
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
    // The application-ready unverifiable-metric flag names the 35% line; its
    // spanText is EXACTLY it.
    const metric = flags.find(
      (f) => f.category === CATEGORY.UNVERIFIABLE_METRIC && f.draftKind === "applicationReady",
    );
    expect(metric, "expected a mechanical unverifiable-metric flag on the kept line").toBeTruthy();
    expect(out.ideal.spanTexts[metric.draftKind][metric.spanId]).toBe(METRIC_LINE);
  });

  it("idealSurfaceFor quotes the real line onto the flag (end-to-end pipeline -> surface join)", async () => {
    const out = await run();
    expect(out.ideal.spanTexts).toBeTypeOf("object"); // reds on HEAD before the join
    const surface = surfaceFor(out);
    const metric = surface.ideal.review.flags.find(
      (f) => f.category === CATEGORY.UNVERIFIABLE_METRIC && f.draftKind === "applicationReady",
    );
    expect(metric).toBeTruthy();
    // A present id yields the EXACT excerpt.
    expect(metric.excerpt).toBe(METRIC_LINE);
  });

  it("a flag id with no matching spanText yields no quoted line (no crash), while present ids still resolve", async () => {
    const out = await run();
    // Reds on HEAD: spanTexts absent, so the real metric flag below also fails to
    // resolve. Uses the pipeline's OWN spanTexts, not a hand-built table.
    expect(out.ideal.spanTexts).toBeTypeOf("object");
    const dangling = { category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "no-such-span-id" };
    const entry = {
      result: out.result,
      ideal: { ...out.ideal, review: { ...out.ideal.review, flags: [...out.ideal.review.flags, dangling] } },
    };
    const surface = idealSurfaceFor(entry, OPTS);
    const resolvedDangling = surface.ideal.review.flags.find((f) => f.spanId === "no-such-span-id");
    expect(resolvedDangling).toBeTruthy();
    expect(resolvedDangling.excerpt).toBeUndefined();
    const metric = surface.ideal.review.flags.find(
      (f) => f.category === CATEGORY.UNVERIFIABLE_METRIC && f.draftKind === "applicationReady",
    );
    expect(metric.excerpt).toBe(METRIC_LINE);
  });
});

describe("runIdealPipeline Step 9 -- deterministic, no live model or network", () => {
  it("the mechanical review touches no network and is byte-stable across runs", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("the slice-1 mechanical review must not hit the network");
    });
    const original = global.fetch;
    global.fetch = fetchSpy;
    try {
      const a = await run();
      const b = await run();
      // Ties to Step 9 (reds on HEAD): the review ran at all.
      expect(a.ideal.review).not.toBeNull();
      expect(a.ideal.review.coverage.engineMode).toBe("mechanical-only");
      // No judge/model/network in slice 1.
      expect(fetchSpy).not.toHaveBeenCalled();
      // Determinism: the same input yields the same coverage and the same flags.
      expect(b.ideal.review.coverage).toEqual(a.ideal.review.coverage);
      expect(b.ideal.review.flags).toEqual(a.ideal.review.flags);
    } finally {
      global.fetch = original;
    }
  });
});
