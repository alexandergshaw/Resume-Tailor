// N115 round 2 -- ONE row derivation behind every count.
//
// Round 1 made the panel (ReviewFlagsPanel) draw a missing-keyword flag as its own
// row when a surface opts in (`documentLevelMissingKeyword`), but the "N suggestions"
// summary and the announcement still merged the keywords that share a span, so the
// headline said fewer findings than the panel listed. The panel's row derivation now
// lives in flagPresentation.js#flagRows and the counters call the same function with
// the same flag, so for any (flags, optIn):
//
//   panel row count === summary count === announce count
//
// The expected numbers below are written as literals, never recomputed from flagRows,
// so a counter that quietly diverges from the panel cannot agree with itself.

import { describe, it, expect } from "vitest";
import { CATEGORY } from "./contract.js";
import { DRAFT_KIND, TIER, flagRows, groupFlagsBySpan } from "./flagPresentation.js";
import { reviewPresentationState } from "./reviewPresentation.js";
import { REVIEW_KIND } from "./reviewVerdict.js";

const FIRST_LINE = "Shipped microservices in Go";

// The shipped reviewer shape: one flag per missing term, every one anchored on the
// first draft span (s1) and carrying that line as its excerpt.
const keyword = (term, requirementId) => ({
  category: CATEGORY.MISSING_KEYWORD,
  spanId: "s1",
  message: `The posting asks for "${term}" but this draft never mentions it.`,
  excerpt: FIRST_LINE,
  evidenceRef: { origin: "posting", spanId: requirementId },
  evidenceExcerpt: `Needs ${term}.`,
});
const vague = { category: CATEGORY.VAGUE_UNSUPPORTED, spanId: "s3", message: "too vague", excerpt: "Drove impactful outcomes" };
const metric = { category: CATEGORY.UNVERIFIABLE_METRIC, spanId: "s1", message: "no baseline", excerpt: FIRST_LINE };
const repeated = { category: CATEGORY.REPETITION, spanId: "s3", message: "said twice", excerpt: "Drove impactful outcomes" };

// 2 keywords on s1 + 1 line flag: merged by span that is 2 rows, one each when opted in.
const TWO_KEYWORDS_AND_A_LINE = [keyword("Kubernetes", "q1"), keyword("PCI compliance", "q2"), vague];
// The same, with a Confirm-tier flag on the keywords' span: the merged s1 row is a
// Confirm row, so the tier split moves too (1 confirm + 1 other merged; 1 + 3 split).
const WITH_A_CONFIRM_ON_S1 = [keyword("Kubernetes", "q1"), keyword("PCI compliance", "q2"), metric, vague];
// No keyword flag at all: the opt-in has nothing to move.
const NO_KEYWORD_FLAGS = [metric, vague, repeated];

describe("flagRows -- the panel's row derivation, shared", () => {
  it("OFF (the default, and an explicit false) is exactly groupFlagsBySpan", () => {
    for (const flags of [TWO_KEYWORDS_AND_A_LINE, WITH_A_CONFIRM_ON_S1, NO_KEYWORD_FLAGS]) {
      const merged = groupFlagsBySpan(flags, DRAFT_KIND.APPLICATION_READY);
      expect(flagRows(flags, DRAFT_KIND.APPLICATION_READY)).toEqual(merged);
      expect(flagRows(flags, DRAFT_KIND.APPLICATION_READY, false)).toEqual(merged);
    }
  });

  it("ON gives each missing keyword its own row with no span and no quoted line, ahead of the line-level rows", () => {
    const rows = flagRows(TWO_KEYWORDS_AND_A_LINE, DRAFT_KIND.APPLICATION_READY, true);
    expect(rows).toHaveLength(3);
    expect(rows.slice(0, 2).map((row) => [row.spanId, row.excerpt, row.items.length])).toEqual([
      [null, "", 1],
      [null, "", 1],
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
    expect(rows[2].spanId).toBe("s3");
  });

  it("CONTROL: with no keyword flag, ON and OFF are the same rows", () => {
    expect(flagRows(NO_KEYWORD_FLAGS, DRAFT_KIND.APPLICATION_READY, true)).toEqual(
      flagRows(NO_KEYWORD_FLAGS, DRAFT_KIND.APPLICATION_READY, false),
    );
  });

  it("is total over junk input in both modes", () => {
    for (const optIn of [false, true]) {
      expect(flagRows(null, DRAFT_KIND.APPLICATION_READY, optIn)).toEqual([]);
      expect(flagRows("nope", DRAFT_KIND.APPLICATION_READY, optIn)).toEqual([]);
      expect(flagRows([null, 3, "x", undefined], DRAFT_KIND.APPLICATION_READY, optIn)).toEqual([]);
    }
    expect(flagRows([null, keyword("Kubernetes", "q1")], DRAFT_KIND.APPLICATION_READY, true)).toHaveLength(1);
  });
});

const outcome = (flags, draftKind = DRAFT_KIND.APPLICATION_READY) => ({
  status: "reviewed",
  draftKind,
  title: "Resume",
  lineCount: 8,
  flags,
  unresolvedQualifications: [],
  verdictKind: REVIEW_KIND.PARTIAL,
  missingChecks: [],
  checkedChecks: [],
  engineMode: "mechanical-only",
  inputs: { posting: true, realMaterial: true },
});

const number = (text, pattern) => Number(pattern.exec(text)?.[1] ?? 0);
const present = (flags, draftKind, optIn) =>
  reviewPresentationState({ outcome: outcome(flags, draftKind), documentLevelMissingKeyword: optIn });

// [name, flags, draftKind, { optIn: expected rows, confirm }]. The literals are the
// numbers a person reading the panel counts.
const CASES = [
  [
    "2 keywords on one span + a line flag",
    TWO_KEYWORDS_AND_A_LINE,
    DRAFT_KIND.APPLICATION_READY,
    { on: { rows: 3, confirm: 0 }, off: { rows: 2, confirm: 0 } },
  ],
  [
    "the same with a Confirm-tier flag on the keywords' span",
    WITH_A_CONFIRM_ON_S1,
    DRAFT_KIND.APPLICATION_READY,
    { on: { rows: 4, confirm: 1 }, off: { rows: 2, confirm: 1 } },
  ],
  [
    "the same on the hypothetical draft (every row a Note)",
    TWO_KEYWORDS_AND_A_LINE,
    DRAFT_KIND.HYPOTHETICAL,
    { on: { rows: 3, confirm: 0 }, off: { rows: 2, confirm: 0 } },
  ],
  [
    "CONTROL: no keyword flag",
    NO_KEYWORD_FLAGS,
    DRAFT_KIND.APPLICATION_READY,
    { on: { rows: 2, confirm: 1 }, off: { rows: 2, confirm: 1 } },
  ],
];

describe("the count invariant -- panel rows === summary count === announce count", () => {
  for (const [name, flags, draftKind, expected] of CASES) {
    for (const [mode, optIn] of [
      ["ON", true],
      ["OFF", false],
    ]) {
      const want = expected[mode.toLowerCase()];
      it(`${name}, ${mode}: ${want.rows} rows everywhere`, () => {
        const rows = flagRows(flags, draftKind, optIn);
        expect(rows).toHaveLength(want.rows);
        expect(rows.filter((row) => row.tier === TIER.CONFIRM)).toHaveLength(want.confirm);

        const state = present(flags, draftKind, optIn);
        expect(number(state.summary, /(\d+) to confirm/)).toBe(want.confirm);
        const counted = number(state.summary, /(\d+) suggestions?/) + number(state.summary, /(\d+) to confirm/);
        expect(counted).toBe(want.rows);
        expect(number(state.announce, /(\d+) to check/)).toBe(want.rows);
      });
    }
  }

  it("the default (option left out) counts exactly as OFF does: the pre-fix merged numbers", () => {
    const state = reviewPresentationState({ outcome: outcome(TWO_KEYWORDS_AND_A_LINE) });
    expect(state.summary).toBe("2 suggestions");
    expect(state.announce).toContain("2 to check");
    const withConfirm = reviewPresentationState({ outcome: outcome(WITH_A_CONFIRM_ON_S1) });
    expect(withConfirm.summary).toBe("1 to confirm, 1 suggestion");
  });

  it("ON says what the panel lists: the headline summary names every keyword row", () => {
    expect(present(TWO_KEYWORDS_AND_A_LINE, DRAFT_KIND.APPLICATION_READY, true).summary).toBe("3 suggestions");
    expect(present(WITH_A_CONFIRM_ON_S1, DRAFT_KIND.APPLICATION_READY, true).summary).toBe("1 to confirm, 3 suggestions");
  });
});
