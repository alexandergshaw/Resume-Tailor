import { describe, it, expect } from "vitest";

// N92 Wave 3 (Control B) -- the AUTOMATED first-layer faithfulness guards, as
// pure functions (AC-B1/B2 scope, AC-B3a/B5 added-token; design N92
// section 3.2, plan W3-S1). These are LAYER ONE. They run BEFORE the user's
// confirm gate and reject a candidate outright (discard, never shown) when it
// leaves the allowed span or introduces a fabricated number/date/name.
//
// HONESTY (AC-B3b, owner ruling D7): these guards catch SCOPE and ADDED TOKENS
// ONLY. Negation and inflation that REUSE existing tokens (dropping a "not",
// "helped"->"led", "a team"->"the team") are NOT auto-catchable and are NOT
// claimed to be. The `negation slips past` control below is deliberate: it
// PROVES the guard is blind to meaning, so the confirm gate (see
// smoothTransition.confirmPersist.rc.test.js, AC-B10/B12) is load-bearing, not
// decorative. A test suite that pretended checkAddedTokens caught meaning would
// be lying about the exact risk this whole feature was re-architected around.
//
// CONTRACT PINNED (design N92 section 3.2/3.3; a later seat may satisfy it with
// different internals, but these signatures are the 4b hand-off):
//   scopeSentences({ lines, records, id }) ->
//       { ok:true, span:{lineIndex,start,end}, factText, inScopeText } | { ok:false, reason }
//     -- the span is a SINGLE paragraph char range covering the sentence before
//        the fact (if any, same paragraph), the fact sentence, and the sentence
//        after (if any, same paragraph). It NEVER reaches into an adjacent
//        paragraph (AC-B2).
//   checkScope(originalLines, candidateLines, span) -> { ok, reason }
//     -- true iff candidateLines differ from originalLines ONLY inside
//        span.lineIndex, and even there only within the [start,end) region
//        (prefix before `start` and the suffix after `end` are byte-preserved).
//   checkAddedTokens(inScopeText, candidateText) -> { ok, reason, code }
//     -- false when the candidate introduces a number/currency/year/date or a
//        proper name absent from the in-scope source text.
//
// RED ON HEAD: lib/coverFacts/smoothTransition.js does not exist, so this file
// fails at collection. TDD hand-off red (grep smoothTransition = none,
// 2026-09-29).

import { scopeSentences, checkScope, checkAddedTokens } from "./smoothTransition.js";

// A three-body-paragraph letter with a located fact in the MIDDLE sentence of
// the middle paragraph, so there is a real "before" and a real "after" sentence
// in the same paragraph (the general case, AC-B1).
const FACT_TEXT = "Acme opened a Dublin lab in 2021.";
function letter() {
  const p1 = "Dear Hiring Manager,";
  // paragraph index 1 (body): before-sentence + fact-sentence + after-sentence.
  const before = "I led the platform team.";
  const after = "We shipped quickly.";
  const p2 = `${before} ${FACT_TEXT} ${after}`;
  const p3 = "I would welcome the chance to talk.";
  const lines = [p1, p2, p3];
  const records = [{ id: "f1", text: FACT_TEXT, lineIndex: 1, offset: p2.indexOf(FACT_TEXT), url: "https://x.test/a", title: "T" }];
  return { lines, records };
}

describe("scopeSentences pins the editable region to three same-paragraph sentences (AC-B1/B2)", () => {
  it("spans the sentence before, the fact, and the sentence after -- inside ONE paragraph", () => {
    const { lines, records } = letter();
    const r = scopeSentences({ lines, records, id: "f1" });
    expect(r.ok, "scopeSentences refused a normal mid-paragraph fact").toBe(true);
    expect(r.span.lineIndex, "the span escaped the fact's own paragraph").toBe(1);
    const region = lines[1].slice(r.span.start, r.span.end);
    // the region contains all three sentences...
    expect(region).toContain("I led the platform team.");
    expect(region).toContain(FACT_TEXT);
    expect(region).toContain("We shipped quickly.");
    // ...and NOTHING from another paragraph (the blast-radius bound, AC-B1).
    expect(region).not.toContain("Dear Hiring Manager");
    expect(region).not.toContain("welcome the chance");
    // the fact text itself is surfaced for the added-token check's source set.
    expect(r.factText).toBe(FACT_TEXT);
    expect(r.inScopeText).toContain(FACT_TEXT);
  });

  it("shrinks at the paragraph's FIRST sentence: no 'before', never reaches the previous paragraph (AC-B2)", () => {
    // Fact is the FIRST sentence of a body paragraph. The span must start at the
    // fact (no preceding sentence pulled in) and MUST NOT reach line 0.
    const first = FACT_TEXT;
    const p2 = `${first} We shipped quickly.`;
    const lines = ["Dear Hiring Manager,", p2, "Regards,"];
    const records = [{ id: "f1", text: first, lineIndex: 1, offset: 0 }];
    const r = scopeSentences({ lines, records, id: "f1" });
    expect(r.ok).toBe(true);
    expect(r.span.lineIndex).toBe(1);
    // no reach backward into a prior sentence/paragraph: the region starts at the fact.
    expect(r.span.start, "a first-in-paragraph fact pulled a 'before' sentence into scope").toBe(0);
    expect(lines[1].slice(r.span.start, r.span.end)).not.toContain("Hiring Manager");
  });

  it("shrinks at the paragraph's LAST sentence: no 'after' pulled in (AC-B2)", () => {
    const last = FACT_TEXT;
    const p2 = `I led the platform team. ${last}`;
    const lines = ["Dear Hiring Manager,", p2, "Regards,"];
    const records = [{ id: "f1", text: last, lineIndex: 1, offset: p2.indexOf(last) }];
    const r = scopeSentences({ lines, records, id: "f1" });
    expect(r.ok).toBe(true);
    // the span ends at the paragraph end (the fact is last); no next paragraph text.
    expect(r.span.end, "a last-in-paragraph fact pulled an 'after' sentence into scope").toBe(p2.length);
  });

  it("refuses a stale locator rather than guessing a span (AC-B2 / AC-A8 parallel)", () => {
    const { lines } = letter();
    const records = [{ id: "f1", text: FACT_TEXT, lineIndex: 1, offset: 999 }];
    const r = scopeSentences({ lines, records, id: "f1" });
    expect(r.ok, "scopeSentences invented a span for a fact not at its recorded offset").toBe(false);
  });
});

describe("checkScope: a rewrite outside the span is rejected (AC-B1) -- with a passing control", () => {
  const { lines } = letter();
  const span = { lineIndex: 1, start: lines[1].indexOf("I led"), end: lines[1].length };

  it("PASSES an in-span-only rewrite (the control: the guard must not over-fire)", () => {
    const rewritten = [...lines];
    rewritten[1] = "I led the platform team, and Acme opened a Dublin lab in 2021, so we shipped quickly.";
    const r = checkScope(lines, rewritten, span);
    expect(r.ok, "checkScope rejected a legitimate in-span rewrite -- it over-fires").toBe(true);
  });

  it("REJECTS a candidate that changed a DIFFERENT paragraph (blast radius escape)", () => {
    const rewritten = [...lines];
    rewritten[1] = "I led the platform team, and Acme opened a Dublin lab in 2021, so we shipped quickly.";
    rewritten[2] = "I would ABSOLUTELY welcome the chance to talk."; // outside the span
    const r = checkScope(lines, rewritten, span);
    expect(r.ok, "checkScope let a change to another paragraph through -- the AC-B1 defect").toBe(false);
  });

  it("REJECTS a candidate that changed the PREFIX before the span on the same line", () => {
    // The greeting-side prefix of the fact's own paragraph is outside the span.
    const span2 = { lineIndex: 1, start: lines[1].indexOf(FACT_TEXT), end: lines[1].length };
    const rewritten = [...lines];
    rewritten[1] = "I proudly led the platform team. Acme opened a Dublin lab in 2021. We shipped quickly.";
    const r = checkScope(lines, rewritten, span2);
    expect(r.ok, "checkScope let a change BEFORE the span (outside it) through").toBe(false);
  });
});

describe("checkAddedTokens rejects fabricated facts, passes a faithful reword (AC-B3a/B5)", () => {
  const inScope = "I led the platform team. Acme opened a Dublin lab in 2021. We shipped quickly.";

  it("PASSES a faithful reword that reuses only existing tokens (the control)", () => {
    const faithful = "Having led the platform team, I saw Acme open its Dublin lab in 2021, and we then shipped quickly.";
    const r = checkAddedTokens(inScope, faithful);
    expect(r.ok, "checkAddedTokens rejected a faithful reword -- it over-fires and would block every smoothing").toBe(true);
  });

  it("REJECTS a candidate that invents a NEW number", () => {
    const withNumber = "Acme opened a Dublin lab in 2021 with 400 engineers, and we shipped quickly.";
    const r = checkAddedTokens(inScope, withNumber);
    expect(r.ok, "a fabricated headcount (400) reached the confirm surface labelled faithful").toBe(false);
  });

  it("REJECTS a candidate that invents a NEW year/date", () => {
    const withYear = "Acme opened a Dublin lab in 2021 and doubled it in 2024, so we shipped quickly.";
    const r = checkAddedTokens(inScope, withYear);
    expect(r.ok, "a fabricated year (2024) was not caught").toBe(false);
  });

  it("REJECTS a candidate that invents a NEW proper name", () => {
    const withName = "Acme opened a Dublin lab in 2021, later praised by Forbes, and we shipped quickly.";
    const r = checkAddedTokens(inScope, withName);
    expect(r.ok, "a fabricated attribution (Forbes) was not caught").toBe(false);
  });

  it("REJECTS a new currency amount", () => {
    const src = "Acme raised $50M in 2021.";
    const withMoney = "Acme raised $50M in 2021 and later another $120M.";
    const r = checkAddedTokens(src, withMoney);
    expect(r.ok, "a fabricated raise ($120M -> 120) was not caught").toBe(false);
  });

  // THE HONEST LIMIT (AC-B3b). This control asserts the guard is BLIND to a
  // meaning inversion that reuses existing tokens. If a future change made
  // checkAddedTokens "smart" enough to catch this, that would be a FALSE
  // promise the AC forbids (the confirm gate is the meaning check, not this).
  // The test therefore pins the blindness on purpose -- it must stay GREEN, and
  // its companion is AC-B10/B12's confirm-before-persist, which is the real
  // guard for exactly this class.
  it("does NOT catch a negation that reuses existing tokens -- confirm gate is the backstop (AC-B3b)", () => {
    const negated = "Acme never opened a Dublin lab in 2021, though we shipped quickly.";
    const r = checkAddedTokens(inScope, negated);
    expect(
      r.ok,
      "checkAddedTokens claimed to catch a meaning inversion -- the AC forbids that claim; the user confirm gate is the meaning check",
    ).toBe(true);
  });
});
