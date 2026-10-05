// N103 Step 4 (4b) -- the pure presentation-state function. It maps a
// ReviewOutcome (+ freshness/covered) to the honest display state, and is where
// the chunk's reason-to-exist lives:
//
//   * AC-1: reassuring ("clean") copy is licensed ONLY when verdictKind is
//     COMPLETE (+ fresh + zero flags + non-empty + inputs supplied), NEVER on
//     flags.length === 0.
//   * A-1a (LIVE this slice): when inputs.posting is false, "posting keywords"
//     moves from Checked to Not-fully-checked for DISPLAY, overriding the
//     checkedChecks that computeCoverage lists unconditionally (contract.js:150).
//   * A-2: the "mechanical checks only" suffix derives from engineMode, so it
//     does not lie once N110 flips engineMode to "full".
//   * AC-10: an empty outcome is its own state, never a clean verdict.
//
//   reviewPresentationState({ outcome, freshness, covered })
//     -> { state, headline, notice: { checked, notChecked, sentences }, footer, announce }
//
// Labels come from the REUSED CHECK_LABELS/checkLabel registry, so the test asserts
// against the registry, not against hardcoded English (a renamed label follows the
// registry, not a stale literal).
//
// RED on HEAD: `lib/review/reviewPresentation.js` does not exist. Satisfiability +
// the A-1a / AC-1 / A-2 mutants are proven against the scratchpad reference.
//
// Node env: pure module, no React, no IO.

import { describe, it, expect } from "vitest";
import { reviewPresentationState } from "./reviewPresentation.js";
import { REVIEW_KIND } from "./reviewVerdict.js";
import { CATEGORY } from "./contract.js";
import { CHECK_LABELS, checkLabel } from "./flagPresentation.js";

const FLOOR = [CATEGORY.MISSING_KEYWORD, CATEGORY.VAGUE_UNSUPPORTED, CATEGORY.REPETITION, CATEGORY.UNVERIFIABLE_METRIC];
const LLM = [CATEGORY.EMPLOYER_PLAUSIBILITY, CATEGORY.CONSISTENCY, CATEGORY.UNSUPPORTED_AUTHORITY];
const POSTING_KEYWORDS = CHECK_LABELS[CATEGORY.MISSING_KEYWORD]; // "posting keywords"

// The forbidden reassurance vocabulary (UX 4.1); legal ONLY in the clean state.
const FORBIDDEN = [
  /no issues flagged/i,
  /no weaknesses/i,
  /nothing (was )?(flagged|found)/i,
  /found nothing/i,
  /no (problems|concerns|issues)\b/i,
  /all clear/i,
  /looks good/i,
  /\bpassed\b/i,
  /\bverified\b/i,
  /safe to send/i,
  /\bclean\b/i,
];

// Collect every string leaf of the returned presentation object: this is the
// "chrome" (headline, notice lines, sentences, footer, announce) -- the function
// never emits quoted document text, so all of it is sweepable.
function chromeStrings(state) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk({ headline: state.headline, notice: state.notice, footer: state.footer, announce: state.announce });
  return out;
}

const sweep = (state) => chromeStrings(state).join("\n");

function reviewed(over = {}) {
  return {
    status: "reviewed",
    draftKind: "applicationReady",
    title: "Resume",
    flags: [],
    unresolvedQualifications: [],
    verdictKind: REVIEW_KIND.PARTIAL,
    missingChecks: [...LLM],
    checkedChecks: [...FLOOR],
    engineMode: "mechanical-only",
    lineCount: 8,
    inputs: { posting: true, realMaterial: true },
    ...over,
  };
}

describe("reviewPresentationState -- AC-1 clean license (gated on verdictKind, never flags.length)", () => {
  it("a mechanical-only PARTIAL review with zero flags is NOT clean and shows no reassuring copy", () => {
    const s = reviewPresentationState({ outcome: reviewed({ flags: [] }), freshness: "fresh", covered: false });
    // The AC-1 mutant (clean when flags.length === 0, ignoring coverage) reds here.
    expect(s.state).not.toBe("clean");
    for (const re of FORBIDDEN) expect(sweep(s)).not.toMatch(re);
  });

  it("POSITIVE CONTROL: a COMPLETE, fresh, zero-flag, inputs-supplied review IS clean and renders its one reassuring sentence", () => {
    const outcome = reviewed({
      verdictKind: REVIEW_KIND.COMPLETE,
      engineMode: "full",
      missingChecks: [],
      checkedChecks: [...FLOOR, ...LLM],
      flags: [],
      inputs: { posting: true, realMaterial: true },
    });
    const s = reviewPresentationState({ outcome, freshness: "fresh", covered: false });
    expect(s.state).toBe("clean");
    // The sweep's allow-path fires: the clean state DOES carry a reassuring line.
    expect(sweep(s)).toMatch(/no issues flagged/i);
  });

  it("COMPLETE but with inputs withheld is NOT clean (the extra clean conjunct), even with zero flags", () => {
    const outcome = reviewed({
      verdictKind: REVIEW_KIND.COMPLETE,
      engineMode: "full",
      missingChecks: [],
      checkedChecks: [...FLOOR, ...LLM],
      flags: [],
      inputs: { posting: false, realMaterial: true },
    });
    const s = reviewPresentationState({ outcome, freshness: "fresh", covered: false });
    expect(s.state).not.toBe("clean");
  });
});

describe("reviewPresentationState -- A-1a inputs withheld (LIVE this slice)", () => {
  it("inputs.posting === false moves 'posting keywords' OUT of Checked and INTO Not-fully-checked, and adds a sentence", () => {
    const s = reviewPresentationState({ outcome: reviewed({ inputs: { posting: false, realMaterial: true } }), freshness: "fresh", covered: false });
    // The A-1a mutant (lists missing-keyword as checked regardless of posting) reds here.
    expect(s.notice.checked).not.toContain(POSTING_KEYWORDS);
    expect(s.notice.notChecked).toContain(POSTING_KEYWORDS);
    expect(s.notice.sentences.join(" ")).toMatch(/no job posting|posting .*(not|was not)|keywords were not/i);
  });

  it("CONTROL: with posting supplied, 'posting keywords' stays in Checked", () => {
    const s = reviewPresentationState({ outcome: reviewed({ inputs: { posting: true, realMaterial: true } }), freshness: "fresh", covered: false });
    expect(s.notice.checked).toContain(POSTING_KEYWORDS);
    expect(s.notice.notChecked).not.toContain(POSTING_KEYWORDS);
  });

  it("inputs.realMaterial === false adds the 'uploaded resume not available' sentence", () => {
    const s = reviewPresentationState({ outcome: reviewed({ inputs: { posting: true, realMaterial: false } }), freshness: "fresh", covered: false });
    expect(s.notice.sentences.join(" ")).toMatch(/uploaded resume.*not available|not available to compare/i);
  });
});

describe("reviewPresentationState -- A-2 engineMode-derived headline", () => {
  it("engineMode 'mechanical-only' names the mechanical scope", () => {
    const s = reviewPresentationState({ outcome: reviewed({ engineMode: "mechanical-only" }), freshness: "fresh", covered: false });
    expect(s.headline).toMatch(/mechanical/i);
  });

  it("engineMode 'full' (still partial for another reason) does NOT say 'mechanical'", () => {
    // A judge that reported fewer than seven categories: full engine, still partial.
    const outcome = reviewed({ engineMode: "full", verdictKind: REVIEW_KIND.PARTIAL, missingChecks: [CATEGORY.CONSISTENCY], checkedChecks: [...FLOOR, CATEGORY.EMPLOYER_PLAUSIBILITY, CATEGORY.UNSUPPORTED_AUTHORITY] });
    const s = reviewPresentationState({ outcome, freshness: "fresh", covered: false });
    // The A-2 mutant (hardcoded "mechanical checks only") reds here.
    expect(s.headline).not.toMatch(/mechanical/i);
  });
});

describe("reviewPresentationState -- AC-10 empty is not clean", () => {
  it("status 'empty' -> its own state, no rows, no reassuring phrase", () => {
    const s = reviewPresentationState({ outcome: { status: "empty" }, freshness: "fresh", covered: false });
    expect(s.state).toBe("empty");
    expect(s.notice.checked).toEqual([]);
    expect(s.notice.notChecked).toEqual([]);
    for (const re of FORBIDDEN) expect(sweep(s)).not.toMatch(re);
  });
});

describe("reviewPresentationState -- forbidden-phrase sweep across non-clean states", () => {
  const cases = [
    ["partial, no flags", reviewed({ flags: [] })],
    ["partial, with a flag", reviewed({ flags: [{ category: CATEGORY.UNVERIFIABLE_METRIC, spanId: "s1", draftKind: "applicationReady", message: "x", excerpt: "x" }] })],
    ["posting withheld", reviewed({ inputs: { posting: false, realMaterial: true } })],
    ["real-material withheld", reviewed({ inputs: { posting: true, realMaterial: false } })],
    ["empty", { status: "empty" }],
  ];
  for (const [name, outcome] of cases) {
    it(`no reassuring phrase in chrome: ${name}`, () => {
      const s = reviewPresentationState({ outcome, freshness: "fresh", covered: false });
      for (const re of FORBIDDEN) expect(sweep(s), `${name} must not match ${re}`).not.toMatch(re);
    });
  }
});
