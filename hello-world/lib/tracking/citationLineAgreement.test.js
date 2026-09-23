// ---------------------------------------------------------------------------
// N49 TDD hand-off -- THE THREE-CONVENTION LINE ATTACHMENT RULE (plan.r2.md
// section 2.7's V3 rule, steps 1-8, and its section 4.3 contract; carried
// unchanged by plan.r4.md section 9).
//
// WHAT THIS DECIDES, IN THE PRODUCT. A grounded model reply comes back with
// citations carrying BYTE OFFSETS, and the vendor does not document which
// string those offsets index: the block the annotation sits on, the whole
// `output_text`, or the concatenation of every block. Get it wrong by one
// convention and a citation lands on the WRONG LINE -- which is how a prep
// pack ends up telling a candidate that a real publisher reported an
// interview stage the model invented. That is the exact defect in the
// owner's own pack, and it is worse than no citation at all, because a wrong
// attribution is indistinguishable from a right one on screen.
//
// THE RULE, AND WHY "CONSISTENT" MEANS WHAT IT MEANS. The owner's ruling is
// "attach only when all three conventions agree". The dangerous reading --
// the one round 1 took -- discards any convention that produces a
// line-CROSSING reading before the vote. That throws away the TRUE
// convention whenever the vendor legitimately sends a crossing span, and
// once one is discarded a wrong convention can win alone: the plan measured
// 229 misattributions in 4000 runs. V3 keeps the ruling's words and makes
// them safe: a convention abstains ONLY for a structurally impossible
// reading (a non-integer, a negative, an inverted pair, an offset that is
// not a character boundary). A reading that LANDS but crosses a line or
// falls outside `output_text` is a placement, and it votes.
//
// THE PROPERTY IS THE POINT, AND IT IS MANDATORY. The fixed rows below pin
// the shapes a human can reason about; they cannot establish the thing that
// matters, which is that NO modelled vendor convention can ever be
// misattributed. That is P1: 4000 generated responses at each of two seeds,
// each with a known truth, requiring ZERO wrong attachments -- and a
// non-zero number of CORRECT ones, because "never attach anything" has zero
// wrong attachments too and is worthless.
//
// THE COST IS DISCLOSED, NOT HIDDEN. V3 refuses to attach in most real
// shapes (the plan measured 22% attachment overall, 13% in the likely-real
// flow). Those rows read "Possible" in the panel, which is honest. Several
// fixed rows below are titled "[cost]" for exactly that reason: they assert
// a REFUSAL that a more eager rule would turn into an attachment, and they
// are not defects.
//
// ONE ROW IS AN ACCEPTED WRONG ANSWER, and it is titled as one. A single
// block whose every offset is forged one line down is undetectable by this
// rule: all three conventions coincide on one block, so they agree, and they
// agree on the forged line. Detecting it needs the segment TEXT, which the
// vendor does not send. It is written down here rather than left to be
// rediscovered as a bug.
//
// RED ON HEAD: `lib/tracking/citationLineAgreement.js` does not exist. The
// dynamic import is deliberate -- a static one fails the file at collection
// and reports no `Tests` line, and a run with no test count is inconclusive,
// not red.
//
// WHAT THIS FILE CANNOT ASSERT:
//   * That the offsets a REAL Gemini response carries follow any of the
//     three conventions. There is no API key here; the plan's own D-P4 says
//     the only route to a high attachment rate is a wire capture. Every
//     truth below is synthetic, and the property's value is that it covers
//     all three modelled conventions plus one deliberately unmodelled one.
//   * What `buildCitedDigest` stores. `lineAttach`'s two extra fail-closed
//     bases ("walk-mismatch", "lines-moved") are computed there, and T4 owns
//     them.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { extractCitationSourcesByBlock } from "@/lib/copilot/glossaryCitations";

let LA = null;
let LA_ERROR = null;
try {
  LA = await import("./citationLineAgreement.js");
} catch (err) {
  LA_ERROR = err;
}
let IB = null;
try {
  IB = await import("@/lib/llm/interactionBlocks.js");
} catch {
  IB = null;
}

function la() {
  if (!LA) throw new Error(`lib/tracking/citationLineAgreement.js is not written yet: ${LA_ERROR?.message}`);
  return LA;
}

const ENCODER = new TextEncoder();
const bytes = (s) => ENCODER.encode(s).length;

// ---------------------------------------------------------------------------
// The scenario builder. It converts a target span in `raw` into the byte
// offsets a vendor would emit under one named convention, so every fixed row
// below says WHICH convention it is modelling instead of carrying magic
// numbers. `allBlocksNL` is deliberately UNMODELLED by the rule: it exists to
// prove the rule refuses a convention it does not know rather than guessing.
// ---------------------------------------------------------------------------

function buildScenario({ texts, tailStart, targets, convention, shiftBytes = 0 }) {
  const raw = texts.slice(tailStart).join("");
  const blockStartInRaw = (b) => texts.slice(tailStart, b).join("").length;
  const citationsByBlock = texts.map(() => []);
  // Truth is banked PER BLOCK and flattened in block order at the end,
  // because that is the order the walker emits citations in. Recording it in
  // target order instead makes `truth` and `lines` disagree by permutation
  // whenever two targets sit on different blocks out of order -- which reads
  // as 148 misattributions in the property and is entirely the generator's
  // fault. Measured, and fixed here rather than by loosening the property.
  const truthByBlock = texts.map(() => []);
  for (const target of targets) {
    const { block, innerStart, innerEnd } = target;
    const text = texts[block];
    let s;
    let e;
    if (convention === "block") {
      s = bytes(text.slice(0, innerStart));
      e = bytes(text.slice(0, innerEnd));
    } else if (convention === "outputText") {
      const us = blockStartInRaw(block) + innerStart;
      const ue = blockStartInRaw(block) + innerEnd;
      s = bytes(raw.slice(0, us));
      e = bytes(raw.slice(0, ue));
    } else if (convention === "allBlocks") {
      const prefix = texts.slice(0, block).join("");
      s = bytes(prefix + text.slice(0, innerStart));
      e = bytes(prefix + text.slice(0, innerEnd));
    } else if (convention === "allBlocksNL") {
      const prefix = texts.slice(0, block).join("\n") + (block > 0 ? "\n" : "");
      s = bytes(prefix + text.slice(0, innerStart));
      e = bytes(prefix + text.slice(0, innerEnd));
    } else {
      throw new Error(`unknown convention ${convention}`);
    }
    citationsByBlock[block].push({
      uri: `https://pub${block}-${citationsByBlock[block].length}.example.com/a`,
      title: "t",
      startByte: s + shiftBytes,
      endByte: e + shiftBytes,
    });
    // The TRUTH, computed independently of the module under test: where the
    // targeted characters actually sit in `raw`. A target in a block BEFORE
    // the tail is not in `raw` at all, so no attachment can be right.
    if (block < tailStart) {
      truthByBlock[block].push(null);
    } else {
      const us = blockStartInRaw(block) + innerStart;
      const ue = blockStartInRaw(block) + innerEnd;
      truthByBlock[block].push(truthLineOf(raw, us, ue));
    }
  }
  const blocks = texts.map((text, i) => ({ text, stepIndex: 0, citations: citationsByBlock[i] }));
  return { raw, blocks, truth: truthByBlock.flat() };
}

/** The "inside one line" definition of plan.r2.md section 2.7 step 4, written
 *  out a second time HERE so the fixed rows have an oracle independent of the
 *  module. Only the span's LAST covered unit may be the newline. Returns the
 *  raw line index, or null when the span crosses. */
function truthLineOf(raw, us, ue) {
  if (raw.slice(us, Math.max(us, ue - 1)).includes("\n")) return null;
  let line = 0;
  for (let i = 0; i < us; i += 1) if (raw[i] === "\n") line += 1;
  return line;
}

const PREAMBLE = "Here is what I found about the company.\n";
const BODY = [
  "Northwind runs a recruiter screen first.\n",
  "The hiring manager round follows within a week.\n",
  "A technical deep dive closes the loop.\n",
].join("");
// Line starts inside BODY, by eye and by construction, so a row can name the
// line it means rather than a character index.
const BODY_LINES = BODY.split("\n");
const lineStart = (i) => BODY_LINES.slice(0, i).reduce((n, l) => n + l.length + 1, 0);

describe("the shapes a human can reason about", () => {
  it("no citations at all is its own basis, and attaches nothing", () => {
    const r = la().citationLineAgreement({ outputText: BODY, blocks: [{ text: BODY, citations: [] }] });
    expect(r.basis).toBe("no-citations");
    expect(r.lines).toEqual([]);
    expect(r.citations).toBe(0);
  });

  it("[positive control] a single-block response with block-relative offsets ATTACHES to the right line", () => {
    // THE control for this whole file. Every other fixed row asserts a
    // refusal, and a rule that returns "unplaceable" unconditionally passes
    // all of them. Here all three conventions coincide (one block, raw is
    // that block, so base and offset are both zero) and the rule must commit.
    const s = buildScenario({
      texts: [BODY],
      tailStart: 0,
      targets: [{ block: 0, innerStart: lineStart(1) + 4, innerEnd: lineStart(1) + 17 }],
      convention: "block",
    });
    expect(s.truth).toEqual([1]);
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    expect(r.basis).toBe("agree");
    expect(r.lines).toEqual([1]);
    expect(r.voting).toEqual(["block", "outputText", "allBlocks"]);
  });

  it("[positive control] a MULTI-block response still attaches when every convention reads the same line", () => {
    // raw is the join of ALL blocks, and the citation sits in the first one,
    // so the block base and the all-blocks offset are both zero. A rule that
    // only ever attaches on a single block would fail here.
    const a = "Recruiter screen first.\nThen the manager.\n";
    const b = "A deep dive closes it.\n";
    const s = buildScenario({
      texts: [a, b],
      tailStart: 0,
      targets: [{ block: 0, innerStart: 24, innerEnd: 33 }],
      convention: "block",
    });
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    expect(r.basis).toBe("agree");
    expect(r.lines).toEqual(s.truth);
    expect(s.truth[0]).not.toBeNull();
  });

  it("[cost] the canonical flow -- a preamble block, offsets relative to the body -- REFUSES", () => {
    // This is the likely-real shape and the rule declines it. The body's own
    // offsets read identically under `block` and `outputText`, but
    // `allBlocks` reads them shifted by the preamble's length and lands
    // somewhere else, so the three do not agree. The honest outcome is
    // "Possible", not a coin flip between two readings.
    const s = buildScenario({
      texts: [PREAMBLE, BODY],
      tailStart: 1,
      targets: [{ block: 1, innerStart: lineStart(2) + 2, innerEnd: lineStart(2) + 11 }],
      convention: "block",
    });
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    expect(r.basis).not.toBe("agree");
    expect(r.lines).toEqual([]);
  });

  it("[cost, and the MV-3/MV-4 row] the same flow with ALL-BLOCKS offsets refuses rather than taking the majority", () => {
    // Two conventions (`block` and `outputText`) read the vendor's shifted
    // offsets as a plausible line in the body and agree with EACH OTHER; the
    // one convention that is right disagrees with both. A two-of-three
    // majority rule -- mutant MV-4 -- attaches the wrong line here, and
    // dropping the all-blocks convention -- mutant MV-3 -- attaches it too.
    const s = buildScenario({
      texts: [PREAMBLE, BODY],
      tailStart: 1,
      targets: [{ block: 1, innerStart: lineStart(1) + 4, innerEnd: lineStart(1) + 17 }],
      convention: "allBlocks",
    });
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    expect(r.basis).toBe("ambiguous");
    expect(r.lines).toEqual([]);
  });

  it("[cost, and the MV-1 row] a citation on a LATER block with block-relative offsets refuses", () => {
    // `block` reads the right line; `outputText` and `allBlocks` read the
    // same small numbers as an offset into the first block and land
    // elsewhere. Dropping the block convention (MV-1) leaves two wrong
    // readings agreeing with each other, which is an attachment to the wrong
    // line.
    const a = "Recruiter screen first.\nThen the hiring manager round.\n";
    const b = "A technical deep dive closes the loop.\nThe panel is last.\n";
    const s = buildScenario({
      texts: [a, b],
      tailStart: 0,
      targets: [{ block: 1, innerStart: 39, innerEnd: 49 }],
      convention: "block",
    });
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    expect(r.basis).not.toBe("agree");
    expect(r.lines).toEqual([]);
  });

  it("a convention the rule does not model cannot win alone", () => {
    // `allBlocksNL` -- blocks joined with a newline -- is a shape no
    // convention here implements. The rule must refuse rather than pick
    // whichever modelled reading happens to land.
    const a = "Recruiter screen first.\nThen the manager round.\n";
    const b = "A deep dive closes the loop.\n";
    const s = buildScenario({
      texts: [a, b],
      tailStart: 0,
      targets: [{ block: 1, innerStart: 2, innerEnd: 11 }],
      convention: "allBlocksNL",
    });
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    if (r.basis === "agree") expect(r.lines).toEqual(s.truth);
  });
});

describe("forged offsets", () => {
  it("a shift into the middle of a multi-byte character is structurally impossible for every convention", () => {
    // "Nestle" with an acute accent is two bytes; a +1 shift from an offset
    // that starts ON it lands INSIDE it, which is not a character boundary,
    // so every convention abstains and the whole response is inconsistent.
    // Measured the hard way: shifting a span that starts at 0 by one byte
    // lands on the boundary after "N" and attaches happily, so the target
    // has to begin at the multi-byte character itself for this row to mean
    // anything. Asserted below rather than assumed.
    const text = "Nestlé reported the loop.\nThe manager round follows.\n";
    expect(bytes(text.slice(0, 5))).toBe(5);
    expect(bytes(text.slice(0, 6))).toBe(7);
    const s = buildScenario({
      texts: [text],
      tailStart: 0,
      targets: [{ block: 0, innerStart: 5, innerEnd: 12 }],
      convention: "block",
      shiftBytes: 1,
    });
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    expect(r.basis).toBe("inconsistent");
    expect(r.voting).toEqual([]);
    expect(r.lines).toEqual([]);
  });

  it("a multi-block response whose offsets are forged one line down REFUSES", () => {
    const a = "Recruiter screen first.\nThen the hiring manager round.\n";
    const b = "A technical deep dive closes the loop.\nThe panel is last.\n";
    const s = buildScenario({
      texts: [a, b],
      tailStart: 0,
      targets: [{ block: 1, innerStart: 2, innerEnd: 11 }],
      convention: "block",
      shiftBytes: bytes("A technical deep dive closes the loop.\n"),
    });
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    expect(r.basis).not.toBe("agree");
    expect(r.lines).toEqual([]);
  });

  it("[ACCEPTED RESIDUAL: undetectable without the segment text] a SINGLE-block forge one line down ATTACHES the wrong line", () => {
    // Written down rather than left to be found. On one block every
    // convention reads the same numbers, so they agree -- and they agree on
    // the forged line. Nothing in the offsets themselves can distinguish a
    // shifted citation from an honest one; only the segment TEXT could, and
    // the vendor does not send it. This is a REAL limit of the mechanism and
    // the reason the panel's label says "reported by", never "verified".
    const s = buildScenario({
      texts: [BODY],
      tailStart: 0,
      targets: [{ block: 0, innerStart: 4, innerEnd: 13 }],
      convention: "block",
      shiftBytes: bytes(BODY_LINES[0] + "\n"),
    });
    const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
    expect(r.basis).toBe("agree");
    expect(r.lines).toEqual([1]);
    expect(s.truth).toEqual([0]);
  });
});

describe("the definition of 'inside one line', which one character decides", () => {
  const raw = "abc\ndef\nghi";
  const withSpan = (startByte, endByte) => ({
    outputText: raw,
    blocks: [{ text: raw, citations: [{ uri: "https://p.example.com/a", startByte, endByte }] }],
  });

  it("a span ending ON the newline belongs to the line that newline ends", () => {
    // MV-5, newline-strict, calls this a crossing and refuses. A vendor that
    // includes the terminator is the common case, so a strict reading throws
    // away most honest citations.
    const r = la().citationLineAgreement(withSpan(0, 4));
    expect(r.basis).toBe("agree");
    expect(r.lines).toEqual([0]);
  });

  it("a span covering a newline BEFORE its last unit crosses, and the whole response is unplaceable", () => {
    // MV-6, newline-lax, takes the line of the START and attaches. That is
    // the misattribution this definition exists to prevent: the span covers
    // two lines and belongs to neither.
    const r = la().citationLineAgreement(withSpan(0, 5));
    expect(r.basis).toBe("unplaceable");
    expect(r.lines).toEqual([]);
    expect(r.voting.length).toBeGreaterThan(0);
  });

  it("a one-unit span that is exactly the newline belongs to the line it terminates", () => {
    const r = la().citationLineAgreement(withSpan(3, 4));
    expect(r.basis).toBe("agree");
    expect(r.lines).toEqual([0]);
  });

  it("a whole-document span VOTES as a crossing rather than abstaining", () => {
    // Step 4's whole-document clause. If it abstained instead, a real
    // whole-output citation would silently remove one convention from the
    // vote and let a wrong one win alone -- which is the exact mechanism that
    // produced 229 misattributions in the checker's form.
    const r = la().citationLineAgreement(withSpan(0, bytes(raw)));
    expect(r.basis).toBe("unplaceable");
    expect(r.voting.length).toBeGreaterThan(0);
    expect(r.lines).toEqual([]);
  });

  it("[control] the two spans that decide this differ by exactly one byte", () => {
    // The pair above is only meaningful if the two inputs are genuinely
    // adjacent: a contrast pair whose halves differ in several ways proves
    // nothing about which difference mattered.
    expect(la().citationLineAgreement(withSpan(0, 4)).basis).toBe("agree");
    expect(la().citationLineAgreement(withSpan(0, 5)).basis).toBe("unplaceable");
  });
});

describe("offsets that cannot be read at all", () => {
  const raw = "abc\ndef";
  const withCite = (cite) => ({ outputText: raw, blocks: [{ text: raw, citations: [cite] }] });

  it.each([
    ["absent", { uri: "https://p.example.com/a" }],
    ["a numeric STRING", { startByte: "0", endByte: "3" }],
    ["fractional", { startByte: 0.5, endByte: 3 }],
    ["negative", { startByte: -1, endByte: 3 }],
    ["inverted", { startByte: 3, endByte: 1 }],
    ["past the end", { startByte: 0, endByte: 99 }],
  ])("%s offsets make every convention abstain", (_why, cite) => {
    const r = la().citationLineAgreement(withCite({ uri: "https://p.example.com/a", ...cite }));
    expect(r.basis).toBe("inconsistent");
    expect(r.lines).toEqual([]);
  });

  it("a non-string outputText with citations present is inconsistent, never a throw", () => {
    for (const outputText of [undefined, null, 0, {}, []]) {
      const r = la().citationLineAgreement({ outputText, blocks: [{ text: "abc", citations: [{ startByte: 0, endByte: 1 }] }] });
      expect(r.basis).toBe("inconsistent");
    }
  });

  it("a non-array blocks value is treated as no blocks, never a throw", () => {
    const r = la().citationLineAgreement({ outputText: raw, blocks: "nope" });
    expect(r.basis).toBe("no-citations");
  });
});

describe("UTF-8 byte offsets are never read as UTF-16 units (AC-N49.8(a))", () => {
  it("a line of multi-byte characters before the target does not move the attachment", () => {
    // MV-7 reads the byte offsets with `raw.slice`, which is UTF-16. Every
    // multi-byte character before the target makes the byte offset larger
    // than the unit index, so a UTF-16 reading lands PAST the target -- here,
    // on a different line entirely. The first line below is deliberately
    // heavy: an accented company name, an em dash and a euro sign.
    const heavy = `Nestlé — revenue rose to ${"€".repeat(14)} across the group.\n`;
    const target = "Recruiter screen first.\n";
    const tail = "Then the hiring manager round.\n";
    const raw = heavy + target + tail;
    // The instrument's own premise, asserted: the byte length of the first
    // line must exceed its unit length by MORE than the target line's own
    // length, or a UTF-16 reading still lands on the target line and this
    // row proves nothing. Measured: an accented name, an em dash and one
    // euro sign give a delta of 5, which is not enough -- hence the run of
    // euro signs, which is contrived but is the only way to make the two
    // readings land on different lines with prose this short.
    expect(bytes(heavy) - heavy.length).toBeGreaterThan(target.length);
    const startByte = bytes(heavy);
    const endByte = bytes(heavy + "Recruiter");
    const r = la().citationLineAgreement({
      outputText: raw,
      blocks: [{ text: raw, citations: [{ uri: "https://p.example.com/a", startByte, endByte }] }],
    });
    expect(r.basis).toBe("agree");
    expect(r.lines).toEqual([1]);
    expect(truthLineOf(raw, heavy.length, heavy.length + "Recruiter".length)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P1 -- the property. MANDATORY (plan.r2.md section 2.7).
// ---------------------------------------------------------------------------

describe("P1: over 4000 generated responses at each of two seeds, ZERO misattributions for every MODELLED convention", () => {
  // Deterministic local PRNG, seed printed with every run, so a failure can
  // be reproduced exactly. A generated response picks a block layout, a tail
  // start, one to three citation targets, and ONE truth convention out of
  // four -- the three the rule models plus `allBlocksNL`, which it does not.
  // The truth is computed by `truthLineOf`, this file's own copy of the
  // definition, never by asking the module where it thinks the span is.
  function lcg(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  const LINE_POOL = [
    "Northwind runs a recruiter screen first.",
    "Nestlé and Danone both report steady growth.",
    "Revenue rose eighteen percent — about €4m.",
    "The platform team ships weekly releases.",
    "A technical deep dive closes the loop.",
    "Hiring managers ask about rollbacks.",
  ];
  const MODELLED = ["block", "outputText", "allBlocks"];
  const UNMODELLED = ["allBlocksNL"];
  const CONVENTIONS = [...MODELLED, ...UNMODELLED];

  function run(seed, trials) {
    const rand = lcg(seed);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
    const stats = {};
    for (const c of CONVENTIONS) stats[c] = { attached: 0, wrong: 0, refused: 0, firstFailure: null };
    for (let trial = 0; trial < trials; trial += 1) {
      const nBlocks = int(1, 3);
      const texts = [];
      for (let b = 0; b < nBlocks; b += 1) {
        const nLines = int(1, 3);
        const lines = [];
        for (let l = 0; l < nLines; l += 1) lines.push(pick(LINE_POOL));
        texts.push(`${lines.join("\n")}\n`);
      }
      const tailStart = int(0, nBlocks - 1);
      const convention = pick(CONVENTIONS);
      const targets = [];
      const nTargets = int(1, 3);
      for (let t = 0; t < nTargets; t += 1) {
        // A preamble target is only expressible for the block-relative and
        // all-blocks conventions; `outputText` offsets cannot name text that
        // is not in `output_text`.
        const lowest = convention === "outputText" ? tailStart : 0;
        const block = int(lowest, nBlocks - 1);
        const text = texts[block];
        const innerStart = int(0, Math.max(0, text.length - 2));
        // A quarter of targets deliberately reach across a newline.
        const width = rand() < 0.25 ? int(text.length > 20 ? 20 : 2, Math.max(2, text.length - innerStart)) : int(1, 8);
        const innerEnd = Math.min(text.length, innerStart + width);
        if (innerEnd <= innerStart) continue;
        targets.push({ block, innerStart, innerEnd });
      }
      if (targets.length === 0) continue;
      const s = buildScenario({ texts, tailStart, targets, convention });
      const r = la().citationLineAgreement({ outputText: s.raw, blocks: s.blocks });
      const stat = stats[convention];
      if (r.basis !== "agree") {
        stat.refused += 1;
        continue;
      }
      stat.attached += 1;
      for (let i = 0; i < s.truth.length; i += 1) {
        if (s.truth[i] === null || r.lines[i] !== s.truth[i]) {
          stat.wrong += 1;
          if (!stat.firstFailure) stat.firstFailure = { trial, convention, tailStart, truth: s.truth, got: r.lines, raw: s.raw };
          break;
        }
      }
    }
    const total = (keys) =>
      keys.reduce(
        (acc, c) => ({
          attached: acc.attached + stats[c].attached,
          wrong: acc.wrong + stats[c].wrong,
          refused: acc.refused + stats[c].refused,
          firstFailure: acc.firstFailure || stats[c].firstFailure,
        }),
        { attached: 0, wrong: 0, refused: 0, firstFailure: null },
      );
    return { seed, trials, stats, modelled: total(MODELLED), unmodelled: total(UNMODELLED) };
  }

  function log(tag, out, slice) {
    console.log(
      `[N49 P1] seed=${out.seed} trials=${out.trials} ${tag}: attached=${slice.attached} refused=${slice.refused} wrong=${slice.wrong}`,
    );
    if (slice.firstFailure) {
      console.log(`[N49 P1] ${tag} first failure: ${JSON.stringify(slice.firstFailure)}`);
    }
  }

  it.each([12345, 777])(
    "seed %i, the three MODELLED conventions: wrong === 0, and the rule still attaches something",
    (seed) => {
      // THE property. Its guarantee is a theorem, not a statistic: a
      // convention abstains only for a structurally impossible reading, the
      // true convention is never structurally impossible for well-formed
      // offsets, so any agreement includes the truth and the agreed line is
      // the true line. Any non-zero number here is a defect in the rule.
      const out = run(seed, 4000);
      log("modelled", out, out.modelled);
      expect(out.modelled.wrong).toBe(0);
      // The "never attach" defence: a rule that refuses everything has zero
      // wrong attachments and is useless. This is the floor that makes the
      // zero above mean something.
      expect(out.modelled.attached).toBeGreaterThan(50);
    },
  );

  it.each([12345, 777])(
    "seed %i, [DISCLOSED RESIDUAL] an UNMODELLED convention can be misattributed, and the rate is bounded and printed",
    (seed) => {
      // FINDING, measured here and not inherited: plan.r2.md section 2.7
      // reports "0/4000 at both seeds, including the unmodelled allBlocksNL
      // truth". On an INDEPENDENT generator that does not reproduce. Blocks
      // joined with a newline shift every offset by one byte per preceding
      // block, and on short prose that shift sometimes lands on a boundary
      // that all three modelled conventions read as the same, wrong line.
      // Nothing in the offsets can reveal it, so V3 as specified cannot
      // catch it -- this is a limit of the rule, not a bug in it.
      //
      // Bounded rather than pinned, in both directions on purpose:
      //   * a build that adds allBlocksNL as a FOURTH voting convention
      //     drives this to zero and still passes, which is the right
      //     outcome if the orchestrator takes that option;
      //   * a build that loosens the vote makes it exceed the ceiling and
      //     fails.
      // The ceiling is 5% of that slice's attachments, well clear of the
      // measured rate, so only a real regression reaches it.
      const out = run(seed, 4000);
      log("unmodelled", out, out.unmodelled);
      expect(out.unmodelled.attached).toBeGreaterThan(50);
      expect(out.unmodelled.wrong / out.unmodelled.attached).toBeLessThanOrEqual(0.05);
    },
  );

  it("[canary] the generator really does produce all four conventions and both outcomes", () => {
    // If the generator silently produced one shape, the properties above
    // would be green while covering a quarter of what they claim. This
    // measures the corpus, not the build.
    const rand = lcg(999);
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(CONVENTIONS[Math.floor(rand() * CONVENTIONS.length)]);
    expect(seen.size).toBe(4);
    const out = run(12345, 1200);
    for (const convention of CONVENTIONS) {
      expect(out.stats[convention].attached).toBeGreaterThan(0);
      expect(out.stats[convention].refused).toBeGreaterThan(0);
    }
  });
});

describe("the walker and the rule meet (the join, tested with the real consumer)", () => {
  it("the per-block walk feeds the rule the shape it expects", () => {
    // Two individually-correct halves can still be wired together wrong. The
    // rule's `blocks` input is whatever `extractCitationSourcesByBlock`
    // returns, so this row runs the REAL walker over a REAL interaction shape
    // rather than a hand-built fixture of what the rule thinks it wants.
    const text = "Recruiter screen first.\nThen the manager round.\n";
    const interaction = {
      steps: [
        {
          type: "model_output",
          content: [
            {
              type: "text",
              text,
              // The wire shape, spelled the way the walker actually reads it:
              // a FLAT annotation with snake_case `start_index`/`end_index`.
              // Measured: a nested `url_citation: { start_byte }` object --
              // the shape a reader might reasonably assume -- yields a
              // citation with undefined offsets, which reads as
              // "inconsistent" and would have made this row a false red.
              annotations: [
                { type: "url_citation", url: "https://p.example.com/a", title: "t", start_index: 0, end_index: 9 },
              ],
            },
          ],
        },
      ],
    };
    const blocks = extractCitationSourcesByBlock(interaction);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].citations).toHaveLength(1);
    const r = la().citationLineAgreement({ outputText: text, blocks });
    expect(r.citations).toBe(1);
    expect(r.basis).toBe("agree");
    expect(r.lines).toEqual([0]);
  });

  it("S2a's promotion keeps ONE walker: the two import paths give the identical function", () => {
    // W-S2a. If `glossaryCitations.js` kept a local copy instead of
    // re-exporting, both files would pass their own tests and drift apart --
    // and the digest route would be walking a different function from the one
    // this rule was measured against.
    if (!IB) throw new Error("lib/llm/interactionBlocks.js is not written yet");
    expect(IB.extractCitationSourcesByBlock).toBe(extractCitationSourcesByBlock);
  });

  it("LINE_ATTACH_VERSION is the stored shape's own version", () => {
    expect(la().LINE_ATTACH_VERSION).toBe(1);
  });
});
