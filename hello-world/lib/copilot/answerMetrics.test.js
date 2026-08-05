import { describe, it, expect } from "vitest";
import { computeAnswerMetrics } from "./answerMetrics.js";

describe("computeAnswerMetrics — pace", () => {
  it("drives wordsPerMinute off speechDurationMs, not the wall-clock durationMs", () => {
    // 20 words. Speech span (5s) says "rushed" (240 wpm). Wall clock (120s)
    // would say "slow" (10 wpm) if it were mistakenly used instead — the two
    // durations are chosen to disagree so the assertion can only pass if
    // speechDurationMs is the one actually driving the number.
    const text = [
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
      "thirteen",
      "fourteen",
      "fifteen",
      "sixteen",
      "seventeen",
      "eighteen",
      "nineteen",
      "twenty",
    ].join(" ");
    const result = computeAnswerMetrics({ text, durationMs: 120000, speechDurationMs: 5000 });
    expect(result.wordCount).toBe(20);
    expect(result.speechDurationSec).toBe(5);
    expect(result.durationSec).toBe(120);
    expect(result.wordsPerMinute).toBe(240);
    expect(result.paceLabel).toBe("rushed");
  });

  it("produces 0 wpm — never Infinity or NaN — for zero, negative, or missing durations", () => {
    const text = "one two three";
    expect(computeAnswerMetrics({ text, durationMs: 5000, speechDurationMs: 0 }).wordsPerMinute).toBe(0);
    expect(computeAnswerMetrics({ text, durationMs: 5000, speechDurationMs: -500 }).wordsPerMinute).toBe(0);
    expect(computeAnswerMetrics({ text, durationMs: 5000 }).wordsPerMinute).toBe(0);
    // durationMs itself is subject to the same guard for durationSec.
    expect(computeAnswerMetrics({ text, durationMs: -1000, speechDurationMs: 5000 }).durationSec).toBe(0);
    expect(computeAnswerMetrics({ text, speechDurationMs: 5000 }).durationSec).toBe(0);
  });

  it("returns zeros throughout for empty (or whitespace-only) text", () => {
    const result = computeAnswerMetrics({ text: "", durationMs: 5000, speechDurationMs: 5000 });
    expect(result.wordCount).toBe(0);
    expect(result.wordsPerMinute).toBe(0);
    expect(result.fillerCount).toBe(0);
    expect(result.fillerRate).toBe(0);
    expect(result.fillers).toEqual([]);
    expect(result.discourseMarkerCount).toBe(0);
    expect(result.discourseMarkerRate).toBe(0);
    expect(result.discourseMarkers).toEqual([]);
    expect(result.sentenceCount).toBe(0);
    expect(result.longestSentenceWords).toBe(0);
    expect(result.hasMetric).toBe(false);

    const whitespaceOnly = computeAnswerMetrics({ text: "   ", durationMs: 5000, speechDurationMs: 5000 });
    expect(whitespaceOnly.wordCount).toBe(0);
    expect(whitespaceOnly.sentenceCount).toBe(0);
  });
});

describe("computeAnswerMetrics — fillers vs. discourse markers", () => {
  it("counts fillers and discourse markers separately, with the right rates", () => {
    const text = [
      "Um I like this.",
      "Uh it was actually great.",
      "And right basically literally amazing.",
      "You know that was good.",
      "Kind of sort of I mean maybe.",
      "Er that's it.",
    ].join(" ");
    const result = computeAnswerMetrics({ text, durationMs: 10000, speechDurationMs: 10000 });

    expect(result.wordCount).toBe(29);
    // Fillers: um, uh, you know, kind of, sort of, i mean, er = 7
    expect(result.fillerCount).toBe(7);
    // Discourse markers: like, actually, right, basically, literally = 5
    expect(result.discourseMarkerCount).toBe(5);
    expect(result.fillerRate).toBeCloseTo((7 / 29) * 100, 10);
    expect(result.discourseMarkerRate).toBeCloseTo((5 / 29) * 100, 10);

    const fillerPhrases = result.fillers.map((m) => m.phrase).sort();
    expect(fillerPhrases).toEqual(["er", "i mean", "kind of", "sort of", "um", "uh", "you know"].sort());
    const discoursePhrases = result.discourseMarkers.map((m) => m.phrase).sort();
    expect(discoursePhrases).toEqual(["actually", "basically", "like", "literally", "right"].sort());
  });

  it("never matches inside a larger word or across a hyphen, and handles start/end, case, and punctuation", () => {
    const text = "Um, unlike anything else, the right-hand approach worked well, you know.";
    const result = computeAnswerMetrics({ text, durationMs: 10000, speechDurationMs: 10000 });

    // "unlike" must not count "like"; "right-hand" must not count "right".
    expect(result.discourseMarkerCount).toBe(0);
    expect(result.discourseMarkers).toEqual([]);

    // "Um" at the very start (capitalized, comma-attached) and "you know" at
    // the very end (period-attached) both still count.
    expect(result.fillerCount).toBe(2);
    expect(result.fillers).toEqual([
      { phrase: "um", count: 1 },
      { phrase: "you know", count: 1 },
    ]);
  });
});

describe("computeAnswerMetrics — sentences", () => {
  it("counts one sentence (not zero) for text with no terminal punctuation", () => {
    const text = "this text has no ending punctuation at all";
    const result = computeAnswerMetrics({ text, durationMs: 5000, speechDurationMs: 5000 });
    expect(result.sentenceCount).toBe(1);
    expect(result.longestSentenceWords).toBe(8);
  });

  it("counts sentences and finds the longest one across multi-sentence text", () => {
    const text = "Short one. This sentence is quite a bit longer than the first one. Mid.";
    const result = computeAnswerMetrics({ text, durationMs: 5000, speechDurationMs: 5000 });
    expect(result.sentenceCount).toBe(3);
    expect(result.longestSentenceWords).toBe(11);
  });
});

describe("computeAnswerMetrics — hasMetric and micMuted", () => {
  it("delegates hasMetric to profileMetric", () => {
    const withMetric = computeAnswerMetrics({
      text: "We grew revenue by 40% last quarter.",
      durationMs: 5000,
      speechDurationMs: 5000,
    });
    expect(withMetric.hasMetric).toBe(true);

    const withoutMetric = computeAnswerMetrics({
      text: "Nothing quantifiable here at all.",
      durationMs: 5000,
      speechDurationMs: 5000,
    });
    expect(withoutMetric.hasMetric).toBe(false);
  });

  it("passes micMuted through faithfully, defaulting to false", () => {
    const base = { text: "hello world", durationMs: 5000, speechDurationMs: 5000 };
    expect(computeAnswerMetrics({ ...base, micMuted: true }).micMuted).toBe(true);
    expect(computeAnswerMetrics({ ...base, micMuted: false }).micMuted).toBe(false);
    expect(computeAnswerMetrics(base).micMuted).toBe(false);
  });
});
