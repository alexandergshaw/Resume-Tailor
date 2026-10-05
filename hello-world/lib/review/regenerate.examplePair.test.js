// N104 AC-7 - the example posting <-> resume pair RUNS summary -> regenerate ->
// re-review, on real data and with only the ENGINE stubbed.
//
// The chain, end to end:
//   1. a FIRST RUN (the real pipeline) over a first-pass draft that under-weights one
//      supported keyword
//   2. the weakness SUMMARY of what that run emitted (runDocumentReview, the shared
//      chokepoint) split three ways (classifyWeaknesses)
//   3. REGENERATE (regenerateToAddress): the mock engine writes an improved draft
//      that ALSO carries every failable row of the pair, pinned to the first run's
//      posting analysis
//   4. the RE-REVIEW the regenerate computes, compared with the summary
//
// and the three outcome classes of AC-7, each with a stated count:
//   must-close        1  a keyword the resume supports, absent before and present after:
//                        reported closed, from the re-review
//   must-leave-open   2  requirements the resume does not support: still open, and no
//                        line in the output closes them
//   must-not-fabricate 6 the pair's failable rows, every one in the engine's draft:
//                        absent from every emitted byte
// Zero of any class would make the fixture decoration, so each count is asserted
// above zero. The "same draft" control proves the report does not claim a closure the
// re-review does not show, and the first-run precondition proves the gap exists
// before the regenerate (a closed claim needs something to close).

import { describe, it, expect, beforeAll, vi } from "vitest";
import { runIdealPipeline } from "../llm/ideal/idealPipeline.js";
import { normalizeAnalysis } from "../llm/ideal/idealStageResult.js";
import { buildIdealRealMaterial } from "@/app/api/tailor/idealRealMaterial.js";
import { runDocumentReview } from "./runDocumentReview.js";
import { classifyWeaknesses } from "./classifyWeaknesses.js";
import { regenerateToAddress } from "./regenerateToAddress.js";
import { missingKeywordTerm } from "./gapIdentity.js";
import {
  EXAMPLE_ANALYSIS,
  EXAMPLE_CANDIDATE_LINES,
  EXAMPLE_FIRST_PASS_LINES,
  EXAMPLE_HYPOTHETICAL_LINES,
  EXAMPLE_POSTING,
  EXAMPLE_REGENERATE_ROWS,
  EXAMPLE_RESUME_TEXT,
} from "../llm/ideal/__fixtures__/examplePair.js";

const args = { jobPosting: EXAMPLE_POSTING, resumeText: EXAMPLE_RESUME_TEXT, resumeFileName: "resume.docx" };
const realMaterial = buildIdealRealMaterial(EXAMPLE_RESUME_TEXT);

// engine.tailorIdeal as the chain resolves it: the analysis through the real
// normalizer, the application-ready candidate as the lines given.
function engineWriting(candidateLines, capture = {}) {
  const { jobTitle, companyName, postingAnalysis, keywordMap } = normalizeAnalysis(EXAMPLE_ANALYSIS);
  const draft = (lines) => ({ result: lines.join("\n"), resultLines: lines, jobTitle, companyName });
  return {
    name: "gemini",
    supportsIdeal: true,
    tailorResume: vi.fn(() => {
      throw new Error("the regenerate must never call the ungated standard route");
    }),
    tailorIdeal: vi.fn(async (callArgs) => {
      capture.args = callArgs;
      return {
        postingAnalysis,
        keywordMap,
        hypothetical: draft(EXAMPLE_HYPOTHETICAL_LINES),
        applicationReadyCandidate: draft(candidateLines),
      };
    }),
  };
}

const termsOf = (flags) => flags.map(missingKeywordTerm);
const hasText = (lines, text) => lines.some((line) => line.includes(text));

let first;
let beforeReview;
let pinnedAnalysis;
let improved;
let improvedCapture;
let unchanged;

beforeAll(async () => {
  first = await runIdealPipeline({ engine: engineWriting(EXAMPLE_FIRST_PASS_LINES), args, realMaterial });
  // The summary of the text the first run emitted, through the shared chokepoint.
  beforeReview = await runDocumentReview({
    kind: "applicationReady",
    title: "Resume",
    resultLines: first.resultLines,
    posting: first.ideal.postingAnalysis,
    realMaterial,
  });
  pinnedAnalysis = { postingAnalysis: first.ideal.postingAnalysis, keywordMap: first.ideal.keywordMap };
  improvedCapture = {};
  improved = await regenerateToAddress({
    engine: engineWriting(EXAMPLE_CANDIDATE_LINES, improvedCapture),
    args,
    realMaterial,
    beforeReview,
    pinnedAnalysis,
  });
  unchanged = await regenerateToAddress({
    engine: engineWriting(EXAMPLE_FIRST_PASS_LINES),
    args,
    realMaterial,
    beforeReview,
    pinnedAnalysis,
  });
});

describe("AC-7 fixture - the chain has both kinds of power, and the gap exists before the regenerate", () => {
  it("states a must-close count, a must-leave-open count and a failable count, each above zero", () => {
    expect(EXAMPLE_REGENERATE_ROWS.mustClose).toHaveLength(1);
    expect(EXAMPLE_REGENERATE_ROWS.mustLeaveOpen).toHaveLength(2);
    expect(EXAMPLE_REGENERATE_ROWS.mustNotFabricate).toHaveLength(6);
  });

  it("PRECONDITION: the first run's summary names the keyword the resume supports as a wording gap", () => {
    expect(first.resultLines.join("\n")).not.toMatch(/payments/i); // under-weighted
    const { resolvable } = classifyWeaknesses(beforeReview);
    for (const row of EXAMPLE_REGENERATE_ROWS.mustClose) {
      expect(termsOf(resolvable), `${row.term} is not in the resolvable bucket`).toContain(row.term);
    }
  });

  it("PRECONDITION: the unsupported requirements are in the summary's third bucket, not the first", () => {
    const { resolvable, genuinelyUnqualified } = classifyWeaknesses(beforeReview);
    for (const row of EXAMPLE_REGENERATE_ROWS.mustLeaveOpen) {
      expect(genuinelyUnqualified.map((u) => u.text)).toContain(row.requirementText);
      expect(termsOf(resolvable)).not.toContain(row.term);
    }
  });

  it("PRECONDITION: the engine's improved draft carries every failable row, so a verbatim emit would fail", () => {
    for (const row of EXAMPLE_REGENERATE_ROWS.mustNotFabricate) {
      expect(EXAMPLE_CANDIDATE_LINES.some((line) => line.includes(row.text)), `${row.id} missing from the draft`).toBe(true);
    }
  });
});

describe("AC-7 must-close - reported closed only because the re-review shows it gone", () => {
  it("closes the supported keyword, scored against the SAME requirements the first run used", () => {
    expect(improved.closure.correspondenceUnavailable).toBe(false);
    for (const row of EXAMPLE_REGENERATE_ROWS.mustClose) {
      expect(improved.closure.closed.map((c) => c.term)).toContain(row.term);
    }
    expect(improved.regenerated.ideal.postingAnalysis.requirements.map((r) => r.id)).toEqual(
      first.ideal.postingAnalysis.requirements.map((r) => r.id),
    );
  });

  it("the keyword really is in the emitted text now, and the count of its flags went down", () => {
    expect(improved.regenerated.resultLines.join("\n")).toMatch(/payments/i);
    expect(improved.closure.countsAfter.missingKeyword).toBeLessThan(improved.closure.countsBefore.missingKeyword);
  });

  it("CONTROL: an engine that returns the same draft closes nothing (never claimed blind)", () => {
    expect(unchanged.closure.closed).toEqual([]);
    expect(unchanged.closure.stillOpen.map((c) => c.term)).toContain("Payments");
    expect(unchanged.closure.countsAfter.missingKeyword).toBe(unchanged.closure.countsBefore.missingKeyword);
  });
});

describe("AC-7 must-leave-open - an unsupported requirement stays open and no line closes it", () => {
  it("every unsupported requirement is still reported open after the regenerate", () => {
    for (const row of EXAMPLE_REGENERATE_ROWS.mustLeaveOpen) {
      expect(improved.genuinelyUnqualified.map((u) => u.text)).toContain(row.requirementText);
      expect(improved.closure.closed.map((c) => c.term)).not.toContain(row.term);
    }
  });

  it("the keyword of an unsupported requirement is never in the steering and never in the emitted text", () => {
    const steered = improvedCapture.args.weaknessSteering.resolvable.map((e) => e.term);
    expect(steered).toContain("Payments");
    for (const row of EXAMPLE_REGENERATE_ROWS.mustLeaveOpen) {
      expect(steered).not.toContain(row.term);
      expect(improved.regenerated.resultLines.join("\n")).not.toContain(row.term);
    }
  });

  it("the re-review still flags the unsupported keyword (nothing was filled)", () => {
    const stillFlagged = improved.regenerated.ideal.review.flags.map(missingKeywordTerm);
    expect(stillFlagged).toContain("Kubernetes");
  });
});

describe("AC-7 must-confirm - a finding only the user can check is reported and never a target", () => {
  it("the unverifiable figure is in the confirm bucket, outside the steering, and not reported closed", () => {
    for (const row of EXAMPLE_REGENERATE_ROWS.mustConfirm) {
      expect(improved.confirm.some((f) => f.category === row.category && f.message.includes(row.figure))).toBe(true);
      expect(improved.closure.closed.map((c) => c.category)).not.toContain(row.category);
    }
    const steered = improvedCapture.args.weaknessSteering.resolvable;
    expect(steered.every((e) => e.category === "missing-keyword")).toBe(true);
  });
});

describe("AC-7 must-not-fabricate - the failable rows are absent from every emitted byte", () => {
  it("none of the six appears in the regenerated resume, though the engine wrote all six", () => {
    for (const row of EXAMPLE_REGENERATE_ROWS.mustNotFabricate) {
      expect(hasText(improved.regenerated.resultLines, row.text), `${row.id} was emitted`).toBe(false);
    }
  });

  it("the regenerate went through the gated engine path only", () => {
    expect(improvedCapture.args.weaknessSteering).toBeTruthy();
    expect(improved.regenerated.ideal.counts.removed + improved.regenerated.ideal.counts.leftOut).toBeGreaterThan(0);
  });
});
