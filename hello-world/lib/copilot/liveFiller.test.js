// AC-N1: a rolling "how much verbal filler is in what you're saying right now"
// reading, sitting beside live mode's talking-speed reading.
//
// It is built on the SAME sample list `computeLivePace` already windows, for a
// reason worth stating before the assertions: the two readings are rendered
// side by side, so if they described different spans of speech a user comparing
// them would be comparing two different moments. One list, one window, two
// derivations.
//
// It reuses answerMetrics.js's FILLER_PHRASES and its phrase matcher rather
// than restating either — the same rule livePace.js already follows for
// `paceLabelFor` and `countWords`. Two copies of "what counts as a filler"
// would drift, and then the live reading and the post-answer review would
// disagree about the same recorded sentence. The phrase matcher in particular
// is not re-implementable by eye: it carries a lookaround (see phraseRegex)
// that stops "um" firing inside "summary" and "right" inside "right-hand",
// which a plain `\b` boundary does not.
//
// Two deliberate differences from the pace reading, both asserted below:
//
//   1. A filler RATE needs words, not time. `computeLivePace` refuses to
//      report when the measured span is zero (it would divide by zero); a
//      filler rate over the same window is still perfectly well defined, so
//      the two can legitimately disagree about whether they have a reading.
//      Each says what it actually knows.
//   2. Zero fillers is a MEASUREMENT, and a good one. Only too little speech
//      is unmeasured. This is the same AC-I2.14 rule the pace reading and the
//      body-language signals follow — an unmeasured signal is reported as
//      unmeasured, never as a real but unflattering zero — applied to the one
//      metric where zero is the target rather than the failure.

import { describe, it, expect } from "vitest";

import { FILLER_RATE_CLEAN_MAX, FILLER_RATE_HEAVY_MIN, fillerLabelFor } from "./answerMetrics.js";
import { MIN_WORDS_FOR_MEASUREMENT, appendSpeechSample, computeLiveFillers } from "./livePace.js";

// Builds a sample list from [text, start, duration] triples, through the real
// append path — never by hand-constructing the internal sample shape, so these
// cases keep testing the contract rather than the current field names.
function samplesFrom(frames) {
  return frames.reduce((acc, [text, start, duration]) => appendSpeechSample(acc, { text, start, duration }), []);
}

// Thirteen words, two unambiguous fillers ("um" and the two-word "you know").
// Counted the way countWords counts — whitespace-delimited, so "you know"
// contributes ONE filler but TWO words — which is why the expected rate below
// is derived from those two numbers rather than written as a literal.
const HEAVY_WORDS = 13;
const HEAVY_FILLERS = 2;
const HEAVY = samplesFrom([["um so the thing is you know we shipped it last quarter honestly", 0, 6]]);

describe("computeLiveFillers", () => {
  it("reports nothing rather than zero when there is too little speech to measure", () => {
    const unmeasured = { fillerCount: null, fillerRate: null, fillerLabel: null, measured: false };
    expect(computeLiveFillers([], { windowSec: 30 })).toEqual(unmeasured);
    expect(computeLiveFillers(undefined, { windowSec: 30 })).toEqual(unmeasured);
    // Under MIN_WORDS_FOR_MEASUREMENT words in the window: a rate extrapolated
    // from three words swings wildly on one "um", exactly the reasoning the
    // pace reading already applies.
    const thin = samplesFrom([["um so yeah", 0, 2]]);
    expect(computeLiveFillers(thin, { windowSec: 30 }).measured).toBe(false);
    expect(computeLiveFillers(thin, { windowSec: 30 }).fillerCount).toBeNull();
  });

  it("treats a clean stretch as a real measurement, not an absent one", () => {
    const clean = samplesFrom([["I led the migration and we finished it two weeks early", 0, 5]]);
    const result = computeLiveFillers(clean, { windowSec: 30 });
    expect(result.measured).toBe(true);
    expect(result.fillerCount).toBe(0);
    expect(result.fillerRate).toBe(0);
    expect(result.fillerLabel).toBe("clean");
  });

  it("counts fillers across the window and reports them as a rate per hundred words", () => {
    const result = computeLiveFillers(HEAVY, { windowSec: 30 });
    expect(result.measured).toBe(true);
    expect(result.fillerCount).toBe(HEAVY_FILLERS);
    expect(result.fillerRate).toBeCloseTo((HEAVY_FILLERS / HEAVY_WORDS) * 100, 5);
    expect(result.fillerLabel).toBe("heavy");
  });

  it("only counts speech inside the rolling window", () => {
    // The first frame is far outside a 30s window measured back from the last
    // frame's end, so its three fillers must not reach the reading.
    const samples = samplesFrom([
      ["um uh er the old part of the answer nobody is saying now", 0, 10],
      ["I owned the rollout and it landed on the date we committed to", 300, 6],
    ]);
    const windowed = computeLiveFillers(samples, { windowSec: 30 });
    expect(windowed.measured).toBe(true);
    expect(windowed.fillerCount).toBe(0);

    // With a window wide enough to reach back, the same samples do include it —
    // otherwise this case would pass against an implementation that never
    // counts anything.
    expect(computeLiveFillers(samples, { windowSec: 1000 }).fillerCount).toBe(3);
  });

  // The pace reading refuses a zero-length span because it would divide by
  // zero. A filler rate divides by WORDS, so the same window is measurable.
  // Pinned because the obvious implementation — copy computeLivePace and swap
  // the numerator — would import a guard it does not need and report nothing
  // for a real reading.
  it("still reports when the speech span has no measurable length", () => {
    const instant = samplesFrom([["um so the whole point is you know it actually shipped fine", 4, 0]]);
    const result = computeLiveFillers(instant, { windowSec: 30 });
    expect(result.measured).toBe(true);
    expect(result.fillerCount).toBeGreaterThan(0);
  });

  it("drops frames the provider gave no usable timing for, exactly as the pace reading does", () => {
    const withoutTiming = appendSpeechSample([], { text: "um um um um um um um um um um" });
    expect(withoutTiming).toEqual([]);
    expect(computeLiveFillers(withoutTiming, { windowSec: 30 }).measured).toBe(false);
  });

  it("never mutates the samples it is given", () => {
    const samples = samplesFrom([["um so this is the part where the answer actually starts", 0, 5]]);
    const snapshot = JSON.parse(JSON.stringify(samples));
    computeLiveFillers(samples, { windowSec: 30 });
    expect(samples).toEqual(snapshot);
  });

  it("is deterministic", () => {
    expect(computeLiveFillers(HEAVY, { windowSec: 30 })).toEqual(computeLiveFillers(HEAVY, { windowSec: 30 }));
  });

  // The per-frame filler count has to be an ORDINARY field on the sample.
  // Hiding it — as a non-enumerable property, say — makes it vanish through
  // any clone, and this codebase's recurring failure mode is exactly that: a
  // signal that silently becomes zero while still looking like a real reading
  // (see livePace.js's own header on why a missing duration is dropped rather
  // than coerced to 0). A round-trip through JSON is the cheapest way to pin
  // it, and it is not hypothetical — samples are held in React state and a
  // future change that maps or rebuilds them would drop a hidden field with
  // no test and no symptom beyond an undercount.
  it("carries the per-frame filler count as a real, visible field", () => {
    const [sample] = HEAVY;
    expect(Object.keys(sample)).toContain("fillers");
    const cloned = JSON.parse(JSON.stringify(HEAVY));
    expect(computeLiveFillers(cloned, { windowSec: 30 })).toEqual(computeLiveFillers(HEAVY, { windowSec: 30 }));
  });
});

describe("computeLiveFillers — what counts as a filler", () => {
  // The whole reason this reuses answerMetrics rather than matching words
  // itself. A hand-rolled `\b` boundary matches "um" inside "summary" and
  // "right" inside "right-hand"; the shared matcher's lookaround does not.
  it("never fires inside a longer word or across a hyphen", () => {
    const samples = samplesFrom([["the summary said our right-hand column numbers were uhh not final yet", 0, 6]]);
    const result = computeLiveFillers(samples, { windowSec: 30 });
    expect(result.measured).toBe(true);
    expect(result.fillerCount).toBe(0);
  });

  // BUG-7's distinction, which this must not quietly undo: "like", "actually",
  // "basically" and the rest are ambiguous discourse markers with ordinary
  // uses, counted and reported SEPARATELY from unambiguous hesitation markers.
  // A live indicator that folded them in would tell a candidate they are
  // filling when they said "I like Python" and "it actually shipped".
  it("counts hesitation markers only, never the ambiguous discourse markers", () => {
    const samples = samplesFrom([["I like Python and it actually shipped so basically the right call literally", 0, 6]]);
    const result = computeLiveFillers(samples, { windowSec: 30 });
    expect(result.measured).toBe(true);
    expect(result.fillerCount).toBe(0);
  });

  it("counts multi-word hesitation phrases, not just single words", () => {
    const samples = samplesFrom([["it was sort of the kind of thing you know that needed one owner", 0, 6]]);
    expect(computeLiveFillers(samples, { windowSec: 30 }).fillerCount).toBe(3);
  });
});

describe("fillerLabelFor", () => {
  it("bands a rate into clean, noticeable and heavy", () => {
    expect(fillerLabelFor(0)).toBe("clean");
    expect(fillerLabelFor(FILLER_RATE_CLEAN_MAX)).toBe("clean");
    expect(fillerLabelFor(FILLER_RATE_CLEAN_MAX + 0.1)).toBe("noticeable");
    expect(fillerLabelFor(FILLER_RATE_HEAVY_MIN - 0.1)).toBe("noticeable");
    expect(fillerLabelFor(FILLER_RATE_HEAVY_MIN)).toBe("heavy");
    expect(fillerLabelFor(100)).toBe("heavy");
  });

  // The bands have to leave a real middle: a two-band split would tell a
  // candidate mid-interview that an ordinary delivery is "heavy".
  it("leaves a middle band wide enough to mean something", () => {
    expect(FILLER_RATE_HEAVY_MIN).toBeGreaterThan(FILLER_RATE_CLEAN_MAX + 1);
  });

  it("is the single source of the mapping, shared with the live reading", () => {
    const samples = samplesFrom([["um so the point is you know it shipped and the numbers held up", 0, 6]]);
    const result = computeLiveFillers(samples, { windowSec: 30 });
    expect(result.fillerLabel).toBe(fillerLabelFor(result.fillerRate));
  });
});

describe("the pace and filler readings share one sample list", () => {
  it("measures both from the same appended frames, with no second append path", () => {
    // If a second list were needed, this list — built only through
    // appendSpeechSample — could not produce a filler reading at all.
    const samples = samplesFrom([["um I owned the rollout you know and it landed on the committed date", 0, 6]]);
    expect(samples.length).toBe(1);
    expect(computeLiveFillers(samples, { windowSec: 30 }).measured).toBe(true);
  });

  it("uses the same too-little-speech floor as the pace reading", () => {
    expect(MIN_WORDS_FOR_MEASUREMENT).toBeGreaterThan(0);
    const words = Array.from({ length: MIN_WORDS_FOR_MEASUREMENT - 1 }, (_, i) => `word${i}`).join(" ");
    expect(computeLiveFillers(samplesFrom([[words, 0, 5]]), { windowSec: 30 }).measured).toBe(false);
    const enough = `${words} andonemore`;
    expect(computeLiveFillers(samplesFrom([[enough, 0, 5]]), { windowSec: 30 }).measured).toBe(true);
  });
});
