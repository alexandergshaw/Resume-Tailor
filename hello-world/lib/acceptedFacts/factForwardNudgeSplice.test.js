// N92 Wave 2 (Control C) -- FIX-FORWARD after the fresh verifier's Sev-1
// NOT-SHIP on commit 5fa8392 (docs/loop/N92.verify.w2.r1.md, Bug 1): the
// forward nudge reaches `cover.lines`/`cover.record` but NEVER `cover.edits`,
// so on the byte-splice path (any letter with real cover docx bytes -- the
// realistic majority case) the spliced/stored/served bytes show the fact at
// its UN-nudged position while the visible lines show it nudged. AC-C4 ("at
// that position in the download") makes NO carve-out for the byte-backed case;
// the shipped autoInsertForwardNudge.rc.test.js only exercised Shape B (no
// bytes), the exact carve-out that hid this.
//
// THIS FILE is the PURE-PLANNER half: it pins the consistency invariant at the
// defect's own location -- `planAcceptForEntry(..., { forwardNudge:true })`.
// `cover.edits` is the EXACT input the splice feeds to
// lib/acceptedFacts/factDocx.js#applyCoverDocxEdits (useCompanyResearch.js:857),
// which applies each edit as a whole-paragraph before->after rewrite against
// `entry.coverLetterResultLines`. So "apply the returned edits to the entry's
// original lines and you get back cover.lines" IS the assertion that the
// stored/served bytes will match the visible letter -- asserted on the data
// that actually becomes the bytes, not on cover.lines alone (which is already
// nudged on HEAD and hides the bug).
//
// The companion app/hooks/autoInsertForwardNudgeSplice.rc.test.js drives the
// REAL autoInsertFactsForJob against REAL docx bytes and reads the ACTUAL
// stored coverLetterDocxB64 back out -- the end-to-end last hop. This file is
// the fast, deterministic invariant that localises the same defect.
//
// RED ON HEAD (5fa8392): applyForwardNudge (factInsertion.js:414-435) returns
// `{ ...cover, lines, record: records, nudgedCount }` -- `cover.edits` is left
// exactly as planCoverFacts produced it (the plain, un-nudged insert), so on
// HEAD the ON edits equal the OFF edits and reconstructing from them yields the
// UN-nudged letter, which disagrees with the nudged cover.lines. Every
// "reconstruct == cover.lines" and "edits ON != edits OFF" assertion below
// fails on HEAD for that reason.
//
// SATISFIABILITY / FIX DIRECTION: the assertions pin the INVARIANT (lines,
// record, and the edits-reconstruction all describe the SAME position) and
// nothing about HOW. A "nudge-before-plan" fix (place directly at the nudged
// slot so edits reflect it) OR a "nudge-edits-too" fix (recompute edits from
// the original lines against the final nudged lines) both satisfy it; only a
// lines-only nudge (HEAD) fails. Proven satisfiable by a reference fix in an
// isolated scratchpad tree (see tests.r1.md).

import { describe, it, expect } from "vitest";
import { planAcceptForEntry } from "./factInsertion.js";
import { planMoveFact } from "./factMove.js";

const GREETING = "Dear Hiring Manager,";
const INTRO =
  "I am excited to apply for this role. I bring years of relevant experience. I would love to contribute to your mission.";
const CURRENT = "In my current role I lead a platform team. I ship features weekly every sprint.";
const TEACHING = "As an adjunct professor I teach data science. I mentor students often at night.";
const WHY = "What draws me to your company is the bold mission. I admire your product deeply too.";
const CLOSING = "Sincerely,";
const SIGNATURE = "Jane Doe";

function letter() {
  return [GREETING, INTRO, CURRENT, TEACHING, WHY, CLOSING, SIGNATURE];
}
function entryWith(lines) {
  return { coverLetterResultLines: lines };
}
const FACT_TEXT = "Acme opened a Dublin lab.";
function factAt(placement) {
  return { id: "f1", text: FACT_TEXT, placement };
}
function planNudged(lines, facts) {
  return planAcceptForEntry(entryWith(lines), { facts, forwardNudge: true });
}
function planPlaced(lines, facts) {
  return planAcceptForEntry(entryWith(lines), { facts });
}

// FAITHFUL model of what the byte-splice actually does with `cover.edits`
// (lib/acceptedFacts/factDocx.js#applyCoverDocxEdits + docxModel#applyTextEdits):
// each edit is a whole-paragraph { before, after } rewrite, and the splice is
// REFUSED unless `originalLines[edit.lineIndex] === edit.before` (the staleness
// guard, factDocx.js:33-34). This helper HARD-THROWS on that same mismatch, so
// the reconstruction can never be a vacuous pass: an edit set that does not
// target the entry's own original paragraphs would make the real splice refuse
// (`reason:"stale-plan"`), and it makes this helper throw rather than silently
// agree. The returned array is exactly the text the stored/served docx carries.
function reconstructFromEdits(originalLines, edits) {
  const out = [...originalLines];
  for (const e of edits) {
    if (out[e.lineIndex] !== e.before) {
      throw new Error(
        `edit for line ${e.lineIndex} does not target the entry's original paragraph (real splice would refuse as stale-plan)`,
      );
    }
    out[e.lineIndex] = e.after;
  }
  return out;
}

function occurrences(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}
function eachRecordLocatesOwnText(lines, records) {
  for (const r of records) {
    const span = String(lines[r.lineIndex] ?? "").slice(r.offset, r.offset + String(r.text).length);
    expect(span, `record ${JSON.stringify(r.text)} does not locate its own text at its recorded offset`).toBe(r.text);
  }
}

// ---------------------------------------------------------------------------
// Fixture precondition (wrong-reason trap): confirm this really is the SPLICE
// scenario -- a single same-paragraph edit whose `before` is the entry's own
// original intro paragraph, so the reconstruction below is a real stand-in for
// the byte-splice and not a degenerate no-edit case.
// ---------------------------------------------------------------------------
describe("N92-C splice-path fixture precondition", () => {
  it("the un-nudged insert produces exactly one whole-paragraph edit targeting the original intro line", () => {
    const lines = letter();
    const placed = planPlaced(lines, [factAt("intro")]);
    expect(placed.cover.edits.length, "expected a single splice edit for the intro insert").toBe(1);
    expect(placed.cover.edits[0].lineIndex).toBe(1);
    expect(placed.cover.edits[0].before, "the edit must target the entry's ORIGINAL intro paragraph").toBe(INTRO);
    // And reconstructing from the OFF edits reproduces the placed letter -- the
    // helper faithfully models the splice on the case where nothing moved.
    expect(reconstructFromEdits(lines, placed.cover.edits)).toEqual(placed.cover.lines);
  });
});

// ---------------------------------------------------------------------------
// THE DEFECT (RED on HEAD): the nudge must reach `cover.edits` -- the splice
// input -- not only `cover.lines`.
// ---------------------------------------------------------------------------
describe("AC-C4 splice path: the forward nudge reaches cover.edits so the stored/served bytes match the visible letter (RED on HEAD)", () => {
  it("reconstructing the letter from the stored edits equals the nudged cover.lines (the download would show the NUDGED position)", () => {
    const lines = letter();
    const nudged = planNudged(lines, [factAt("intro")]);

    // The nudge fired on the visible lines (this half is green on HEAD): the
    // fact sits one slot later than placement.
    const placed = planPlaced(lines, [factAt("intro")]);
    expect(nudged.cover.lines, "precondition: the nudge did not move the visible fact").not.toEqual(placed.cover.lines);

    // THE LAST HOP, at the splice input: applying the edits the splice will
    // actually apply must yield the SAME letter the user sees. On HEAD the
    // edits are the un-nudged insert, so this reconstruction places the fact
    // one slot EARLIER than cover.lines -- exactly the served-bytes-vs-visible
    // divergence the verifier proved.
    const rebuilt = reconstructFromEdits(lines, nudged.cover.edits);
    expect(
      rebuilt,
      "the bytes the splice would store (reconstructed from cover.edits) do NOT match the nudged, visible cover.lines -- the download/preview would show the un-nudged position",
    ).toEqual(nudged.cover.lines);
  });

  it("forward ON produces DIFFERENT edits than forward OFF (the nudge reaches the splice input, not just the lines)", () => {
    const lines = letter();
    const on = planNudged(lines, [factAt("intro")]);
    const off = planPlaced(lines, [factAt("intro")]);
    // cover.lines already differ on HEAD (the nudge touches lines); the edits
    // must differ TOO, or the splice is blind to the nudge. On HEAD they are
    // byte-identical -- the core defect.
    expect(
      on.cover.edits,
      "forward ON and forward OFF produced identical cover.edits -- the byte-splice input never sees the nudge (Bug 1)",
    ).not.toEqual(off.cover.edits);
  });

  it("three-way consistency: lines, records, and the edits-reconstruction all place the fact at the same position, and the nudge fired", () => {
    const lines = letter();
    const on = planNudged(lines, [factAt("intro")]);
    const off = planPlaced(lines, [factAt("intro")]);

    // (1) The nudge actually happened -- this test cannot be satisfied by a
    // build that simply never nudges (which would trivially make edits agree
    // with lines). RED-able direction: a no-nudge build fails here.
    expect(on.cover.lines, "the forward nudge did not fire on the lines").not.toEqual(off.cover.lines);

    // (2) The edits-reconstruction (the served/stored bytes) equals the visible
    // lines. RED on HEAD: lines-only nudge leaves edits un-nudged.
    const rebuilt = reconstructFromEdits(lines, on.cover.edits);
    expect(rebuilt, "the reconstructed splice bytes disagree with the visible lines after the nudge").toEqual(on.cover.lines);

    // (3) Every record locates its own text in the visible lines AND in the
    // reconstructed bytes -- so preview highlight, download, and record all
    // agree. On HEAD the records point at the nudged offsets, which do not
    // exist in the un-nudged reconstruction, so this reds via (2)'s failure.
    expect(occurrences(on.cover.lines.join("\n"), FACT_TEXT), "the fact must appear exactly once").toBe(1);
    eachRecordLocatesOwnText(on.cover.lines, on.cover.record);
    eachRecordLocatesOwnText(rebuilt, on.cover.record);
  });

  it("EXACT ORACLE: the reconstructed splice bytes carry the fact AFTER sentence two (the nudged slot), not after sentence one", () => {
    const lines = letter();
    const on = planNudged(lines, [factAt("intro")]);
    const rebuilt = reconstructFromEdits(lines, on.cover.edits);
    // Independent literal oracle (not derived from the planner): fact after S2.
    expect(rebuilt[1]).toBe(
      "I am excited to apply for this role. I bring years of relevant experience. Acme opened a Dublin lab. I would love to contribute to your mission.",
    );
  });
});

// ---------------------------------------------------------------------------
// Controls: prove the invariant is SATISFIABLE and the instrument DISCRIMINATES
// (the OFF path already satisfies it; a build that over-fires the nudge without
// fixing edits is caught by the RED tests above).
// ---------------------------------------------------------------------------
describe("AC-C4 splice path CONTROLS", () => {
  it("CONTROL (satisfiable): with forward OFF the edits already reconstruct the placed lines", () => {
    // Green on HEAD and in the reference: the OFF path has no nudge, so its
    // edits and lines describe the same position. This proves the invariant is
    // not impossible -- a correct ON build must reach the same agreement.
    const lines = letter();
    const off = planPlaced(lines, [factAt("intro")]);
    expect(reconstructFromEdits(lines, off.cover.edits)).toEqual(off.cover.lines);
  });

  it("CONTROL (over-fire): forwardNudge:false must equal the un-nudged placement in BOTH lines and edits", () => {
    // Guards against a build that always nudges (which would red this) -- the
    // false path must be byte-identical to the omitted path, edits included.
    const lines = letter();
    const omitted = planAcceptForEntry(entryWith(lines), { facts: [factAt("intro")] });
    const explicitFalse = planAcceptForEntry(entryWith(lines), { facts: [factAt("intro")], forwardNudge: false });
    expect(explicitFalse.cover.lines).toEqual(omitted.cover.lines);
    expect(explicitFalse.cover.edits).toEqual(omitted.cover.edits);
    // Absolute over-fire guard: the OFF path leaves the fact at its PLACED slot
    // (right after sentence one), not nudged. An always-nudge build reds here.
    expect(explicitFalse.cover.lines[1]).toBe(
      "I am excited to apply for this role. Acme opened a Dublin lab. I bring years of relevant experience. I would love to contribute to your mission.",
    );
    // And the edits the splice would apply carry that same un-nudged position.
    expect(reconstructFromEdits(lines, explicitFalse.cover.edits)[1]).toBe(
      "I am excited to apply for this role. Acme opened a Dublin lab. I bring years of relevant experience. I would love to contribute to your mission.",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-C9 interaction: two coalesced facts in one paragraph. The nudge is
// per-fact and the splice input must carry BOTH facts at their nudged
// positions, once each, in order.
// ---------------------------------------------------------------------------
describe("AC-C9 + splice: two coalesced facts -- the edits reconstruct the nudged lines, order preserved (RED on HEAD)", () => {
  const F1 = { id: "f1", text: "Acme opened a Dublin lab.", placement: "intro" };
  const F2 = { id: "f2", text: "Acme raised fifty million dollars.", placement: "intro" };

  it("the stored edits reconstruct the nudged, ordered, once-each letter", () => {
    const lines = letter();
    const on = planAcceptForEntry(entryWith(lines), { facts: [F1, F2], forwardNudge: true });
    const off = planAcceptForEntry(entryWith(lines), { facts: [F1, F2] });

    // The nudge fired (green on HEAD half).
    expect(on.cover.lines, "the coalesced nudge did not move the facts").not.toEqual(off.cover.lines);

    // The splice input reconstructs to the visible nudged letter (RED on HEAD).
    const rebuilt = reconstructFromEdits(lines, on.cover.edits);
    expect(
      rebuilt,
      "the reconstructed splice bytes disagree with the visible nudged lines for the coalesced pair",
    ).toEqual(on.cover.lines);

    // Safety invariants carried onto the reconstructed (served) letter.
    const joined = rebuilt.join("\n");
    expect(occurrences(joined, F1.text), "F1 merged/duplicated/dropped in the served bytes").toBe(1);
    expect(occurrences(joined, F2.text), "F2 merged/duplicated/dropped in the served bytes").toBe(1);
    expect(joined.indexOf(F1.text), "the served bytes reordered the coalesced facts").toBeLessThan(joined.indexOf(F2.text));
    eachRecordLocatesOwnText(rebuilt, on.cover.record);
  });
});
