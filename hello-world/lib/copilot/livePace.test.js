import { describe, it, expect } from "vitest";
import {
  appendSpeechSample,
  trimToWindow,
  computeLivePace,
  DEFAULT_WINDOW_SEC,
  MIN_WORDS_FOR_MEASUREMENT,
} from "./livePace.js";
import { SLOW_WPM_MAX, RUSHED_WPM_MIN } from "./answerMetrics.js";

// 8 words — exactly MIN_WORDS_FOR_MEASUREMENT — so a single frame of this
// text is (just) enough on its own to produce a measurement.
const EIGHT_WORDS = "one two three four five six seven eight";

describe("appendSpeechSample", () => {
  it("never mutates the input array and returns a new one", () => {
    const original = [{ words: 3, start: 0, end: 1 }];
    const frozenCopy = [...original];
    const result = appendSpeechSample(original, { text: "hi there", start: 1, duration: 1 });

    expect(original).toEqual(frozenCopy);
    expect(result).not.toBe(original);
    expect(result.length).toBe(2);
  });

  it("drops a frame with no timing at all (start and duration both undefined)", () => {
    const result = appendSpeechSample([], { text: EIGHT_WORDS });
    expect(result).toEqual([]);
  });

  it("drops a frame missing only start", () => {
    const result = appendSpeechSample([], { text: EIGHT_WORDS, duration: 2 });
    expect(result).toEqual([]);
  });

  it("drops a frame missing only duration", () => {
    const result = appendSpeechSample([], { text: EIGHT_WORDS, start: 2 });
    expect(result).toEqual([]);
  });

  it("does NOT treat start: 0 as missing — a fabricated-zero regression guard", () => {
    // start is a legitimate, falsy-in-JS value for the very first frame of
    // a stream. A `if (!start)` style check would wrongly drop this.
    const result = appendSpeechSample([], { text: EIGHT_WORDS, start: 0, duration: 2 });
    expect(result).toEqual([{ words: 8, start: 0, end: 2, fillers: 0 }]);
  });

  it("drops a frame with a negative start or negative duration", () => {
    expect(appendSpeechSample([], { text: EIGHT_WORDS, start: -1, duration: 2 })).toEqual([]);
    expect(appendSpeechSample([], { text: EIGHT_WORDS, start: 1, duration: -2 })).toEqual([]);
  });

  it("drops a frame with non-numeric timing (NaN, string, etc.)", () => {
    expect(appendSpeechSample([], { text: EIGHT_WORDS, start: NaN, duration: 2 })).toEqual([]);
    expect(appendSpeechSample([], { text: EIGHT_WORDS, start: "1", duration: 2 })).toEqual([]);
    expect(appendSpeechSample([], { text: EIGHT_WORDS, start: 1, duration: "2" })).toEqual([]);
  });

  it("drops a frame whose text has no words even with usable timing", () => {
    expect(appendSpeechSample([], { text: "", start: 0, duration: 2 })).toEqual([]);
    expect(appendSpeechSample([], { text: "   ", start: 0, duration: 2 })).toEqual([]);
    expect(appendSpeechSample([], { text: undefined, start: 0, duration: 2 })).toEqual([]);
  });

  it("counts words the same way answerMetrics.js does — whitespace split, filtering empties", () => {
    const result = appendSpeechSample([], { text: "  hello   world  ", start: 0, duration: 1 });
    expect(result).toEqual([{ words: 2, start: 0, end: 1, fillers: 0 }]);

    const tabsAndNewlines = appendSpeechSample([], { text: "one\ttwo\nthree", start: 0, duration: 1 });
    expect(tabsAndNewlines[0].words).toBe(3);
  });

  it("appends a usable frame with words = countWords(text), end = start + duration", () => {
    const result = appendSpeechSample([], { text: "hello world", start: 4, duration: 2.5 });
    expect(result).toEqual([{ words: 2, start: 4, end: 6.5, fillers: 0 }]);
  });

  it("treats non-array `samples` input as an empty starting list rather than throwing", () => {
    const result = appendSpeechSample(null, { text: "hello world", start: 0, duration: 1 });
    expect(result).toEqual([{ words: 2, start: 0, end: 1, fillers: 0 }]);
  });

  it("builds up a mixed list across usable and unusable frames, in append order", () => {
    let samples = [];
    samples = appendSpeechSample(samples, { text: "hello world", start: 0, duration: 2 }); // usable
    samples = appendSpeechSample(samples, { text: "no timing here at all" }); // dropped
    samples = appendSpeechSample(samples, { text: "more words said now", start: 2, duration: 3 }); // usable
    expect(samples).toEqual([
      { words: 2, start: 0, end: 2, fillers: 0 },
      { words: 4, start: 2, end: 5, fillers: 0 },
    ]);
  });
});

describe("trimToWindow", () => {
  it("returns [] for empty input", () => {
    expect(trimToWindow([], 30)).toEqual([]);
  });

  it("returns [] for non-array input", () => {
    expect(trimToWindow(null, 30)).toEqual([]);
    expect(trimToWindow(undefined, 30)).toEqual([]);
  });

  it("keeps only samples whose end falls within windowSec of the most recent sample's end", () => {
    const samples = [
      { words: 5, start: 0, end: 5 }, // ends 40s before the latest — outside a 30s window
      { words: 5, start: 20, end: 25 }, // ends 20s before the latest — inside
      { words: 5, start: 40, end: 45 }, // the latest sample itself — always kept
    ];
    const trimmed = trimToWindow(samples, 30);
    expect(trimmed).toEqual([
      { words: 5, start: 20, end: 25 },
      { words: 5, start: 40, end: 45 },
    ]);
  });

  it("always keeps at least the most recent sample, even with a very small window", () => {
    const samples = [
      { words: 5, start: 0, end: 5 },
      { words: 5, start: 40, end: 45 },
    ];
    expect(trimToWindow(samples, 0.001)).toEqual([{ words: 5, start: 40, end: 45 }]);
  });

  it("falls back to DEFAULT_WINDOW_SEC for a missing or invalid windowSec", () => {
    const samples = [
      { words: 5, start: 0, end: 1 },
      { words: 5, start: DEFAULT_WINDOW_SEC + 10, end: DEFAULT_WINDOW_SEC + 11 },
    ];
    const withDefault = trimToWindow(samples, undefined);
    const withExplicitDefault = trimToWindow(samples, DEFAULT_WINDOW_SEC);
    expect(withDefault).toEqual(withExplicitDefault);

    expect(trimToWindow(samples, 0)).toEqual(withDefault);
    expect(trimToWindow(samples, -5)).toEqual(withDefault);
    expect(trimToWindow(samples, NaN)).toEqual(withDefault);
  });

  it("never mutates the input array and returns a new one", () => {
    const samples = [
      { words: 5, start: 0, end: 5 },
      { words: 5, start: 40, end: 45 },
    ];
    const copy = samples.map((s) => ({ ...s }));
    const result = trimToWindow(samples, 30);
    expect(samples).toEqual(copy);
    expect(result).not.toBe(samples);
  });
});

describe("computeLivePace — unmeasured cases never fabricate 0 or a label", () => {
  it("reports not-measured for empty input (no speech yet)", () => {
    expect(computeLivePace([], { windowSec: 30 })).toEqual({
      wordsPerMinute: null,
      paceLabel: null,
      measured: false,
    });
  });

  it("reports not-measured when every appended frame had no usable timing", () => {
    let samples = [];
    samples = appendSpeechSample(samples, { text: "hello there this has no timing at all" });
    samples = appendSpeechSample(samples, { text: "neither does this one right here" });
    expect(computeLivePace(samples, { windowSec: 30 })).toEqual({
      wordsPerMinute: null,
      paceLabel: null,
      measured: false,
    });
  });

  it("reports not-measured when the window has fewer than MIN_WORDS_FOR_MEASUREMENT words", () => {
    let samples = [];
    // 3 words, well under the 8-word floor.
    samples = appendSpeechSample(samples, { text: "hi there friend", start: 0, duration: 2 });
    const result = computeLivePace(samples, { windowSec: 30 });
    expect(result.measured).toBe(false);
    expect(result.wordsPerMinute).toBeNull();
    expect(result.paceLabel).toBeNull();
  });

  it("reports not-measured for a single frame whose start equals its end (zero span)", () => {
    // Enough words, but zero duration — would be a divide-by-zero if not guarded.
    const samples = appendSpeechSample([], { text: EIGHT_WORDS, start: 5, duration: 0 });
    const result = computeLivePace(samples, { windowSec: 30 });
    expect(result.measured).toBe(false);
    expect(result.wordsPerMinute).toBeNull();
    expect(result.paceLabel).toBeNull();
  });
});

describe("computeLivePace — measured cases", () => {
  it("computes wpm from a single usable frame that alone clears the word floor", () => {
    // 8 words in 4 seconds -> 120 wpm.
    const samples = appendSpeechSample([], { text: EIGHT_WORDS, start: 10, duration: 4 });
    const result = computeLivePace(samples, { windowSec: 30 });
    expect(result.measured).toBe(true);
    expect(result.wordsPerMinute).toBe(120);
    expect(result.paceLabel).toBe("conversational");
  });

  it("sums words and spans across multiple frames within the window", () => {
    let samples = [];
    // 4 words over [0,2], then 6 words over [2,4] -> 10 words over a 4s span -> 150 wpm.
    samples = appendSpeechSample(samples, { text: "one two three four", start: 0, duration: 2 });
    samples = appendSpeechSample(samples, { text: "five six seven eight nine ten", start: 2, duration: 2 });
    const result = computeLivePace(samples, { windowSec: 30 });
    expect(result.measured).toBe(true);
    expect(result.wordsPerMinute).toBe(150);
    expect(result.paceLabel).toBe("conversational");
  });

  it("excludes frames that fall outside the rolling window from the computation", () => {
    let samples = [];
    // An old, fast burst well outside the window...
    samples = appendSpeechSample(samples, { text: "one two three four five six seven eight nine ten", start: 0, duration: 1 });
    // ...then a gap, then a recent, slower stretch inside the window.
    samples = appendSpeechSample(samples, { text: "one two three four five six seven eight", start: 100, duration: 8 });
    // windowSec: 30 keeps only the second frame (its own end anchors "now").
    const result = computeLivePace(samples, { windowSec: 30 });
    expect(result.measured).toBe(true);
    // 8 words / 8s * 60 = 60 wpm — if the old fast burst had leaked in, this
    // would come out much higher.
    expect(result.wordsPerMinute).toBe(60);
    expect(result.paceLabel).toBe("slow");
  });

  it("uses the same SLOW_WPM_MAX / RUSHED_WPM_MIN boundaries as answerMetrics.js, including the non-inclusive edges", () => {
    // Exactly at SLOW_WPM_MAX -> conversational, not slow (matches paceLabelFor's `<`).
    const atSlowBoundary = appendSpeechSample([], {
      text: EIGHT_WORDS,
      start: 0,
      duration: (8 / SLOW_WPM_MAX) * 60,
    });
    expect(computeLivePace(atSlowBoundary, { windowSec: 30 }).paceLabel).toBe("conversational");

    // Exactly at RUSHED_WPM_MIN -> conversational, not rushed (matches paceLabelFor's `>`).
    const atRushedBoundary = appendSpeechSample([], {
      text: EIGHT_WORDS,
      start: 0,
      duration: (8 / RUSHED_WPM_MIN) * 60,
    });
    expect(computeLivePace(atRushedBoundary, { windowSec: 30 }).paceLabel).toBe("conversational");

    // Comfortably below SLOW_WPM_MAX -> slow.
    const slow = appendSpeechSample([], { text: EIGHT_WORDS, start: 0, duration: 30 });
    expect(computeLivePace(slow, { windowSec: 30 }).paceLabel).toBe("slow");

    // Comfortably above RUSHED_WPM_MIN -> rushed.
    const rushed = appendSpeechSample([], { text: EIGHT_WORDS, start: 0, duration: 1 });
    expect(computeLivePace(rushed, { windowSec: 30 }).paceLabel).toBe("rushed");
  });

  it("defaults windowSec to DEFAULT_WINDOW_SEC when not supplied", () => {
    const samples = appendSpeechSample([], { text: EIGHT_WORDS, start: 10, duration: 4 });
    const withDefault = computeLivePace(samples);
    const withExplicit = computeLivePace(samples, { windowSec: DEFAULT_WINDOW_SEC });
    expect(withDefault).toEqual(withExplicit);
  });

  it("never mutates the samples array it is given", () => {
    const samples = appendSpeechSample([], { text: EIGHT_WORDS, start: 10, duration: 4 });
    const copy = samples.map((s) => ({ ...s }));
    computeLivePace(samples, { windowSec: 30 });
    expect(samples).toEqual(copy);
  });
});
