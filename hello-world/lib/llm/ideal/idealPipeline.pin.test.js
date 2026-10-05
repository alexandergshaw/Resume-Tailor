// N104 Step 3 (4b) - the F1 CRUX: runIdealPipeline gains an optional
// `pinnedAnalysis` so the regenerate's after-review scores against the BEFORE
// run's grounded posting analysis (design r2 §2, D-6, AC-4(b)).
//
// WHY A POWER ROW (R1, the deepest SILENT risk in N104). req ids are `q${n}`
// minted by model output order (idealStageResult.js:137) and a fresh run re-mints
// them, so without a pin a still-missing keyword drifts id and reads as "closed".
// The pin makes the before/after reviews share the SAME requirement universe, so
// the gap keeps its (origin, reqId, term) key. This file proves the pin is
// HONORED (the reviewer scores against the pinned analysis, not a fresh grounding)
// and that the FIRST-RUN path, with no pin, is unchanged (AC-8).
//
// RED on HEAD: runIdealPipeline ignores `pinnedAnalysis` today, so a pinned run
// still grounds chain.postingAnalysis -> the pinned id q7 never appears. That is a
// genuine BEHAVIOURAL red (the HEAD code IS the "re-grounds fresh" mutant R1), not
// import-absence. Satisfiability proven in the scratchpad reference.

import { describe, it, expect } from "vitest";
import { runIdealPipeline } from "./idealPipeline.js";
import { CATEGORY } from "@/lib/review/contract";

// The draft the engine returns. The one line that traces to real material is kept
// by the gate (so the reviewer has a span to work over); it never says Kubernetes.
const KEPT_LINE = "Reduced support tickets at Acme Corp";
const FAB_LINE = "Scaled the platform to 10,000,000 users";

function stubEngine() {
  return {
    name: "gemini",
    supportsIdeal: true,
    async tailorIdeal() {
      const lines = ["Acme Corp — Senior Engineer (2020-2024)", KEPT_LINE, FAB_LINE];
      // The engine's OWN analysis would ground to id "q1" (the non-pin path).
      return {
        postingAnalysis: { requirements: [{ id: "q1", text: "Kubernetes experience", kind: "requirement" }] },
        keywordMap: { entries: [{ keyword: "Kubernetes", section: "competencies", priority: 1, requirementIndex: 0 }] },
        hypothetical: { result: lines.join("\n"), resultLines: lines, jobTitle: "Engineer", companyName: "Acme Corp" },
        applicationReadyCandidate: {
          result: lines.join("\n"),
          resultLines: lines,
          jobTitle: "Engineer",
          companyName: "Acme Corp",
        },
      };
    },
  };
}

const realMaterial = {
  spans: [{ id: "r1", text: KEPT_LINE, contextKey: "Acme Corp" }],
  chronology: { employers: [{ name: "Acme Corp", start: "2020", end: "2024" }] },
};

// The pin carries the SAME requirement text under a DIFFERENT id (q7). If the pin
// is honored, q7 shows up in the posting analysis and on the missing-keyword flag;
// if the pipeline re-grounds fresh, q1 does instead.
const PINNED = {
  postingAnalysis: { requirements: [{ id: "q7", text: "Kubernetes experience", kind: "requirement" }] },
  keywordMap: { entries: [] },
};

const baseArgs = {
  jobPosting: "We need Kubernetes experience for this role.",
  resumeText: "Jordan",
  resumeFileName: "r.docx",
};

const missingKeywordFlags = (out) =>
  (out.ideal.review.flags || []).filter(
    (f) => f.category === CATEGORY.MISSING_KEYWORD && f.draftKind === "applicationReady",
  );

describe("runIdealPipeline pinnedAnalysis - the pin is HONORED (R1)", () => {
  it("uses the pinned analysis for the returned postingAnalysis (id q7, not the grounded q1)", async () => {
    const out = await runIdealPipeline({ engine: stubEngine(), args: baseArgs, realMaterial, pinnedAnalysis: PINNED });
    expect(out.ideal.postingAnalysis.requirements.map((r) => r.id)).toEqual(["q7"]);
  });

  it("the after-review scores the still-missing keyword against the PINNED requirement id", async () => {
    const out = await runIdealPipeline({ engine: stubEngine(), args: baseArgs, realMaterial, pinnedAnalysis: PINNED });
    const flags = missingKeywordFlags(out);
    expect(flags.length).toBeGreaterThan(0); // the kept draft never says Kubernetes -> flagged
    // MUTANT (re-ground fresh, ignore the pin): the flag would carry q1 -> reds.
    expect(flags.every((f) => f.evidenceRef?.spanId === "q7")).toBe(true);
  });
});

describe("runIdealPipeline pinnedAnalysis - first-run (no pin) is unchanged (AC-8 control)", () => {
  it("with NO pin the analysis is grounded from the engine's own output (id q1)", async () => {
    const out = await runIdealPipeline({ engine: stubEngine(), args: baseArgs, realMaterial });
    // This is the positive control: it proves the pin actually changes behaviour
    // (q7 above) rather than q7 being produced on every path.
    expect(out.ideal.postingAnalysis.requirements.map((r) => r.id)).toEqual(["q1"]);
    const flags = missingKeywordFlags(out);
    expect(flags.every((f) => f.evidenceRef?.spanId === "q1")).toBe(true);
  });

  it("an INVALID pin falls back to today's grounding, never a half-pinned state", async () => {
    // isValidPinnedAnalysis must reject a pin with no requirements.
    const out = await runIdealPipeline({
      engine: stubEngine(),
      args: baseArgs,
      realMaterial,
      pinnedAnalysis: { postingAnalysis: { requirements: [] }, keywordMap: { entries: [] } },
    });
    expect(out.ideal.postingAnalysis.requirements.map((r) => r.id)).toEqual(["q1"]);
  });
});

describe("runIdealPipeline pinnedAnalysis - pin does not weaken the gate (AC-1 holds under a pin)", () => {
  it("the fabrication is still absent from the emitted application-ready under a pin", async () => {
    const out = await runIdealPipeline({ engine: stubEngine(), args: baseArgs, realMaterial, pinnedAnalysis: PINNED });
    expect(out.result).not.toMatch(/10,000,000 users/);
    expect(out.result).toMatch(/Reduced support tickets/);
  });
});
