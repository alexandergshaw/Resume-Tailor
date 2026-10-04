// N105 Step 7 -- the pure bridge from a tailoring entry's Ideal run to the preview
// surface. The properties worth pinning: it can never make a result read clean
// (K3), it joins the pipeline's gate output into the shape the band reads, it
// resolves quoted lines onto reviewer flags without inventing any, and the
// hypothetical it hands the dialog is its OWN document under a marked name.

import { describe, it, expect } from "vitest";
import { CATEGORY } from "../review/contract.js";
import { idealBandState } from "./idealBandState.js";
import { idealSurfaceFor } from "./idealSurface.js";

const ALL_CATEGORIES = Object.values(CATEGORY);
const READY = "Application-ready line one\nApplication-ready line two";

const REMOVED = [
  { spanId: "s3", text: "Led a team of ten.", section: "Experience", contextKey: "Acme", reasonCode: "unverified", anchor: null },
];
const LEFT_OUT = [{ spanId: "s4", text: "Won a national award.", reasonCode: "no-match" }];
const COUNTS = { kept: 4, keptAccomplishments: 2, removed: 1, leftOut: 1 };

function entry(ideal, extra = {}) {
  return {
    result: READY,
    ideal: {
      hypothetical: { result: "Hypothetical best-case line", resultLines: ["Hypothetical best-case line"] },
      applicationReady: { result: READY },
      review: null,
      ...ideal,
    },
    ...extra,
  };
}

const OPTS = { title: "Staff Engineer", company: "Acme" };
const stateOf = (surface) =>
  idealBandState({ ideal: surface.ideal, currentText: surface.currentText, handEdited: surface.handEdited });

describe("idealSurfaceFor -- which entries get a surface", () => {
  it("returns null for an entry with no Ideal run, and for no entry at all", () => {
    expect(idealSurfaceFor({ result: "Resume text" }, OPTS)).toBeNull();
    expect(idealSurfaceFor(undefined, OPTS)).toBeNull();
    expect(idealSurfaceFor({ result: "x", ideal: null }, OPTS)).toBeNull();
  });
});

describe("idealSurfaceFor -- the Application-ready tab label is derived", () => {
  it("reads Application-ready while the file on screen is the file that was generated", () => {
    expect(idealSurfaceFor(entry({}), OPTS).resumeTabLabel).toBe("Application-ready");
  });

  it("drops the claim (null) when a different saved version is showing", () => {
    expect(idealSurfaceFor(entry({}, { result: "A different saved version" }), OPTS).resumeTabLabel).toBeNull();
  });

  it("keeps the claim for a hand-edited file (the band explains the edit)", () => {
    const edited = entry({}, { result: "Edited by hand", edited: { resume: true, cover: false } });
    expect(idealSurfaceFor(edited, OPTS).resumeTabLabel).toBe("Application-ready");
  });
});

describe("idealSurfaceFor -- joining the gate output into the band's review", () => {
  it("slice 1: a null review with gate output is PARTIAL (never clean) and still lists removed and left out", () => {
    const surface = idealSurfaceFor(entry({ removed: REMOVED, leftOut: LEFT_OUT, counts: COUNTS }), OPTS);
    const state = stateOf(surface);
    expect(state.review).toBe("partial");
    expect(state.verdictClean).toBe(false);
    expect(state.groups).toBe("all");
    expect(surface.ideal.review.removed).toEqual(REMOVED);
    expect(surface.ideal.review.leftOut).toEqual(LEFT_OUT);
    expect(surface.ideal.review.counts).toEqual(COUNTS);
    // No coverage was invented to make the review look complete.
    expect(surface.ideal.review.coverage).toBeUndefined();
  });

  it("a null review and no gate output stays null: the band's 'review did not run' state", () => {
    const surface = idealSurfaceFor(entry({}), OPTS);
    expect(surface.ideal.review).toBeNull();
    expect(stateOf(surface).review).toBe("none");
  });

  it("an empty gate result with a null review is still not clean", () => {
    const surface = idealSurfaceFor(entry({ removed: [], leftOut: [], counts: COUNTS }), OPTS);
    expect(stateOf(surface).verdictClean).toBe(false);
  });

  it("a live review keeps every field it carries; the gate lists fill in only what it lacks", () => {
    const review = {
      coverage: { engineMode: "full", evaluatedCategories: ALL_CATEGORIES, complete: true },
      flags: [],
      unresolvedQualifications: [],
      removed: [{ text: "from the reviewer" }],
    };
    const surface = idealSurfaceFor(entry({ review, removed: REMOVED, leftOut: LEFT_OUT, counts: COUNTS }), OPTS);
    expect(surface.ideal.review.removed).toEqual([{ text: "from the reviewer" }]);
    expect(surface.ideal.review.leftOut).toEqual(LEFT_OUT);
    expect(surface.ideal.review.coverage).toEqual(review.coverage);
  });

  it("CONTROL: a complete review with no findings on the fresh file still reaches the clean verdict (the join does not block it)", () => {
    const review = {
      coverage: { engineMode: "full", evaluatedCategories: ALL_CATEGORIES, complete: true },
      flags: [],
      unresolvedQualifications: [],
    };
    const surface = idealSurfaceFor(entry({ review, removed: [], leftOut: [], counts: COUNTS }), OPTS);
    expect(stateOf(surface).verdictClean).toBe(true);
  });

  it("a flag list that is not an array stays unknown: it is never turned into 'no findings'", () => {
    const review = {
      coverage: { engineMode: "full", evaluatedCategories: ALL_CATEGORIES, complete: true },
      flags: "none",
      unresolvedQualifications: [],
    };
    const surface = idealSurfaceFor(entry({ review, removed: [], leftOut: [], counts: COUNTS }), OPTS);
    expect(surface.ideal.review.flags).toBe("none");
    expect(stateOf(surface).verdictClean).toBe(false);
  });
});

describe("idealSurfaceFor -- resolving quoted lines onto reviewer flags", () => {
  const review = (flags) => ({
    coverage: { engineMode: "full", evaluatedCategories: ALL_CATEGORIES, complete: true },
    flags,
    unresolvedQualifications: [],
  });
  const flagsOf = (surface) => surface.ideal.review.flags;

  it("quotes the flagged line and its evidence from the id tables", () => {
    const flags = [
      {
        category: CATEGORY.CONSISTENCY,
        draftKind: "applicationReady",
        spanId: "s2",
        message: "m",
        evidenceRef: { origin: "real-material", spanId: "r1" },
      },
      {
        category: CATEGORY.REPETITION,
        draftKind: "applicationReady",
        spanId: "s1",
        message: "m",
        evidenceRef: { origin: "draft", draftKind: "hypothetical", spanId: "h1" },
      },
    ];
    const spanTexts = {
      applicationReady: { s1: "Line one", s2: "Line two" },
      hypothetical: { h1: "Best-case line" },
      realMaterial: { r1: "From the resume" },
      posting: {},
    };
    const out = flagsOf(idealSurfaceFor(entry({ review: review(flags), spanTexts }), OPTS));
    expect(out[0].excerpt).toBe("Line two");
    expect(out[0].evidenceExcerpt).toBe("From the resume");
    expect(out[1].excerpt).toBe("Line one");
    expect(out[1].evidenceExcerpt).toBe("Best-case line");
  });

  it("a flag that already carries an excerpt keeps it", () => {
    const flags = [{ category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "s1", excerpt: "Joined by the server" }];
    const out = flagsOf(idealSurfaceFor(entry({ review: review(flags), spanTexts: { applicationReady: { s1: "Table" } } }), OPTS));
    expect(out[0].excerpt).toBe("Joined by the server");
  });

  it("an id with no entry is left unquoted, and an inherited key never resolves", () => {
    const flags = [
      { category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "s9" },
      { category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "constructor" },
      { category: CATEGORY.REPETITION, draftKind: "__proto__", spanId: "s1" },
    ];
    const out = flagsOf(idealSurfaceFor(entry({ review: review(flags), spanTexts: { applicationReady: { s1: "Line one" } } }), OPTS));
    for (const flag of out) expect(flag.excerpt).toBeUndefined();
  });

  it("with no id tables the flags pass through as the same objects", () => {
    const flags = [{ category: CATEGORY.REPETITION, draftKind: "applicationReady", spanId: "s1" }];
    expect(flagsOf(idealSurfaceFor(entry({ review: review(flags) }), OPTS))).toBe(flags);
  });
});

describe("idealSurfaceFor -- when the band needs the preview's live-region pair", () => {
  const gate = { removed: REMOVED, leftOut: LEFT_OUT, counts: COUNTS };

  it("announces while the band shows Removed rows", () => {
    expect(idealSurfaceFor(entry(gate), OPTS).announces).toBe(true);
  });

  it("does not announce with nothing removed (no Copy line exists to announce)", () => {
    expect(idealSurfaceFor(entry({ removed: [], leftOut: LEFT_OUT, counts: COUNTS }), OPTS).announces).toBe(false);
    expect(idealSurfaceFor(entry({}), OPTS).announces).toBe(false);
  });

  it("does not announce when the review is hidden because a different version is showing", () => {
    expect(idealSurfaceFor(entry(gate, { result: "A different saved version" }), OPTS).announces).toBe(false);
  });
});

describe("idealSurfaceFor -- the hypothetical is its own document under a marked name", () => {
  it("takes its text and lines from the hypothetical draft, never the application-ready one", () => {
    const surface = idealSurfaceFor(entry({}), OPTS);
    expect(surface.hypothetical.available).toBe(true);
    expect(surface.hypothetical.text).toBe("Hypothetical best-case line");
    expect(surface.hypotheticalLines).toEqual(["Hypothetical best-case line"]);
    expect(surface.hypotheticalLines.join("\n")).not.toContain("Application-ready");
    expect(surface.hypothetical.tabLabel).toBe("HYPOTHETICAL");
  });

  it("falls back to splitting the text when the draft carries no lines", () => {
    const surface = idealSurfaceFor(
      entry({ hypothetical: { result: "One\nTwo" } }),
      OPTS,
    );
    expect(surface.hypotheticalLines).toEqual(["One", "Two"]);
  });

  it("is unavailable when the draft has no text", () => {
    expect(idealSurfaceFor(entry({ hypothetical: { result: "  " } }), OPTS).hypothetical.available).toBe(false);
    expect(idealSurfaceFor(entry({ hypothetical: undefined }), OPTS).hypothetical.available).toBe(false);
  });

  it("the file name BEGINS with the token: a committed name that lacks it is marked, one that has it is kept", () => {
    const plain = idealSurfaceFor(entry({}, { hypotheticalFileName: "Staff Engineer - Acme" }), OPTS);
    expect(plain.hypothetical.fileName).toMatch(/^\[HYPOTHETICAL\] Staff Engineer - Acme$/);
    const marked = idealSurfaceFor(entry({}, { hypotheticalFileName: "[HYPOTHETICAL] Staff Engineer - Acme" }), OPTS);
    expect(marked.hypothetical.fileName).toBe("[HYPOTHETICAL] Staff Engineer - Acme");
  });

  it("with no committed name it is derived from the posting and still marked", () => {
    const name = idealSurfaceFor(entry({}), OPTS).hypothetical.fileName;
    expect(name).toMatch(/^\[HYPOTHETICAL\]/);
    expect(name).toContain("Staff Engineer");
    expect(name).not.toMatch(/\.docx$/i);
  });
});
