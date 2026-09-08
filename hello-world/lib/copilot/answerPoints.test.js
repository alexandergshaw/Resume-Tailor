import { describe, it, expect } from "vitest";
import { cleanAnswerPoints, answerLines } from "./answerPoints.js";
// Only used by the "pins deriveCues and answerLines together" block below,
// which exists specifically so the two modules are checked wired together
// rather than each passing in isolation while still failing as a pair.
import { deriveCues } from "./answerCues.js";

describe("cleanAnswerPoints — well-formed input passes through", () => {
  it("returns a normal array of non-empty strings unchanged", () => {
    const points = ["Situation: led a migration.", "Result: cut latency 40%."];
    expect(cleanAnswerPoints(points)).toEqual(points);
  });
});

// BUG-J6's original guard: anything that is not a non-empty string must be
// dropped rather than reaching the render layer as a blank/broken bullet.
describe("cleanAnswerPoints — drops anything that isn't a non-empty string", () => {
  it("drops an empty string", () => {
    expect(cleanAnswerPoints(["a real point", ""])).toEqual(["a real point"]);
  });

  it("drops a whitespace-only string", () => {
    expect(cleanAnswerPoints(["a real point", "   "])).toEqual(["a real point"]);
  });

  it("drops null", () => {
    expect(cleanAnswerPoints(["a real point", null])).toEqual(["a real point"]);
  });

  it("drops undefined", () => {
    expect(cleanAnswerPoints(["a real point", undefined])).toEqual(["a real point"]);
  });

  it("drops a number", () => {
    expect(cleanAnswerPoints(["a real point", 42])).toEqual(["a real point"]);
  });

  it("drops an object", () => {
    expect(cleanAnswerPoints(["a real point", { text: "not a string" }])).toEqual(["a real point"]);
  });

  it("drops every kind of bad entry at once, keeping only the real points", () => {
    const points = ["", "a real point", "   ", null, undefined, 42, {}, false, "another real point"];
    expect(cleanAnswerPoints(points)).toEqual(["a real point", "another real point"]);
  });
});

// The exact shape cachedSampleAnswerFor (lib/copilot/sampleAnswerState.js)
// hands to the render layer on a cache hit: it returns its entry's `points`
// array UNFILTERED (by design — see that function's doc comment), so a
// partly-malformed cached draft like this reaches CopilotDashboard.js's
// panels and SampleAnswer.js exactly as-is. This is the specific case BUG-J6
// was filed for.
describe("cleanAnswerPoints — the cachedSampleAnswerFor case", () => {
  it('cleans ["", "a real point"] down to exactly ["a real point"]', () => {
    expect(cleanAnswerPoints(["", "a real point"])).toEqual(["a real point"]);
  });
});

describe("cleanAnswerPoints — non-array input", () => {
  it("returns [] for null", () => {
    expect(cleanAnswerPoints(null)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(cleanAnswerPoints(undefined)).toEqual([]);
  });

  it("returns [] for a string", () => {
    expect(cleanAnswerPoints("not an array")).toEqual([]);
  });

  it("returns [] for a plain object", () => {
    expect(cleanAnswerPoints({ points: ["a"] })).toEqual([]);
  });

  it("does not throw for any non-array input", () => {
    for (const bad of [null, undefined, "x", 42, {}, true]) {
      expect(() => cleanAnswerPoints(bad)).not.toThrow();
    }
  });
});

// AC-J2.3-adjacent: callers (CurrentAnswerPanel/PredictedAnswerPanel in
// CopilotDashboard.js, SampleAnswer.js) test the FILTERED length to decide
// whether to render a list or fall through to their empty-state text. An
// all-blank array must clean down to [] so that branch is taken.
describe("cleanAnswerPoints — an all-blank array yields []", () => {
  it("cleans an array of only blank/whitespace strings to []", () => {
    expect(cleanAnswerPoints(["", "   ", "\t"])).toEqual([]);
  });

  it("cleans an array of only non-string junk to []", () => {
    expect(cleanAnswerPoints([null, undefined, 42, {}, false])).toEqual([]);
  });
});

// Trim behaviour, pinned explicitly: this module deliberately trims
// surviving entries (SampleAnswer.js's former local copy did this;
// CopilotDashboard.js's did not — see answerPoints.js's doc comment for why
// trimming was chosen as the one correct behaviour for both callers). A
// bullet with leading/trailing whitespace renders with a ragged indent
// inside the `<ul>` both call sites build, so trimming is not optional
// cleanup — it is the guard this module exists to provide.
describe("cleanAnswerPoints — trims surviving entries", () => {
  it("trims leading and trailing whitespace from a surviving entry", () => {
    expect(cleanAnswerPoints(["  Situation: led a migration.  "])).toEqual(["Situation: led a migration."]);
  });

  it("trims every surviving entry in a mixed array, in order", () => {
    expect(cleanAnswerPoints([" one ", "two", "  three"])).toEqual(["one", "two", "three"]);
  });

  it("does not mutate the input array", () => {
    const input = [" one ", "two"];
    const original = [...input];
    cleanAnswerPoints(input);
    expect(input).toEqual(original);
  });
});

// answerLines replaces the old answerBullets(cues, points), which returned
// the cues ALONE and used the full points only as a last-resort fallback —
// exactly the behaviour that produced the reported bug (see answerPoints.js's
// doc comment on answerLines for the full story). The pairing contract itself
// (positional, all-or-nothing, label handling, cue-vs-point vetting) is
// pinned precisely in answerLines.test.js, which is this feature's
// specification and is not touched here. What belongs in THIS file — the
// module's own test file — is the behaviour answerBullets used to guard that
// answerLines.test.js does not restate: the cached-draft fallback (cues
// missing entirely rather than merely empty) and cleanAnswerPoints's
// blank/malformed-entry filtering applied inside answerLines to both arrays
// before they are compared or paired.
describe("answerLines — a draft cached before cues existed still renders its full sentences", () => {
  // The concrete case this guards: useSampleAnswer's cache and live mode's
  // answerCacheRef both survive across a deploy within one open session, so
  // an entry cached before cues existed at all has `cues` missing from its
  // shape — not merely an empty array, genuinely undefined (or, read back
  // through some storage layers, null).
  it("renders full points with every cue blank when cues is undefined", () => {
    const points = ["First full sentence, drafted before cues existed.", "Second full sentence."];
    const lines = answerLines(undefined, points);
    expect(lines.map((l) => l.point)).toEqual(points);
    expect(lines.every((l) => l.cue === "")).toBe(true);
  });

  it("renders full points with every cue blank when cues is null", () => {
    const points = ["First full sentence, drafted before cues existed.", "Second full sentence."];
    const lines = answerLines(null, points);
    expect(lines.map((l) => l.point)).toEqual(points);
    expect(lines.every((l) => l.cue === "")).toBe(true);
  });
});

describe("answerLines — blank/malformed entries are filtered before pairing", () => {
  it("drops a blank/malformed point entry, returning one line per real point only", () => {
    const lines = answerLines([], ["", "First point.", "   ", null, undefined, 42, {}, "Second point."]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.point)).toEqual(["First point.", "Second point."]);
  });

  it("cleans non-string junk out of the cues array before the length comparison, so a match still pairs", () => {
    const points = ["First point about migrations.", "Second point about outcomes."];
    // Three raw entries, one of them junk — cleans down to exactly two,
    // which then lines up 1:1 with the two points.
    const lines = answerLines(["Migration work", 42, "Clear outcomes"], points);
    expect(lines.map((l) => l.cue)).toEqual(["Migration work", "Clear outcomes"]);
  });

  // Reversed from the old (buggy) contract pinned above this comment used to
  // sit under: a blank cue entry no longer gets cleaned OUT of the cues
  // array before the length comparison. deriveCues/resolveCues
  // (lib/copilot/answerCues.js) deliberately emit "" for a point too terse
  // to shorten, one entry per point, positions preserved — that placeholder
  // is meaningful data ("no cue for this line"), not malformed input the way
  // a blank POINT is. Cleaning it away here reduced the cues array's length
  // by one, which turned an exact, correct 1:1 pairing into a mismatch and
  // discarded every cue in the draft — the reported defect. A blank entry
  // now holds its own position: that one line renders without a cue, and it
  // must not disturb any other line's already-correct pairing.
  it("holds a blank cue entry's position instead of dropping it, so a real cue elsewhere in the array still pairs correctly", () => {
    const points = ["First point about migrations.", "Second point about outcomes."];
    const lines = answerLines(["Migration work", "   "], points);
    expect(lines.map((l) => l.point)).toEqual(points);
    expect(lines[0].cue).toBe("Migration work");
    expect(lines[1].cue).toBe("");
  });

  it("returns [] for a malformed draft (no cleaned points survive)", () => {
    expect(answerLines(["a cue"], [null, undefined, "", "   ", 42, {}])).toEqual([]);
  });
});

// A point that is ONLY a STAR label ("Situation:" with nothing after it) is
// non-blank, so cleanAnswerPoints lets it through — it only turns up empty
// once STAR_LABEL_RE strips the label off inside answerLines, one step later
// than cleaning. Rendered as-is that produces a bulleted line with a caption
// and no content, which is what this guards against.
describe("answerLines — a point that is only its own label is dropped", () => {
  it("drops a lone label-only point, returning no lines at all", () => {
    expect(answerLines([], ["Situation:"])).toEqual([]);
  });

  it("drops a label-only point sitting between two real points, keeping each surviving cue on its own point", () => {
    // Cue pairing must be decided from the CLEANED arrays before the
    // label-only point is dropped: cues[1] ("Middle cue") heads the
    // label-only points[1] and is discarded along with it, but cues[0] and
    // cues[2] must stay attached to points[0] and points[2] respectively —
    // not shift up to fill the gap left behind.
    const points = ["First real point.", "Situation:", "Second real point."];
    const cues = ["First cue", "Middle cue", "Second cue"];

    const lines = answerLines(cues, points);

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.point)).toEqual(["First real point.", "Second real point."]);
    expect(lines.map((l) => l.cue)).toEqual(["First cue", "Second cue"]);
  });

  it("returns [] when every point in the draft is label-only", () => {
    expect(answerLines([], ["Situation:", "Task:", "Action:", "Result:"])).toEqual([]);
  });
});

// The reported defect, reproduced exactly: a drafted answer with one point
// too terse for shortenToCue to make anything of ("I did.") used to lose
// EVERY cue in the draft, not just the one for that line, because deriveCues
// dropped the blank cue instead of holding its place, which shrank the cues
// array below the points count and tripped answerLines' all-or-nothing
// mismatch rule. The fix is that a blank cue now holds its own position, so
// only the terse line loses its cue and every other line keeps the one it
// earned.
describe("answerLines — a terse point mid-draft no longer takes every other line's cue down with it", () => {
  const POINTS = [
    "Situation: Led the migration of our billing platform to a new provider.",
    "I did.",
    "Result: Cut reconciliation time from three days to four hours.",
  ];

  it("pairs correctly when handed the blank-holding cues array directly, leaving only the terse line without a cue", () => {
    // The exact array deriveCues produces for POINTS below — spelled out
    // here so this case is readable on its own, without having to trust
    // deriveCues' own output first.
    const cues = [
      "Situation: Led the migration of our billing",
      "",
      "Result: Cut reconciliation time from three days",
    ];

    const lines = answerLines(cues, POINTS);

    expect(lines).toHaveLength(3);
    expect(lines[1].point).toBe("I did.");

    // READ THIS BEFORE CHANGING ANY ASSERTION BELOW.
    //
    // AC-C.1 drops a cue whose normalised tokens are a contiguous run of its
    // own point and reports the run's position as `emphasis` instead. Every
    // cue deriveCues produces IS such a run by construction — deriveCues
    // shortens a point to its own leading words — so after this chunk `cue` is
    // "" on all three lines here.
    //
    // THAT MAKES `cue` USELESS AS THIS CASE'S WITNESS, and blindly relaxing
    // the two assertions to `toBe("")` would have turned this case into a
    // green test defending the exact defect it was written for. Executed at
    // 1515a16 against the ORIGINAL defect (deriveCues dropping the blank
    // instead of holding its place, so cues.length 2 !== points.length 3 and
    // answerLines' all-or-nothing rule blanks every cue):
    //
    //   fixed      cue [ "",  "",  "" ]   emphasis [ {0,32}, null, {0,39} ]
    //   REGRESSED  cue [ "",  "",  "" ]   emphasis [  null,  null,  null  ]
    //
    // `cue` is identical under both. `emphasis` is not. So the property — a
    // blank cue HOLDS ITS POSITION, and only the terse line loses its cue
    // while lines 0 and 2 keep what they earned — is re-pinned on `emphasis`,
    // which is now the field that carries it.
    expect(lines.map((l) => l.emphasis && l.point.slice(l.emphasis.start, l.emphasis.end))).toEqual([
      "Led the migration of our billing",
      null,
      "Cut reconciliation time from three days",
    ]);
    expect(lines[1].emphasis, "the terse line alone loses its cue").toBeNull();
    expect(lines.map((l) => l.cue)).toEqual(["", "", ""]);
  });

  it("pins deriveCues and answerLines together end to end, so the two modules cannot each pass in isolation while failing as a pair", () => {
    const cues = deriveCues(POINTS);
    // deriveCues itself must have preserved the blank's position — asserted
    // here too, not just in answerCues.test.js, because it is the precise
    // shape answerLines below depends on to pair correctly.
    expect(cues).toHaveLength(POINTS.length);
    expect(cues[1]).toBe("");

    const lines = answerLines(cues, POINTS);

    expect(lines).toHaveLength(3);
    expect(lines[0].label).toBe("Situation");
    expect(lines[1].label).toBe("");
    expect(lines[1].point).toBe("I did.");
    expect(lines[2].label).toBe("Result");
    // The end-to-end half of the pairing, on `emphasis` rather than `cue`:
    // after AC-C.1 every deriveCues cue is a contiguous run of its own point
    // and is dropped, so `cue` reads ["", "", ""] under the FIX and under the
    // original blank-dropping DEFECT alike and can no longer witness this.
    // See the sibling case above for the executed side-by-side. The deriveCues
    // half of the property is still pinned directly, at :291-292.
    expect(lines.map((l) => l.cue)).toEqual(["", "", ""]);
    expect(lines.map((l) => l.emphasis && l.point.slice(l.emphasis.start, l.emphasis.end))).toEqual([
      "Led the migration of our billing",
      null,
      "Cut reconciliation time from three days",
    ]);
    expect(lines.map((l) => l.point)).toEqual([
      "Led the migration of our billing platform to a new provider.",
      "I did.",
      "Cut reconciliation time from three days to four hours.",
    ]);
  });
});
