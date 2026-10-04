// N105 Step 3c (4b) — the server orchestrator (K2 emitted-level, UX-42, D-6b).
// Binds to: N105.plan.r2.md Step 3c + PL-5; N105.design.r2.md §1/§8 + D-6b, D-11;
// AC-4 (emitted bytes), UX-42/UXR-13, review:null slice-1.
//
// WHY THIS IS A POWER ROW (K2, SILENT). The orchestrator is the one place that
// could ship a fabrication by handing recompose the wrong set (kept+flagged) or
// by bypassing recompose entirely (applicationReady.result = candidate.result).
// These tests drive the REAL decompose/gate/recompose with a STUBBED engine and
// assert the fabrication is absent from the EMITTED application-ready text, and
// that the top-level result is the application-ready (never the hypothetical).
//
// MUTANTS (built & watched in the scratchpad pass):
//   m1  recomposeFromSpans(layout, [...kept, ...flagged])  -> flagged text appears -> red
//   m2  applicationReady.result = candidate.result (skip recompose) -> fabrication appears -> red
//   m3  top-level result = hypothetical.result (UX-42) -> red
//   no-op control: reorder two independent statements -> all green
//
// RED on HEAD: module absent (collection failure); satisfiability proven by the
// scratchpad reference.

import { describe, it, expect } from "vitest";
import { runIdealPipeline } from "./idealPipeline.js";

const FABRICATION = "Scaled the platform to 10,000,000 users";
const SUPPORTED = "Reduced support tickets at Acme Corp";

// A stub engine: tailorIdeal returns the frozen shape (design §2). The
// application-ready CANDIDATE carries a supported line AND a fabrication; the
// hypothetical (best-case) carries both too. The pipeline must gate the
// candidate down to the supported line only.
function stubEngine() {
  return {
    name: "gemini",
    supportsIdeal: true,
    async tailorIdeal() {
      const hypoLines = [
        "Acme Corp — Principal Engineer (2020-2024)",
        SUPPORTED,
        FABRICATION,
      ];
      const candidateLines = [
        "Acme Corp — Senior Engineer (2020-2024)",
        SUPPORTED,
        FABRICATION,
      ];
      return {
        postingAnalysis: { requirements: [{ id: "q1", text: "payments experience" }] },
        keywordMap: { entries: [{ keyword: "payments", section: "summary" }] },
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
  spans: [{ id: "r1", text: "Reduced support tickets at Acme Corp", contextKey: "Acme Corp" }],
  chronology: { employers: [{ name: "Acme Corp", start: "2020", end: "2024" }] },
};

async function run() {
  return runIdealPipeline({
    engine: stubEngine(),
    args: { jobPosting: "payments role", resumeText: "Jane Doe", resumeFileName: "resume.docx" },
    realMaterial,
  });
}

const MARKER_PREFIX = /^[^A-Za-z0-9]*HYPOTHETICAL/;

describe("runIdealPipeline — emitted application-ready is gate-clean (K2, AC-4 end-to-end)", () => {
  it("the fabrication is ABSENT from the emitted application-ready result and resultLines", async () => {
    const out = await run();
    expect(out.ideal.applicationReady.result).not.toMatch(/10,000,000 users/);
    expect(out.ideal.applicationReady.resultLines.join("\n")).not.toMatch(/10,000,000 users/);
  });

  it("the supported claim is RETAINED in the emitted application-ready (liveness end-to-end)", async () => {
    const out = await run();
    expect(out.ideal.applicationReady.result).toMatch(/Reduced support tickets/);
  });

  it("the application-ready traces to recompose, NOT to the candidate (D-6b wiring)", async () => {
    // If applicationReady.result were the candidate's text it would carry the
    // fabrication; the assertion above already reds that. Here we also pin that
    // the two are genuinely different objects of content.
    const out = await run();
    const candidateHadFabrication = FABRICATION;
    expect(out.ideal.applicationReady.result).not.toContain(candidateHadFabrication);
  });
});

describe("runIdealPipeline — two-file shape (UX-42/UXR-13, D-11)", () => {
  it("top-level result/resultLines/jobTitle equal the APPLICATION-READY values", async () => {
    const out = await run();
    expect(out.result).toBe(out.ideal.applicationReady.result);
    expect(out.resultLines).toEqual(out.ideal.applicationReady.resultLines);
    expect(out.jobTitle).toBe(out.ideal.applicationReady.jobTitle ?? out.ideal.applicationReady.title);
  });

  it("top-level result is NOT the hypothetical (the hypothetical carries the best-case fabrication)", async () => {
    const out = await run();
    // The hypothetical still contains the fabrication; the top level must not.
    expect(out.ideal.hypothetical.result).toMatch(/10,000,000 users/);
    expect(out.result).not.toBe(out.ideal.hypothetical.result);
    expect(out.result).not.toMatch(/10,000,000 users/);
  });

  it("marks the hypothetical isHypothetical:true with a marker-prefixed title; application-ready isHypothetical:false", async () => {
    const out = await run();
    expect(out.ideal.hypothetical.isHypothetical).toBe(true);
    expect(out.ideal.applicationReady.isHypothetical).toBe(false);
    expect(out.ideal.hypothetical.title).toMatch(MARKER_PREFIX);
    expect(out.ideal.applicationReady.title ?? "").not.toMatch(/HYPOTHETICAL/);
  });

  // Obsoleted by Step 9 (ruling R-N105-STEP9): this row used to pin review:null
  // "until Step 9". The live reviewer is wired now and, with no judge injected,
  // is the mechanical floor: present, partial, never complete.
  it("carries the live mechanical-only review (Step 9 replaced the slice-1 review:null)", async () => {
    const out = await run();
    expect(out.ideal.review).not.toBeNull();
    expect(out.ideal.review.coverage.engineMode).toBe("mechanical-only");
    expect(out.ideal.review.coverage.complete).toBe(false);
  });

  it("surfaces the gate's removed/leftOut and the posting analysis / keyword map", async () => {
    const out = await run();
    expect(Array.isArray(out.ideal.removed)).toBe(true);
    expect(Array.isArray(out.ideal.leftOut)).toBe(true);
    // The fabrication left the file -> it is accounted for in removed or leftOut.
    const accounted = [...out.ideal.removed, ...out.ideal.leftOut]
      .map((r) => r.text || "")
      .join("\n");
    expect(accounted).toMatch(/10,000,000 users/);
    expect(out.ideal.postingAnalysis).toBeTruthy();
    expect(out.ideal.keywordMap).toBeTruthy();
  });
});
