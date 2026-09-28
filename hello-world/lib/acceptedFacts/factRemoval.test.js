// N61 (removal, S1) -- the pure INVERSE of insertion. planRemoveFact excises
// one accepted fact's clause from a cover letter's lines and returns a
// paragraph that reads as it did BEFORE the fact was inserted -- no doubled
// space, no orphaned connective (AC-N61.16).
//
// LOCATED, NOT TEXT-KEYED (fresh-verifier findings F1/F2, 2026-09-27): a fact's
// recorded text can occur zero times (whitespace-collapsed on insert) or more
// than once (duplicated in another paragraph, or a substring of a longer fact)
// in the letter. So removal and highlighting must key on the fact's LINE INDEX
// and CHARACTER OFFSET, not on a global text search -- otherwise a claim is
// unremovable, or the wrong occurrence is deleted and an overlapping fact is
// corrupted. planCoverFacts therefore records {id, text, lineIndex, offset}
// with text normalised the SAME way the composed line is, and planRemoveFact
// consumes that locator.
//
// The forward direction is the REAL planCoverFacts (via planAcceptForEntry),
// covered by factInsertion.test.js -- so a round-trip that lands back on a
// HAND-WRITTEN original (never a value re-derived from the removal itself) pins
// the inverse against an independent oracle.
//
// WHAT THIS FILE CANNOT CATCH: (1) it excises at the recorded offset, so a
// record whose offset is itself wrong would remove the wrong span -- the
// "record locates the fact" invariant (F1 block) is what guards that. (2) The
// readability guard catches a MALFORMED paragraph, never a WRONG-but-readable
// one; the byte-exact assertions pin correctness.

import { describe, it, expect, beforeAll } from "vitest";
import { planRemoveFact, planAcceptForEntry } from "@/lib/acceptedFacts/factInsertion.js";
import { applyCoverDocxEdits } from "@/lib/acceptedFacts/factDocx.js";
import { parseDocxToModel, modelToLines } from "@/lib/document/docxPreview.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

const ORIGINAL = Object.freeze([
  "Dear Hiring Manager,",
  "I am excited to apply for the Staff Engineer role. My background in telemetry aligns closely with your team's needs.",
  "In my current role I lead a platform team of eight engineers.",
  "Sincerely,",
  "Alex Shaw",
]);

const END_FACT = { id: "f-end", text: "I read that Acme opened a Dublin lab.", placement: "current" };
const A_FACT = { id: "f-a", text: "Acme telemetry work is exactly my focus.", placement: "intro" };
const B_FACT = { id: "f-b", text: "I admired Acme open-source telemetry SDK.", placement: "intro" };

function insertCover(lines, facts) {
  return planAcceptForEntry({ coverLetterResultLines: lines }, { facts }).cover;
}
// The removal locator = the fact's own record entry {id, text, lineIndex, offset}.
function loc(cover, id) {
  const entry = cover.record.find((r) => r.id === id);
  expect(entry, `no record entry for ${id}`).toBeTruthy();
  return entry;
}
function occurrences(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}
function readabilityViolations(line) {
  const s = String(line);
  const v = [];
  if (/\s{2,}/.test(s)) v.push("doubled-space");
  if (/^\s|\s$/.test(s)) v.push("edge-space");
  if (/\s[.,;:!?]/.test(s)) v.push("space-before-punct");
  return v;
}

describe("planRemoveFact -- instrument sanity", () => {
  it("the readability guard bites a malformed paragraph and clears a clean one", () => {
    expect(readabilityViolations("A team.  Beyond that .")).toEqual(
      expect.arrayContaining(["doubled-space", "space-before-punct"]),
    );
    expect(readabilityViolations(" leading")).toEqual(["edge-space"]);
    expect(readabilityViolations("A perfectly ordinary sentence about work.")).toEqual([]);
  });

  it("the occurrence counter is exact (canary for the overlap tests below)", () => {
    expect(occurrences("a b a b a", "a")).toBe(3);
    expect(occurrences("Acme opened a lab. a lab.", "a lab.")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F1: the excisable-substring invariant -- the recorded text must OCCUR in the
// letter at the recorded location, or the fact is unremovable and
// unhighlightable. Broken today for any fact with multi-internal-whitespace
// (factInsertion.js:50/52 collapses the line but :107 stores the raw text).
// ---------------------------------------------------------------------------
describe("F1: a multi-whitespace fact is recorded so it can still be found and removed", () => {
  const MULTI = { id: "f-multi", text: "Acme opened  a Dublin  lab.", placement: "current" }; // double spaces

  it("the record locates the fact: lines[lineIndex].slice(offset, offset+len) === record.text", () => {
    const cover = insertCover(ORIGINAL, [MULTI]);
    const rec = loc(cover, "f-multi");
    expect(typeof rec.lineIndex, "record carries no lineIndex").toBe("number");
    expect(typeof rec.offset, "record carries no offset").toBe("number");
    // The stored text must occur, verbatim, at the stored location -- else a
    // removal/highlight keyed on it finds nothing (the claim is stuck in the
    // letter, unremovable, all the way to egress).
    expect(
      cover.lines[rec.lineIndex].slice(rec.offset, rec.offset + rec.text.length),
      "the recorded fact text does not occur at its recorded location -- unremovable claim",
    ).toBe(rec.text);
  });

  it("a multi-whitespace fact round-trips: insert then remove restores the original paragraph", () => {
    const cover = insertCover(ORIGINAL, [MULTI]);
    const out = planRemoveFact(cover.lines, loc(cover, "f-multi"));
    expect(out.changed).toBe(true);
    expect(out.lines, "removal did not restore the original after a multi-whitespace insert").toEqual(ORIGINAL);
    expect(readabilityViolations(out.lines[2])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Byte-exact round trip (AC-N61.16), driven through the located record.
// ---------------------------------------------------------------------------
describe("planRemoveFact -- byte-exact round trip", () => {
  it("END placement restores the original paragraph exactly", () => {
    const cover = insertCover(ORIGINAL, [END_FACT]);
    expect(cover.lines[2]).toContain(END_FACT.text); // non-vacuity
    const out = planRemoveFact(cover.lines, loc(cover, "f-end"));
    expect(out.changed).toBe(true);
    expect(out.lines).toEqual(ORIGINAL);
    expect(readabilityViolations(out.lines[2])).toEqual([]);
  });

  it("AFTER-FIRST-SENTENCE placement restores the original paragraph exactly", () => {
    const cover = insertCover(ORIGINAL, [A_FACT]);
    expect(cover.lines[1]).toContain(A_FACT.text);
    const out = planRemoveFact(cover.lines, loc(cover, "f-a"));
    expect(out.changed).toBe(true);
    expect(out.lines).toEqual(ORIGINAL);
    expect(readabilityViolations(out.lines[1])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Coalesced paragraph, remove ONE (AC-N61.14/.16). Independent oracle:
// inserting ONLY the surviving fact.
// ---------------------------------------------------------------------------
describe("planRemoveFact -- coalesced paragraph, remove ONE", () => {
  it("removing fact A leaves fact B intact and readable", () => {
    const cover = insertCover(ORIGINAL, [A_FACT, B_FACT]);
    expect(cover.lines[1]).toContain(A_FACT.text);
    expect(cover.lines[1]).toContain(B_FACT.text);
    const onlyB = insertCover(ORIGINAL, [B_FACT]).lines; // oracle
    const out = planRemoveFact(cover.lines, loc(cover, "f-a"));
    expect(out.changed).toBe(true);
    expect(out.lines[1]).not.toContain(A_FACT.text);
    expect(out.lines[1]).toContain(B_FACT.text);
    expect(out.lines, "removing A did not equal inserting only B").toEqual(onlyB);
    expect(readabilityViolations(out.lines[1])).toEqual([]);
  });

  it("removing fact B leaves fact A intact and readable", () => {
    const cover = insertCover(ORIGINAL, [A_FACT, B_FACT]);
    const onlyA = insertCover(ORIGINAL, [A_FACT]).lines;
    const out = planRemoveFact(cover.lines, loc(cover, "f-b"));
    expect(out.changed).toBe(true);
    expect(out.lines[1]).not.toContain(B_FACT.text);
    expect(out.lines[1]).toContain(A_FACT.text);
    expect(out.lines).toEqual(onlyA);
  });
});

// ---------------------------------------------------------------------------
// F2: located removal disambiguates duplicates and overlaps that a global text
// search gets wrong. Both shapes were executed by the fresh verifier.
// ---------------------------------------------------------------------------
describe("F2(a): a fact whose text also appears in ANOTHER paragraph", () => {
  const DUP_PHRASE = "Acme opened a Dublin lab.";
  const LINES = Object.freeze([
    "Dear Hiring Manager,",
    `I lead a platform team, and it is true that ${DUP_PHRASE}`, // the SAME phrase, as ordinary prose, BEFORE the insert line
    "In my current role I focus on telemetry systems and reliability.",
    "Sincerely,",
  ]);
  it("removal excises the INSERTED occurrence, not the earlier prose one", () => {
    const cover = insertCover(LINES, [{ id: "f-dup", text: DUP_PHRASE, placement: "current" }]);
    const rec = loc(cover, "f-dup");
    expect(rec.lineIndex, "the fact should have landed on the current-role line, not the prose line").toBe(2);
    // both the prose (line 1) and the insert (line 2) now carry the phrase.
    expect(cover.lines[1]).toContain(DUP_PHRASE);
    expect(cover.lines[2]).toContain(DUP_PHRASE);
    const out = planRemoveFact(cover.lines, rec);
    expect(out.changed).toBe(true);
    // the earlier prose occurrence is UNTOUCHED; the inserted one is gone.
    expect(out.lines[1], "removal corrupted the earlier prose paragraph -- it keyed on text, not location").toBe(LINES[1]);
    expect(out.lines[2]).not.toContain(DUP_PHRASE);
    expect(out.lines[2]).toBe(LINES[2]);
  });
});

describe("F2(b): a fact that is a SUBSTRING of another accepted fact on the same line", () => {
  const LINES = Object.freeze([
    "Dear Hiring Manager,",
    "I am applying for the role. I care about reliability.",
    "Sincerely,",
  ]);
  // SHORT must sit in the MIDDLE of LONG (content on BOTH sides), so removing the
  // WRONG (inside-LONG) copy leaves a detectably broken LONG -- otherwise LONG =
  // "prefix" + SHORT and removing either copy coincidentally reconstructs it, and
  // the test has no teeth.
  const LONG = { id: "f-long", text: "Acme opened a Dublin lab and hired locally.", placement: "intro" };
  const SHORT = { id: "f-short", text: "a Dublin lab", placement: "intro" }; // substring in the MIDDLE of LONG
  it("removing the SHORT fact leaves the LONG fact intact (not corrupted from the inside)", () => {
    // Arrival order [LONG, SHORT] puts LONG first, so a text search for SHORT
    // finds it INSIDE long before the standalone one -- the trap.
    const cover = insertCover(LINES, [LONG, SHORT]);
    expect(cover.lines[1]).toContain(LONG.text);
    expect(occurrences(cover.lines[1], SHORT.text), "the substring should occur twice pre-removal").toBe(2);
    const out = planRemoveFact(cover.lines, loc(cover, "f-short"));
    expect(out.changed).toBe(true);
    // LONG survives whole (a text-keyed removal would have gutted it to "Acme opened and hired locally.")
    expect(out.lines[1], "removal corrupted the overlapping longer fact").toContain(LONG.text);
    // exactly the standalone occurrence went: 2 -> 1 (the one still inside LONG).
    expect(occurrences(out.lines[1], SHORT.text)).toBe(1);
    expect(readabilityViolations(out.lines[1])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M3: coalescing must key on the RESOLVED LINE INDEX, not the placement id.
// Latent today (every card uses the default placement); this fixture mixes two
// DISTINCT placements that both fall back to the intro line, so an id-keyed
// coalescer reintroduces the original N56 same-line collision.
// ---------------------------------------------------------------------------
describe("M3: two distinct placements that resolve to the same line coalesce into ONE edit", () => {
  const LINES = Object.freeze([
    "Dear Hiring Manager,",
    "I am excited to apply for this role. I bring years of platform experience.",
    "Sincerely,",
  ]);
  it("current + teaching, with neither anchor present, both land on the intro line as one coalesced edit", () => {
    // Neither /in my current role/ nor /adjunct professor|i also teach/ is in
    // LINES, so both placements fall back to introIndex (line 1).
    const cover = insertCover(LINES, [
      { id: "m-cur", text: "Acme is investing in platform reliability.", placement: "current" },
      { id: "m-teach", text: "Acme runs an engineering apprenticeship.", placement: "teaching" },
    ]);
    expect(cover.edits.length, "two placements on one line must coalesce into ONE edit (id-keyed coalescing splits them)").toBe(1);
    expect(cover.edits[0].lineIndex).toBe(1);
    expect(cover.lines[1]).toContain("Acme is investing in platform reliability.");
    expect(cover.lines[1]).toContain("Acme runs an engineering apprenticeship.");
    // and each is still independently removable at its own recorded location.
    const afterRemoveCur = planRemoveFact(cover.lines, loc(cover, "m-cur"));
    expect(afterRemoveCur.lines[1]).not.toContain("Acme is investing in platform reliability.");
    expect(afterRemoveCur.lines[1]).toContain("Acme runs an engineering apprenticeship.");
  });
});

describe("planRemoveFact -- idempotence / stale locator", () => {
  it("removing at a location that no longer holds the text is a no-op (same array reference)", () => {
    const cover = insertCover(ORIGINAL, [END_FACT]);
    const once = planRemoveFact(cover.lines, loc(cover, "f-end"));
    const twice = planRemoveFact(once.lines, loc(cover, "f-end"));
    expect(twice.changed).toBe(false);
    expect(twice.lines).toBe(once.lines);
  });
});

describe("planRemoveFact -- the reverse edit is consumable by the REAL docx splicer (AC-N61.16/.19 join)", () => {
  let ENGINE_B64 = "";
  let ENGINE_LINES = [];
  const FACT = "Acme just opened a Dublin telemetry lab.";

  beforeAll(async () => {
    const cl = await embeddedEngine.tailorCoverLetter({
      jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
      jobTitle: "Staff Engineer",
      companyName: "Acme",
    });
    ENGINE_B64 = cl.docxB64;
    ENGINE_LINES = cl.resultLines;
  });

  it("the fixture is a real engine cover letter", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_B64.length).toBeGreaterThan(100000);
  });

  it("insert then reverse-splice removes the fact from the engine's OWN bytes", async () => {
    const cover = insertCover(ENGINE_LINES, [{ id: "f1", text: FACT, placement: "intro" }]);
    expect(cover.edits.length).toBe(1);
    const spliced = await applyCoverDocxEdits(ENGINE_B64, ENGINE_LINES, cover.edits);
    expect(spliced.applied, `forward splice failed: ${spliced.reason}`).toBe(true);
    const removal = planRemoveFact(cover.lines, loc(cover, "f1"));
    expect(removal.changed).toBe(true);
    expect(removal.edit.before, "edit.before must be the current post-insert line").toBe(cover.lines[removal.edit.lineIndex]);
    const reversed = await applyCoverDocxEdits(spliced.docxB64, cover.lines, [removal.edit]);
    expect(reversed.applied, `reverse splice refused: ${reversed.reason}`).toBe(true);
    const reversedLines = modelToLines(await parseDocxToModel(Buffer.from(reversed.docxB64, "base64")));
    expect(reversedLines.some((l) => l.includes(FACT)), "the removed fact is STILL in the downloaded bytes").toBe(false);
  });
});
