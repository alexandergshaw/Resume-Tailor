// N92 Wave 1 (Control A) -- AC-A10: the segmenter quality gate.
//
// `sentenceBounds(text)` returns the char offsets in the RAW, uncollapsed
// string where each sentence AFTER the first begins (design §1.2, plan
// W1-S1). It is the primitive planMoveFact uses to find the inter-sentence
// gaps a fact can move between. Without this file AC-A2 is ZERO POWER: it
// would assert move order against whatever the segmenter itself reports, so a
// segmenter that invents a phantom slot mid-abbreviation ("U.S. | Army")
// lands a fact mid-sentence and every order assertion still passes (AC §2
// AC-A2 note; plan §8 W1-S1 SILENT row).
//
// RED-on-HEAD: `lib/acceptedFacts/factMove.js` does not exist at HEAD (grep
// moveFact|sentenceBounds = none, 2026-09-28), so the import throws at
// collection and every case is red by absence.
//
// INDEPENDENT ORACLE (loop-traps "a canary built from the same source proves
// consistency, not correctness"): every expected offset is computed with
// `String.prototype.indexOf` against the fixture's OWN next-sentence text --
// the real-world fact "sentence 2 starts here" -- never re-derived from
// sentenceBounds. So an off-by-one or a global mis-index in the segmenter
// cannot move the input and the expectation together.
//
// THE TWO MUTANTS THIS FILE MUST KILL (brief, "a naive /[.!?]/ segmenter
// mutant that reds the abbreviation fixtures"):
//   * a `/[.!?]/`-only splitter -- caught by the lowercase-follows fixtures
//     (Ph.D., $50M., 3.5, Node.js) AND the positive controls;
//   * a `/[.!?]\s+[A-Z]/` splitter (the summarize.js boundary regex WITHOUT
//     the abbreviation denylist -- which the AC/design confirm mis-splits
//     "U.S. Army") -- caught by the capital-follows fixtures (Dr., Mr., Ms.,
//     U.S. + Capital) and the combined U.S.-then-real-boundary control.
// The positive controls are what stop "always return []" -- a dead segmenter
// that passes every abbreviation case -- from counting as coverage.

import { describe, it, expect } from "vitest";
import { sentenceBounds } from "./factMove.js";

// A sentence that stands alone: sentenceBounds must find NO boundary in it.
// Each is unambiguously ONE sentence in real English, so a returned boundary
// is a phantom slot, not a judgement call.
const SINGLE_SENTENCE = {
  "honorific Dr. + Capital": "Dr. Smith joined Acme.",
  "honorific Mr. + Capital": "Contact Mr. Lee today at noon.",
  "honorific Ms. + Capital": "Reach Ms. Diaz before Friday.",
  "abbreviation U.S. + Capital": "We serve the U.S. Army every day.",
  "abbreviation e.g. + lowercase": "Bring gear, e.g. boots and rope.",
  "abbreviation i.e. + lowercase": "It shipped late, i.e. in March.",
  "degree Ph.D. + lowercase": "She holds a Ph.D. in applied physics.",
  "decimal 3.5 + lowercase": "Revenue rose 3.5 percent last spring.",
  "currency $50M. + lowercase": "They raised $50M. from three funds.",
  "period inside quotes + lowercase": 'He said "go." then walked out.',
  "period inside parentheses + lowercase": "(see the note.) more detail follows.",
  "intra-word dot Node.js": "Node.js powers the whole service.",
};

describe("sentenceBounds treats abbreviations/decimals/currency/quotes as NON-boundaries (AC-A10)", () => {
  for (const [name, text] of Object.entries(SINGLE_SENTENCE)) {
    it(`finds no phantom slot in: ${name}`, () => {
      // Exactly one sentence -> exactly zero after-first boundaries. An empty
      // array here, paired with the positive controls below, is meaningful:
      // it says the segmenter did not invent a slot, not that it is inert.
      expect(sentenceBounds(text)).toEqual([]);
    });
  }
});

describe("sentenceBounds finds the REAL boundaries (positive controls; kills 'always []')", () => {
  it("returns each after-first sentence start for three plain sentences", () => {
    const text = "I lead teams. I ship code. I mentor peers.";
    // Independent oracle: the offsets where sentences 2 and 3 actually begin.
    expect(sentenceBounds(text)).toEqual([text.indexOf("I ship code."), text.indexOf("I mentor peers.")]);
  });

  it("splits at the real boundary but NOT after an abbreviation before it (U.S. Army. + sentence)", () => {
    // The killer discriminator: a `\s+[A-Z]` segmenter returns TWO offsets
    // here (a phantom after "U.S." and the real one). A correct segmenter
    // returns exactly ONE -- the start of the genuine second sentence.
    const text = "We serve the U.S. Army with pride. I ship code weekly.";
    expect(sentenceBounds(text)).toEqual([text.indexOf("I ship code weekly.")]);
  });

  it("splits after '?' and '!' boundaries too, not only '.'", () => {
    const text = "Are you ready? I am. Let's go!";
    expect(sentenceBounds(text)).toEqual([text.indexOf("I am."), text.indexOf("Let's go!")]);
  });
});

describe("sentenceBounds never points into an abbreviation even alongside a real boundary", () => {
  it("keeps the honorific intact when a later real boundary exists", () => {
    const text = "Dr. Smith runs the lab there. She hires fast.";
    // Only the true boundary (start of "She hires fast."), never a slot right
    // after "Dr." -- which would land a moved fact between "Dr." and "Smith".
    const bounds = sentenceBounds(text);
    expect(bounds).toEqual([text.indexOf("She hires fast.")]);
    // Explicit no-phantom guard: no returned offset sits just past "Dr. ".
    const afterHonorific = text.indexOf("Dr. ") + "Dr. ".length;
    expect(bounds).not.toContain(afterHonorific);
  });
});
