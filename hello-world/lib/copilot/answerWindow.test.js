import { describe, it, expect } from "vitest";
import { isFinalInAnswerWindow, deriveSpeechSpan, acceptedAnswerFinal } from "./answerWindow.js";

describe("isFinalInAnswerWindow — lower bound", () => {
  it("excludes a final whose audio start is before the answer's start offset", () => {
    // Spoken before "Start answering" was pressed — must never be
    // attributed to the answer.
    const included = isFinalInAnswerWindow({ start: 4.9, answerStart: 5, answerEnd: null });
    expect(included).toBe(false);
  });

  it("includes a final whose audio start exactly equals the start offset", () => {
    const included = isFinalInAnswerWindow({ start: 5, answerStart: 5, answerEnd: null });
    expect(included).toBe(true);
  });

  it("includes a final whose audio start is at or after the start offset and before the end offset", () => {
    const included = isFinalInAnswerWindow({ start: 7, answerStart: 5, answerEnd: 10 });
    expect(included).toBe(true);
  });
});

describe("isFinalInAnswerWindow — upper bound", () => {
  it("excludes a final whose audio start is at or after the end offset", () => {
    const atBoundary = isFinalInAnswerWindow({ start: 10, answerStart: 5, answerEnd: 10 });
    expect(atBoundary).toBe(false);
    const pastBoundary = isFinalInAnswerWindow({ start: 12, answerStart: 5, answerEnd: 10 });
    expect(pastBoundary).toBe(false);
  });

  it("includes a final at or after the start offset while the end offset is still null (in progress / draining)", () => {
    // This is what catches the last sentence still in flight after Done:
    // Done sets the end offset only once the drain's own write lands, so a
    // final arriving mid-drain with a very late start must still be
    // included as long as the answer hasn't been given an upper bound yet.
    const included = isFinalInAnswerWindow({ start: 9999, answerStart: 5, answerEnd: null });
    expect(included).toBe(true);
  });
});

describe("isFinalInAnswerWindow — missing timing data", () => {
  it("includes a final with no audio start at all, regardless of the answer's bounds", () => {
    // An unknown position is not evidence the final is out of range, so it
    // is never excluded on that basis alone — even when the answer already
    // has both a start and an end offset that a real position could fall
    // outside of.
    const withOpenEnd = isFinalInAnswerWindow({ start: undefined, answerStart: 5, answerEnd: null });
    expect(withOpenEnd).toBe(true);

    const withClosedEnd = isFinalInAnswerWindow({ start: undefined, answerStart: 5, answerEnd: 10 });
    expect(withClosedEnd).toBe(true);
  });

  it("treats a start of the wrong JS type (a string) the same as undefined — included", () => {
    // typeof "7" !== "number", so this takes the same "cannot be excluded
    // on this basis" path as a genuinely missing start.
    expect(isFinalInAnswerWindow({ start: "7", answerStart: 5, answerEnd: 10 })).toBe(true);
  });

  it("excludes a NaN start — it passes the number type check but fails every comparison", () => {
    // typeof NaN === "number", so NaN is NOT treated as "missing" the way
    // undefined/a string is; it falls through to the real >= / < comparisons,
    // both of which are false for NaN, so the final is excluded rather than
    // included.
    expect(isFinalInAnswerWindow({ start: NaN, answerStart: 5, answerEnd: null })).toBe(false);
    expect(isFinalInAnswerWindow({ start: NaN, answerStart: 5, answerEnd: 10 })).toBe(false);
  });
});

describe("deriveSpeechSpan", () => {
  it("returns nulls, not NaN, for an empty list", () => {
    expect(deriveSpeechSpan([])).toEqual({ firstStart: null, lastEnd: null });
  });

  it("returns nulls for an undefined/missing list", () => {
    expect(deriveSpeechSpan(undefined)).toEqual({ firstStart: null, lastEnd: null });
  });

  it("spans a single final from its start to start + duration", () => {
    const span = deriveSpeechSpan([{ start: 3, duration: 2 }]);
    expect(span).toEqual({ firstStart: 3, lastEnd: 5 });
  });

  it("uses start as the end when duration is missing or non-numeric", () => {
    const span = deriveSpeechSpan([{ start: 3 }]);
    expect(span).toEqual({ firstStart: 3, lastEnd: 3 });
  });

  it("takes firstStart from the FIRST list entry with timing, not the minimum start value (out-of-order arrival)", () => {
    // Second final's start (2) is numerically earlier than the first
    // final's start (5) — firstStart must still be 5, the first one
    // encountered in list order, matching how the inline logic it replaced
    // tracked things incrementally as finals arrived.
    const span = deriveSpeechSpan([
      { start: 5, duration: 1 },
      { start: 2, duration: 1 },
    ]);
    expect(span.firstStart).toBe(5);
  });

  it("tracks lastEnd as the running maximum end across the whole list, not just the last entry's end", () => {
    const span = deriveSpeechSpan([
      { start: 0, duration: 10 }, // end 10, the real max
      { start: 12, duration: 1 }, // end 13
      { start: 14, duration: 0.5 }, // end 14.5 — still less than 10? no, 14.5 > 10
    ]);
    // Recompute explicitly so the assertion is a real, independent check.
    expect(span.lastEnd).toBe(14.5);

    const spanWithEarlierMax = deriveSpeechSpan([
      { start: 0, duration: 20 }, // end 20 — the max, arrives first
      { start: 5, duration: 1 }, // end 6 — smaller, must not overwrite the max
    ]);
    expect(spanWithEarlierMax.lastEnd).toBe(20);
  });

  it("skips finals missing timing data for span purposes without producing NaN", () => {
    const span = deriveSpeechSpan([
      { start: undefined, duration: 5 }, // no usable start, skipped entirely
      { start: 4, duration: 2 }, // first usable final — this drives firstStart
      { text: "no timing at all" },
      { start: 8, duration: 3 },
    ]);
    expect(span.firstStart).toBe(4);
    expect(span.lastEnd).toBe(11);
    expect(Number.isNaN(span.firstStart)).toBe(false);
    expect(Number.isNaN(span.lastEnd)).toBe(false);
  });

  it("returns nulls when every final in the list is missing a numeric start", () => {
    const span = deriveSpeechSpan([{ duration: 3 }, { start: "not a number", duration: 1 }, {}]);
    expect(span).toEqual({ firstStart: null, lastEnd: null });
  });

  it("never produces a negative span even when durations overlap oddly", () => {
    const span = deriveSpeechSpan([
      { start: 10, duration: 1 },
      { start: 2, duration: 1 }, // arrives second but starts earlier — firstStart stays 10 (first-encountered)
    ]);
    // lastEnd (11, from the first final) minus firstStart (10) is still
    // non-negative; the out-of-order second final's smaller end (3) never
    // becomes the reported lastEnd.
    expect(span.lastEnd - span.firstStart).toBeGreaterThanOrEqual(0);
    expect(span.lastEnd).toBe(11);
  });
});

// R-127: acceptedAnswerFinal is the extraction of usePracticeAnswer.js's
// recordTranscriptEvent accept/reject decision — reachable here because
// usePracticeAnswer.js itself is a React hook this repo's node-only vitest
// setup cannot mount (no jsdom anywhere in the suite).
describe("acceptedAnswerFinal", () => {
  const baseArgs = () => ({
    isFinal: true,
    transcript: "hello there",
    start: 6,
    duration: 1.5,
    textAlreadyDelivered: false,
    collecting: true,
    answerStart: 5,
    answerEnd: null,
  });

  it("returns the { text, start, duration } entry for a normal, in-window final while collecting", () => {
    expect(acceptedAnswerFinal(baseArgs())).toEqual({ text: "hello there", start: 6, duration: 1.5 });
  });

  it("returns null for an interim (isFinal: false), regardless of everything else", () => {
    expect(acceptedAnswerFinal({ ...baseArgs(), isFinal: false })).toBeNull();
  });

  it("returns null when nothing is currently being collected", () => {
    expect(acceptedAnswerFinal({ ...baseArgs(), collecting: false })).toBeNull();
  });

  it("returns null when the final falls outside the answer's audio-time window", () => {
    // Spoken before "Start answering" — isFinalInAnswerWindow's own lower-
    // bound behavior, reused here rather than reimplemented.
    expect(acceptedAnswerFinal({ ...baseArgs(), start: 4.9, answerStart: 5 })).toBeNull();
  });

  // The R-127 case: a committed_transcript(_with_timestamps) frame that
  // re-delivers a final's text must never be appended a second time, even
  // though it is otherwise a perfectly normal, in-window, collecting final.
  it("returns null when textAlreadyDelivered is set, even though every other condition would accept it", () => {
    expect(acceptedAnswerFinal({ ...baseArgs(), textAlreadyDelivered: true })).toBeNull();
  });

  it("still accepts a normal final when textAlreadyDelivered is absent (Deepgram, and every non-re-delivered ElevenLabs frame)", () => {
    const { textAlreadyDelivered, ...withoutFlag } = baseArgs();
    void textAlreadyDelivered;
    expect(acceptedAnswerFinal(withoutFlag)).toEqual({ text: "hello there", start: 6, duration: 1.5 });
  });
});
