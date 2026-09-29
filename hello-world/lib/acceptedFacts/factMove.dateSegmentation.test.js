// N92 Wave 1 (Control A) -- SETTLING ROUND, BUG 2 (verifier NOT-SHIP on
// acaf645, HIGH). AC-A10 segmenter denylist gaps.
//
// The shipped ABBREVIATIONS denylist (factMove.js:38) covers honorifics,
// U.S./U.K., e.g./i.e. and corporate suffixes, but MISSES the classes that
// actually occur in company facts: month abbreviations ("Jan.".."Dec."),
// "No." (as in "No. 1 ranked"), and "a.m."/"p.m.". Each is a token ending in a
// period, so the boundary regex reads the following space + capital/digit as a
// real sentence start and invents a PHANTOM slot mid-token. Measured on HEAD
// acaf645:
//   "...in Jan. 2020 and led..."            -> sentenceBounds = [26]  (phantom after "Jan.")
//   "...its Aug. 2023 flagship... downtown. I ship weekly." -> [21, 52] (phantom at 21)
//   "...the No. 1 ranked firm..."           -> [20]  (phantom after "No.")
//   "...at 9 a.m. Monday..."                -> [18]  (phantom after "a.m.")
//   "...at 5 p.m. Pacific..."               -> [28]  (phantom after "p.m.")
// All should be [] (or, where a genuine later boundary exists, only that one).
//
// The user-visible consequence (the second describe): moving a fact FORWARD
// across a paragraph containing "Aug. 2023" lands the moved fact INSIDE the
// date -- "Acme opened its Aug. <FACT> 2023 flagship..." -- because the phantom
// slot after "Aug." is offered as a legal insertion point.
//
// RED-on-HEAD REASON: factMove.js exists at acaf645 but its denylist lacks
// these tokens, so each case returns a phantom boundary (segmenter level) or
// splits a date (move level). NOT red by absence. Goes GREEN under the
// denylist additions (Jan.-Dec. incl. "Sept.", "No.", "a.m.", "p.m.").
//
// INDEPENDENT ORACLE: every positive-control offset is computed with indexOf
// against the fixture's OWN next-sentence text, never re-derived from
// sentenceBounds. The no-phantom cases assert the empty array, meaningful only
// because the positive controls below prove the segmenter is not simply inert.
//
// AC-A10 also requires that a class the denylist genuinely CANNOT resolve be
// recorded as a named owner-accepted limitation rather than left silent. The
// month/No./a.m./p.m. classes here ARE denylistable (verified: each is a
// single whitespace-delimited token ending in a period, exactly what the
// existing precedingToken + ABBREVIATIONS mechanism handles), so no new
// residual limitation is introduced by fixing them.

import { describe, it, expect } from "vitest";
import { planMoveFact, sentenceBounds } from "./factMove.js";

// --- segmenter level -------------------------------------------------------

// Month abbreviations, each followed by a year (digit) so the boundary regex's
// [A-Z0-9] lookahead fires on HEAD. Every string is unambiguously ONE
// sentence, so a returned boundary is a phantom slot.
const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "Jun.", "Jul.", "Aug.", "Sep.", "Sept.", "Oct.", "Nov.", "Dec."];

describe("sentenceBounds treats month abbreviations as NON-boundaries (AC-A10, BUG 2)", () => {
  for (const mon of MONTHS) {
    it(`finds no phantom slot after "${mon}" before a year`, () => {
      const text = `We opened the lab in ${mon} 2024 to great acclaim.`;
      expect(sentenceBounds(text)).toEqual([]);
    });
  }
});

describe("sentenceBounds treats No. / a.m. / p.m. as NON-boundaries (AC-A10, BUG 2)", () => {
  const SINGLE = {
    'No. before a digit': "Acme became the No. 1 ranked firm this year.",
    'No. before a capitalized word': "Read No. Seven in the series tonight.",
    'a.m. before a capital': "We meet at 9 a.m. Monday to review the metrics.",
    'p.m. before a capital': "The release ships at 5 p.m. Pacific each Friday.",
  };
  for (const [name, text] of Object.entries(SINGLE)) {
    it(`finds no phantom slot: ${name}`, () => {
      expect(sentenceBounds(text)).toEqual([]);
    });
  }
});

describe("sentenceBounds still finds the REAL boundary alongside the abbreviation (positive controls)", () => {
  it("month abbreviation + a genuine later boundary: exactly the real one", () => {
    // On HEAD this returns TWO offsets (phantom after "Aug." + the real one);
    // a correct denylist returns exactly ONE.
    const text = "Acme opened its Aug. 2023 flagship office downtown. I ship weekly.";
    expect(sentenceBounds(text)).toEqual([text.indexOf("I ship weekly.")]);
  });

  it("No. + a genuine later boundary: exactly the real one", () => {
    const text = "Acme became the No. 1 ranked firm this year. It hires fast now.";
    expect(sentenceBounds(text)).toEqual([text.indexOf("It hires fast now.")]);
  });

  it("a.m. + a genuine later boundary: exactly the real one", () => {
    const text = "The demo runs at 9 a.m. Monday every week. We ship on Fridays.";
    expect(sentenceBounds(text)).toEqual([text.indexOf("We ship on Fridays.")]);
  });

  it("CONTROL (kills 'always []'): three plain sentences still split at both real boundaries", () => {
    const text = "I lead teams. I ship code. I mentor peers.";
    expect(sentenceBounds(text)).toEqual([text.indexOf("I ship code."), text.indexOf("I mentor peers.")]);
  });
});

// --- planMoveFact level (never land mid-date) ------------------------------

describe("planMoveFact never lands a moved fact INSIDE a date (AC-A10 + AC-A2, BUG 2)", () => {
  const GREETING = "Dear Hiring Manager,";
  const F2 = "We shipped a new API.";

  it("moving a preceding fact forward across an 'Aug. 2023' sentence clears the whole sentence", () => {
    const lines = [GREETING, `${F2} Acme opened its Aug. 2023 flagship office downtown. I ship weekly.`];
    const rec = { id: "art-x", text: F2, lineIndex: 1, offset: String(lines[1]).indexOf(F2) };
    const out = planMoveFact({ lines, records: [rec], id: rec.id, direction: "forward" });
    expect(out.changed).toBe(true);
    // The fact must land AFTER the entire "...downtown." sentence, never
    // between "Aug." and "2023". Independent-oracle literal for the whole line:
    expect(out.lines[1]).toBe(`Acme opened its Aug. 2023 flagship office downtown. ${F2} I ship weekly.`);
    // Explicit no-mid-date guard (fails loudly on HEAD, which produces
    // "...its Aug. We shipped a new API. 2023 flagship..."):
    expect(out.lines[1]).toContain("Aug. 2023");
    expect(out.lines[1]).not.toContain("Aug. We shipped");
    // the moved record still locates its own text
    const moved = out.records.find((r) => r.id === "art-x");
    expect(String(out.lines[moved.lineIndex]).slice(moved.offset, moved.offset + F2.length)).toBe(F2);
  });
});
