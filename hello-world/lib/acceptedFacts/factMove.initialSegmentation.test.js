// N92 Wave 1 (Control A) -- FINAL SETTLING ROUND, BUG-4 (fresh-verifier
// NOT-SHIP on be3ddba, HIGH). AC-A10 segmenter: a personal-name INITIAL.
//
// THE BUG. A single uppercase letter followed by a period ("J." in "J. Smith")
// is an INITIAL, not a sentence end -- but the boundary regex
// (factMove.js:30 `/(?<=[.!?])\s+(?=[A-Z0-9"'“(])/`) reads the "J." + space +
// capital "S" as a real sentence start, and the closed ABBREVIATIONS denylist
// (factMove.js:42) does not (and cannot, being a fixed token list) name every
// possible initial. So sentenceBounds invents a PHANTOM slot BETWEEN an initial
// and the surname, and planMoveFact will land a moved fact there -- splicing a
// company fact into the middle of a person's name. Verifier reproduction on
// be3ddba:
//   lines[1] = "We shipped a new API. Contact J. Smith about the offer today. I ship weekly."
//   planMoveFact(fact "We shipped a new API." forward)
//   -> "...Contact J. We shipped a new API. Smith about the offer today..."   (fact spliced mid-name)
//
// THE FIX THIS FILE BINDS (sentenceBounds must suppress a "single uppercase
// letter + period" token as a NON-boundary, so no slot is ever offered between
// an initial and the surname; planMoveFact then clears the whole name).
//
// PROVENANCE OF THE ENTRY POINT (reachability). planMoveFact is not a test-only
// shim: it is the single pure primitive Control A's real handler calls --
// `useCompanyResearch.js:634` (`planMoveFact({ lines, records: insertedFacts,
// id: factId, direction })`) and Wave 2's forward nudge call the SAME function.
// The segmentation a user actually gets when they click the move control IS
// what sentenceBounds/planMoveFact compute here; driving the primitive is the
// production segmentation path, not a bypass. (AC-A10's own instrument is a
// "pure segmenter unit"; AC-A2's is jsdom render+click for one-click-one-slot,
// out of scope for this segmenter-quality bug.)
//
// INDEPENDENT ORACLE (loop-traps: a canary from the same source proves
// consistency, not correctness). Every positive-control offset is computed with
// String.prototype.indexOf against the fixture's OWN next-sentence text, never
// re-derived from sentenceBounds; the no-phantom cases assert the empty array,
// meaningful ONLY because the positive controls below prove the segmenter is
// not simply inert (kills an "always return []" mutant).
//
// RED-ON-HEAD REASON: factMove.js EXISTS at be3ddba but neither its regex nor
// its closed denylist suppresses a single-capital initial, so every
// initial-fixture returns a phantom boundary (segmenter level) or splices the
// name (move level). NOT red by absence -- red because the shipped code
// mis-splits. Goes GREEN only under the single-initial suppression rule.
//
// THE DELIBERATE, OWNER-ACCEPTED TRADEOFF (this is what ENDS the round -- see
// the last describe). Suppressing a boundary after "single capital + period"
// means a sentence that GENUINELY ends in a single capital letter followed by a
// new capitalized sentence (a grade: "...earned an A. The next year...") will
// now MERGE rather than split. That merge is far rarer and far less damaging
// than splicing a person's name, and is INDISTINGUISHABLE from an initial by
// any local rule (an "A." before a capital could be either) -- so it is
// accepted, asserted here as the intended behaviour, and disclosed in the
// module header per AC-A10. A mutant that suppresses ALL single-capital
// boundaries and a correct fix are therefore the SAME function on this axis;
// the positive controls below discriminate only the boundaries that do NOT end
// in a single capital (which is every real boundary that is not a bare grade).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { planMoveFact, sentenceBounds } from "./factMove.js";

// ---------------------------------------------------------------------------
// 1. segmenter level: a single-letter initial is NOT a sentence boundary
// ---------------------------------------------------------------------------

// Each is unambiguously ONE sentence in real English, so a returned boundary is
// a phantom slot that would land a fact mid-name -- never a judgement call.
const SINGLE_SENTENCE_WITH_INITIAL = {
  "one initial: J. Smith": "Please contact J. Smith about the offer.",
  "one initial mid-clause: R. Diaz": "The lead engineer is R. Diaz this quarter.",
  "two initials: J. R. Smith": "Please contact J. R. Smith about the offer.",
  "three initials: A. B. C. Wong": "Our founder is A. B. C. Wong himself.",
  "initial before a capitalized common word": "We hired T. Baker for the role.",
};

describe("sentenceBounds treats a single-letter INITIAL as a NON-boundary (AC-A10, BUG-4)", () => {
  for (const [name, text] of Object.entries(SINGLE_SENTENCE_WITH_INITIAL)) {
    it(`finds no phantom slot inside a name: ${name}`, () => {
      // Exactly one sentence -> exactly zero after-first boundaries. Paired with
      // the positive controls below, [] means "did not invent a slot", not
      // "inert". On HEAD each of these returns a phantom offset before the
      // surname (e.g. before "Smith").
      expect(sentenceBounds(text)).toEqual([]);
    });
  }
});

describe("sentenceBounds still finds a REAL boundary next to an initial (positive controls; kill 'always []')", () => {
  it("initial in sentence 1 + a genuine later boundary: exactly the real one", () => {
    // THE KILLER DISCRIMINATOR against over-suppression: the real boundary here
    // ends in "Smith." (a MULTI-letter word), so a correct fix must STILL fire
    // it even though an initial "J." sits earlier in the sentence. On HEAD this
    // returns TWO offsets (a phantom before "Smith" + the real one); a correct
    // fix returns exactly ONE.
    const text = "We met J. Smith last week. I ship weekly.";
    expect(sentenceBounds(text)).toEqual([text.indexOf("I ship weekly.")]);
  });

  it("initial-ending clause is one unit; the next real boundary still fires", () => {
    const text = "Our contact is J. R. Diaz today. She hires fast now.";
    expect(sentenceBounds(text)).toEqual([text.indexOf("She hires fast now.")]);
  });

  it("CONTROL (kills 'always []' AND over-suppression of ordinary boundaries): three plain sentences still split", () => {
    // Stays GREEN on HEAD and after the fix -- proves the fix does not
    // over-suppress ordinary multi-letter boundaries and the segmenter is live.
    const text = "I lead teams. I ship code. I mentor peers.";
    expect(sentenceBounds(text)).toEqual([text.indexOf("I ship code."), text.indexOf("I mentor peers.")]);
  });
});

// ---------------------------------------------------------------------------
// 2. move level: never splice a fact into a person's name (the user-visible bug)
// ---------------------------------------------------------------------------

describe("planMoveFact never lands a moved fact INSIDE a name (AC-A10 + AC-A2, BUG-4)", () => {
  const GREETING = "Dear Hiring Manager,";
  const CLOSING = "Sincerely,";
  const F = "We shipped a new API.";

  it("moving a preceding fact forward across a 'J. Smith' sentence clears the whole sentence", () => {
    // The exact verifier reproduction from be3ddba.
    const lines = [GREETING, `${F} Contact J. Smith about the offer today. I ship weekly.`, CLOSING];
    const rec = { id: "art-4", text: F, lineIndex: 1, offset: 0 };
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    // The fact must land AFTER the ENTIRE "...today." sentence, never between
    // "J." and "Smith". Independent-oracle literal for the whole line:
    expect(out.lines[1]).toBe(`Contact J. Smith about the offer today. ${F} I ship weekly.`);
    // Explicit no-splice-mid-name guard. On HEAD this line is
    // "Contact J. We shipped a new API. Smith about the offer today. I ship weekly."
    // so the name is torn apart:
    expect(out.lines[1]).toContain("J. Smith");
    expect(out.lines[1]).not.toContain("J. We shipped");
    // The moved record still locates its own text at its reported position.
    const moved = out.records.find((r) => r.id === "art-4");
    expect(String(out.lines[moved.lineIndex]).slice(moved.offset, moved.offset + F.length)).toBe(F);
  });

  it("two-initial name (J. R. Smith): fact clears the whole sentence, name intact", () => {
    const lines = [GREETING, `${F} Contact J. R. Smith about the role soon. I ship weekly.`, CLOSING];
    const rec = { id: "art-4b", text: F, lineIndex: 1, offset: 0 };
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    expect(out.lines[1]).toBe(`Contact J. R. Smith about the role soon. ${F} I ship weekly.`);
    expect(out.lines[1]).toContain("J. R. Smith");
    // On HEAD the fact would splice after the first initial ("Contact J. We shipped...").
    expect(out.lines[1]).not.toContain("J. We shipped");
    expect(out.lines[1]).not.toContain("R. We shipped");
  });
});

// ---------------------------------------------------------------------------
// 3. POSITIVE CONTROL at move level: a REAL boundary next to an initial still
//    lands the fact correctly (guards against a fix that suppresses too much).
// ---------------------------------------------------------------------------

describe("planMoveFact still lands on a real boundary that sits next to an initial (BUG-4 over-suppression control)", () => {
  const GREETING = "Dear Hiring Manager,";
  const CLOSING = "Sincerely,";
  const F = "We shipped a new API.";

  it("forward move stops at the real boundary after 'Smith.', not inside the name", () => {
    // "We met J. Smith." is ONE sentence (initial suppressed); the real
    // boundary is after "Smith." A correct fix moves the fact past that WHOLE
    // sentence exactly once. This fails if a fix suppresses the real
    // "Smith." boundary too (it would then jump two sentences or none).
    const lines = [GREETING, `${F} We met J. Smith last week. I ship weekly now.`, CLOSING];
    const rec = { id: "art-4c", text: F, lineIndex: 1, offset: 0 };
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    expect(out.lines[1]).toBe(`We met J. Smith last week. ${F} I ship weekly now.`);
  });
});

// ---------------------------------------------------------------------------
// 4. THE OWNER-ACCEPTED TRADEOFF: a genuine single-capital sentence end MERGES.
//    Asserted here as the INTENDED behaviour that ENDS the segmentation round.
// ---------------------------------------------------------------------------

describe("ACCEPTED TRADEOFF (AC-A10): a genuine single-capital sentence end now MERGES rather than splits", () => {
  it("segmenter: 'She earned an A. The next year improved.' yields NO boundary (merge accepted)", () => {
    // "A." is a single capital + period; it is INDISTINGUISHABLE from an
    // initial by any local rule, so it is suppressed and the two sentences
    // MERGE into one movable unit. This is deliberately accepted: losing this
    // rare, low-damage boundary is the price of never splicing a name. On HEAD
    // this returns [indexOf("The next year improved.")] (it splits).
    const text = "She earned an A. The next year improved.";
    expect(sentenceBounds(text)).toEqual([]);
  });

  it("move: a fact jumps the WHOLE merged 'A.'-then-capital span as one unit (accepted)", () => {
    const GREETING = "Dear Hiring Manager,";
    const CLOSING = "Sincerely,";
    const F = "We shipped a new API.";
    const lines = [GREETING, `${F} She earned an A. The next year improved. I ship weekly.`, CLOSING];
    const rec = { id: "art-4d", text: F, lineIndex: 1, offset: 0 };
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    // ACCEPTED: the fact clears BOTH "She earned an A." and "The next year
    // improved." at once, because the "A." boundary is deliberately given up.
    // On HEAD the fact would stop after "A." ("She earned an A. We shipped...").
    expect(out.lines[1]).toBe(`She earned an A. The next year improved. ${F} I ship weekly.`);
  });
});

// ---------------------------------------------------------------------------
// 5. MANDATED DISCLOSURE GATE (AC-A10). This is a source-text presence check,
//    NOT a behaviour assertion -- it is the exception the standing rules allow
//    for a mandated disclosure: AC-A10 requires an owner-accepted limitation be
//    named in the module, never left silent. It asserts the module header
//    records BOTH residuals this fix introduces. It cannot catch a WRONG or
//    misleading disclosure -- only a missing one. The behavioural guarantees
//    live in describes 1-4 above; this only guards that the residual is written
//    down where a future maintainer will see it.
// ---------------------------------------------------------------------------

const FACT_MOVE_SRC = readFileSync(fileURLToPath(new URL("./factMove.js", import.meta.url)), "utf8");

describe("factMove.js discloses the BUG-4 owner-accepted residuals (AC-A10 mandated-disclosure gate)", () => {
  it("CANARY: the source read + regex path works (matches an existing header token)", () => {
    // Positive canary so a red below means "phrase absent", never "file unread"
    // or "regex engine broken". 'denylist' is present in the shipped header.
    expect(FACT_MOVE_SRC).toMatch(/denylist/i);
  });

  it("names the single-capital initial handling", () => {
    // RED on HEAD: the shipped header never mentions initials.
    expect(FACT_MOVE_SRC).toMatch(/\binitial\b/i);
  });

  it("discloses residual (a): a genuine single-capital sentence end now MERGES", () => {
    // RED on HEAD: 'merge' and 'single capital' are both absent from the header.
    expect(FACT_MOVE_SRC).toMatch(/single[- ]?(capital|uppercase|letter)[\s\S]{0,260}?merg/i);
  });

  it("discloses residual (b): a multi-letter abbreviation off the closed denylist may still phantom-split", () => {
    // RED on HEAD: the shipped header names only the 'Inc.' residual, never the
    // general 'multi-letter abbreviation not on the list' class.
    expect(FACT_MOVE_SRC).toMatch(/multi-?letter[\s\S]{0,160}?abbreviation[\s\S]{0,160}?(phantom|split)/i);
  });
});
