import { describe, it, expect } from "vitest";
import { CATEGORY, ORIGIN } from "./contract.js";
import { GATE_REASON } from "../llm/ideal/applicationReadyGate.js";
import {
  DRAFT_KIND,
  TIER,
  FLAG_PRESENTATION,
  CHECK_LABELS,
  REMOVAL_REASONS,
  bandSummary,
  evidenceNote,
  groupFlagsBySpan,
  presentFlag,
  removalReason,
  removedCopyOutcome,
  textRows,
} from "./flagPresentation.js";

// N105 Step 8-UI -- the pure half of the review surface. The DOM tests exercise
// these through the components; this file pins the rules that are easy to get
// wrong without a render: tier by (draft, category), document order, merging, and
// the zero-omitting summary.

const CATEGORIES = Object.values(CATEGORY);
const CONFIRM_TIER = [
  CATEGORY.UNSUPPORTED_AUTHORITY,
  CATEGORY.UNVERIFIABLE_METRIC,
  CATEGORY.CONSISTENCY,
  CATEGORY.EMPLOYER_PLAUSIBILITY,
];

describe("flagPresentation tables", () => {
  it("covers all seven categories on both drafts, and every check has a plain name", () => {
    for (const draft of Object.values(DRAFT_KIND)) {
      for (const category of CATEGORIES) {
        const found = FLAG_PRESENTATION[draft][category];
        expect(found, `${draft} / ${category}`).toBeTruthy();
        expect(found.label.length).toBeGreaterThan(0);
      }
    }
    for (const category of CATEGORIES) expect(CHECK_LABELS[category]).toBeTruthy();
  });

  it("application-ready: truth-risk categories are Confirm, the rest Improve; hypothetical is all Note", () => {
    for (const category of CATEGORIES) {
      const expected = CONFIRM_TIER.includes(category) ? TIER.CONFIRM : TIER.IMPROVE;
      expect(presentFlag(DRAFT_KIND.APPLICATION_READY, category).tier, category).toBe(expected);
      expect(presentFlag(DRAFT_KIND.HYPOTHETICAL, category).tier, category).toBe(TIER.NOTE);
    }
  });

  it("an unknown category is still shown, at the most cautious tier for its draft", () => {
    expect(presentFlag(DRAFT_KIND.APPLICATION_READY, "brand-new").tier).toBe(TIER.CONFIRM);
    expect(presentFlag(DRAFT_KIND.HYPOTHETICAL, "brand-new").tier).toBe(TIER.NOTE);
    expect(presentFlag(DRAFT_KIND.APPLICATION_READY, "brand-new").label).toBeTruthy();
  });

  it("an unknown draft reads as application-ready, and prototype keys are not categories", () => {
    expect(presentFlag("cover-letter", CATEGORY.CONSISTENCY).tier).toBe(TIER.CONFIRM);
    expect(presentFlag(DRAFT_KIND.APPLICATION_READY, "constructor").label).toBe("Needs a look");
    expect(presentFlag("toString", CATEGORY.REPETITION).tier).toBe(TIER.IMPROVE);
  });

  it("removal reasons are keyed by the gate's codes, with a fallback for an unknown one", () => {
    for (const code of Object.values(GATE_REASON)) expect(REMOVAL_REASONS[code]).toBeTruthy();
    expect(removalReason(GATE_REASON.MEMBERSHIP)).toBe("Belongs to a different employer");
    expect(removalReason("something-new")).toBe("Could not be matched to your resume");
    expect(removalReason(undefined)).toBe("Could not be matched to your resume");
  });
});

describe("groupFlagsBySpan", () => {
  const flag = (spanId, category, extra = {}) => ({ spanId, category, message: "", excerpt: `line ${spanId}`, ...extra });

  it("merges flags on one span into one row, strictest tier first", () => {
    const rows = groupFlagsBySpan(
      [flag("s1", CATEGORY.REPETITION), flag("s1", CATEGORY.UNVERIFIABLE_METRIC)],
      DRAFT_KIND.APPLICATION_READY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe(TIER.CONFIRM);
    expect(rows[0].items.map((i) => i.category)).toEqual([CATEGORY.UNVERIFIABLE_METRIC, CATEGORY.REPETITION]);
  });

  it("orders by tier, then by DOCUMENT position (numeric span id), not by string order", () => {
    const rows = groupFlagsBySpan(
      [
        flag("s10", CATEGORY.REPETITION),
        flag("s2", CATEGORY.REPETITION),
        flag("s11", CATEGORY.CONSISTENCY),
        flag("s3", CATEGORY.CONSISTENCY),
      ],
      DRAFT_KIND.APPLICATION_READY,
    );
    expect(rows.map((r) => r.spanId)).toEqual(["s3", "s11", "s2", "s10"]);
  });

  it("an id with no numeric suffix sorts after numbered ones; ties keep input order", () => {
    const rows = groupFlagsBySpan(
      [flag("intro", CATEGORY.REPETITION), flag("s4", CATEGORY.REPETITION), flag("outro", CATEGORY.REPETITION)],
      DRAFT_KIND.APPLICATION_READY,
    );
    expect(rows.map((r) => r.spanId)).toEqual(["s4", "intro", "outro"]);
  });

  it("a flag with no usable span id is its own row and is never dropped", () => {
    const rows = groupFlagsBySpan(
      [{ category: CATEGORY.REPETITION, message: "a" }, { category: CATEGORY.REPETITION, message: "b" }],
      DRAFT_KIND.APPLICATION_READY,
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("is total over junk input", () => {
    expect(groupFlagsBySpan(null, DRAFT_KIND.APPLICATION_READY)).toEqual([]);
    expect(groupFlagsBySpan([null, 3, "x", undefined], DRAFT_KIND.APPLICATION_READY)).toEqual([]);
  });
});

describe("evidenceNote", () => {
  const note = (ref, evidenceExcerpt = "the quote") => evidenceNote({ evidenceRef: ref, evidenceExcerpt });

  it("prefixes by where the evidence lives", () => {
    expect(note({ origin: ORIGIN.POSTING, spanId: "r1" }).prefix).toBe("From the posting: ");
    expect(note({ origin: ORIGIN.REAL_MATERIAL, spanId: "m1" }).prefix).toBe("In your resume: ");
    expect(note({ origin: ORIGIN.DRAFT, draftKind: DRAFT_KIND.HYPOTHETICAL, spanId: "s1" }).prefix).toBe(
      "In the HYPOTHETICAL draft: ",
    );
    expect(note({ origin: ORIGIN.DRAFT, draftKind: DRAFT_KIND.APPLICATION_READY, spanId: "s1" }).prefix).toBe(
      "In the Application-ready draft: ",
    );
  });

  it("is null without a ref, without resolved text, or with an unknown origin", () => {
    expect(evidenceNote({ evidenceExcerpt: "x" })).toBeNull();
    expect(note({ origin: ORIGIN.POSTING, spanId: "r1" }, "  ")).toBeNull();
    expect(note({ origin: "elsewhere", spanId: "r1" })).toBeNull();
    expect(evidenceNote(null)).toBeNull();
  });
});

describe("textRows and bandSummary", () => {
  it("textRows keeps only entries with text to show", () => {
    const kept = textRows([{ text: "a" }, { text: "  " }, { text: 3 }, null, "x", { text: "b" }]);
    expect(kept.map((i) => i.text)).toEqual(["a", "b"]);
    expect(textRows(undefined)).toEqual([]);
  });

  it("names only NON-ZERO counts, so a zero can never read as a clean bill", () => {
    expect(bandSummary({})).toBe("");
    expect(bandSummary({ removed: 0, confirm: 0, requirements: 0, suggestions: 0 })).toBe("");
    expect(bandSummary({ removed: 2, confirm: 0, requirements: 1, suggestions: 3 })).toBe(
      "2 removed to verify, 1 requirement wording cannot cover, 3 suggestions",
    );
    expect(bandSummary({ confirm: 1, suggestions: 1 })).toBe("1 to confirm, 1 suggestion");
    expect(bandSummary({ requirements: 2 })).toBe("2 requirements wording cannot cover");
  });
});

describe("removedCopyOutcome", () => {
  it("success is polite, failure is a persisted alert -- exactly one of the two", () => {
    const ok = removedCopyOutcome({ ok: true, via: "async" });
    expect(ok.polite).toBe("Copied the removed line.");
    expect(ok.alert).toBe("");
    const bad = removedCopyOutcome({ ok: false, via: "textarea", reason: "refused" });
    expect(bad.alert).toBe("Couldn't copy. Select the line and copy it.");
    expect(bad.polite).toBe("");
    expect(bad.persist).toBe(true);
  });
});
