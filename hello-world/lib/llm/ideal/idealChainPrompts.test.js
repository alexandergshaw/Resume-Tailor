// N104 Step 4 (4b) - weaknessSteering, the feedback channel into generation
// (AC-1/AC-8, design r2 §6, D-7). CREATED this round (plan STALE-2: no
// idealChainPrompts test existed).
//
// The regenerate feeds the RESOLVABLE weakness terms back to the engine as an
// EMPHASIS-NOT-FACTS block in the guidance region - never in the candidate's
// source-material list, where the model would read them as facts to assert. The
// gate downstream makes wording fabrication-safe regardless, but placement is the
// difference between "emphasise what your resume already supports" and "claim
// this". Absent/empty steering leaves the prompt byte-identical to today (AC-8).
//
// RED on HEAD: both builders ignore a `weaknessSteering` arg today, so the steered
// term never appears -> the "present when passed" rows red. The byte-identical and
// "not in the source list" rows are the controls. Satisfiability in the scratchpad.

import { describe, it, expect } from "vitest";
import { buildApplicationReadyPrompt, buildHypotheticalPrompt } from "./idealChainPrompts.js";

// A term that appears NOWHERE in the posting, analysis, hypothetical or resume, so
// its presence in the prompt can only come from the steering block.
const STEER_TERM = "Kubernetes";

const base = {
  postingText: "We build payment services for merchants.",
  analysis: {
    postingAnalysis: { requirements: [{ id: "q1", kind: "requirement", text: "Build payment services." }] },
    keywordMap: { entries: [{ keyword: "payments", section: "summary", priority: 1 }] },
  },
  hypothetical: { resultLines: ["Jordan Rivera", "Built payment tools"] },
  resumeText: "Jordan Rivera\nBuilt payment tools at Acme",
  resumeFileName: "resume.docx",
  additionalContext: "",
  contextDocuments: [],
  templateLines: ["", ""],
};

const steering = { resolvable: [{ category: "missing-keyword", term: STEER_TERM }] };

// The resume/source-material region starts at "Resume content:" (candidateBlock).
const sourceRegion = (prompt) => prompt.slice(prompt.indexOf("Resume content:"));

describe("buildApplicationReadyPrompt - weaknessSteering (AC-1 placement, AC-8 byte-identity)", () => {
  it("names the resolvable term when steering is passed (RED on HEAD: param ignored)", () => {
    const prompt = buildApplicationReadyPrompt({ ...base, weaknessSteering: steering });
    expect(prompt).toContain(STEER_TERM);
  });

  it("places the steered term in the GUIDANCE region, never in the source-material list", () => {
    const prompt = buildApplicationReadyPrompt({ ...base, weaknessSteering: steering });
    // It must appear overall...
    expect(prompt).toContain(STEER_TERM);
    // ...but NOT inside the candidate's resume/source block (where it would read as a fact).
    expect(sourceRegion(prompt)).not.toContain(STEER_TERM);
  });

  it("AC-8: absent OR empty steering leaves the prompt byte-identical to today", () => {
    const noArg = buildApplicationReadyPrompt({ ...base });
    const empty = buildApplicationReadyPrompt({ ...base, weaknessSteering: { resolvable: [] } });
    expect(empty).toBe(noArg); // empty resolvable adds no block
    expect(noArg).not.toContain(STEER_TERM); // control: no steering text leaks
  });
});

describe("buildHypotheticalPrompt - weaknessSteering (D-7: both builders gain it)", () => {
  it("names the resolvable term when steering is passed; absent leaves it out", () => {
    const steered = buildHypotheticalPrompt({ ...base, weaknessSteering: steering });
    const plain = buildHypotheticalPrompt({ ...base });
    expect(steered).toContain(STEER_TERM);
    expect(plain).not.toContain(STEER_TERM);
    expect(sourceRegion(steered)).not.toContain(STEER_TERM);
  });
});
