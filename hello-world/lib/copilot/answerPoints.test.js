import { describe, it, expect } from "vitest";
import { cleanAnswerPoints } from "./answerPoints.js";

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
