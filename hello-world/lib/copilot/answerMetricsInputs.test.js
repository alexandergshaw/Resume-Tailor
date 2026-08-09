import { describe, expect, it } from "vitest";
import { answerMetricsInputs } from "./answerSpeakers";

// Written after the practice-mode metrics protection landed with NO automated
// coverage. Sabotaging it - making every delivery metric read the full collected
// list instead of the candidate's half - turned nothing red across all 150 test
// files, because the logic lived inside a React hook and this repo runs vitest
// with `environment: "node"` and no jsdom, so no hook can be mounted.
//
// That is the same reasoning that already put answerWindow.js and
// answerPoints.js in lib/: logic this fragile has to be reachable from a test.
// The composition itself - partition, then derive text and span from the
// candidate's half - moves here so it can be pinned.
//
// What it protects: practice mode reports word count, words per minute and
// filler rate on a recording made from ONE microphone, and feeds them to a
// critique. Another person's words entering those numbers does not throw and
// does not look broken; it produces a confidently wrong figure. This repo
// shipped that once (R-127): a 98-word answer measured 196 words at 367 wpm and
// the critique told the user to be more concise and slow down.
//
// Note the asymmetry that made R-127 hide for so long, because it applies here
// too: the SPAN is a min/max over timings and barely moves under contamination,
// while the WORD COUNT is a sum. Both are asserted below for that reason.

const f = (text, speakerTag, start, duration) => ({ text, speakerTag, start, duration });

describe("answerMetricsInputs with one voice", () => {
  it("derives text and span from everything when nothing is tagged", () => {
    // Every existing practice user is on this path.
    const collected = [f("I led the migration", undefined, 10, 5), f("and it worked", undefined, 20, 5)];
    const out = answerMetricsInputs(collected);

    expect(out.text).toBe("I led the migration and it worked");
    expect(out.speechDurationMs).toBe(15000);
    expect(out.others).toEqual([]);
  });

  it("matches a whole-list derivation exactly for an untagged answer", () => {
    // The compatibility guarantee, stated as an executable claim rather than an
    // argument: for the non-diarized population the output must be what it was
    // before speaker separation existed.
    const collected = [f("one two", undefined, 1, 1), f("three four five", undefined, 3, 2)];
    const out = answerMetricsInputs(collected);

    expect(out.lines).toEqual(["one two", "three four five"]);
    expect(out.speechDurationMs).toBe(4000);
  });

  it("treats a solo diarized session the same as an untagged one", () => {
    const collected = [f("I owned the pipeline", 0, 10, 5), f("end to end", 0, 20, 5)];
    const out = answerMetricsInputs(collected);

    expect(out.text).toBe("I owned the pipeline end to end");
    expect(out.speechDurationMs).toBe(15000);
    expect(out.others).toEqual([]);
  });
});

describe("answerMetricsInputs with someone else in the room", () => {
  const collected = [
    // The interviewer speaks first and briefly. Including their final would drag
    // the span's start back to 0 AND add words that were never the candidate's.
    f("So tell me about it", 0, 0, 2),
    f("I led the migration off the nightly batch job", 1, 10, 5),
    f("Mhm", 0, 16, 1),
    f("and reconciliation went from three days to under an hour", 1, 20, 5),
  ];

  it("keeps only the candidate's words in the text the critique will grade", () => {
    const out = answerMetricsInputs(collected);

    expect(out.text).toBe(
      "I led the migration off the nightly batch job and reconciliation went from three days to under an hour",
    );
  });

  it("excludes the other voice's words from the word count", () => {
    // The sum. This is the number R-127 got wrong.
    const out = answerMetricsInputs(collected);
    const words = out.text.split(/\s+/).filter(Boolean).length;

    expect(words).toBe(19);
  });

  it("spans only the candidate's own speech", () => {
    // The extremum. Contaminated, this reads 25000 instead of 15000 - and a
    // span that is merely too LONG makes words-per-minute read too SLOW, which
    // is advice the candidate would then act on.
    const out = answerMetricsInputs(collected);

    expect(out.speechDurationMs).toBe(15000);
  });

  it("hands back the other voice's finals intact for question detection", () => {
    const out = answerMetricsInputs(collected);

    expect(out.others.map((e) => e.text)).toEqual(["So tell me about it", "Mhm"]);
  });
});

describe("answerMetricsInputs learns which voice is the candidate's", () => {
  // A completed answer is the strongest identity signal practice mode ever
  // gets: the person talking during an answer window is, by definition, the one
  // answering. Reporting that tag lets live room-question detection exclude the
  // candidate's own speech between questions, instead of drafting answers to
  // them thinking out loud.

  it("reports the tag that dominated the answer", () => {
    const out = answerMetricsInputs([
      f("So tell me about it", 0, 0, 2),
      f("I led the migration off the nightly batch job onto a streaming path", 1, 10, 5),
    ]);

    expect(out.myTag).toBe(1);
  });

  it("reports null when nothing was tagged", () => {
    // No diarization: there is no tag to learn, and claiming one would make the
    // room-question rule exclude an arbitrary voice.
    expect(answerMetricsInputs([f("I led the migration", undefined, 1, 2)]).myTag).toBeNull();
  });

  it("reports null for an empty answer", () => {
    expect(answerMetricsInputs([]).myTag).toBeNull();
  });

  it("reports tag 0 as a real tag rather than as nothing learned", () => {
    // The candidate is often speaker 0. A truthiness check here reports "not
    // learned" forever and the exclusion never starts working.
    const out = answerMetricsInputs([
      f("I owned the ingest pipeline end to end for two years", 0, 10, 5),
      f("Mhm", 1, 16, 1),
    ]);

    expect(out.myTag).toBe(0);
  });
});

describe("answerMetricsInputs edge cases", () => {
  it("reports a zero span when the candidate's finals carry no timing", () => {
    // Matches the pre-existing behaviour: a span that cannot be derived is 0,
    // and computeAnswerMetrics already treats 0 as "not measurable" rather than
    // dividing by it.
    const out = answerMetricsInputs([f("no timing here", 1)]);

    expect(out.speechDurationMs).toBe(0);
  });

  it("never reports a negative span", () => {
    // This case is fussier than it looks, and the first version of it did not
    // exercise the clamp at all: `deriveSpeechSpan` seeds `lastEnd` from the
    // FIRST timed entry's own end before considering any other entry, so
    // `lastEnd >= firstStart` is arithmetically guaranteed unless that first
    // entry's own duration is negative. Out-of-order entries alone can never
    // produce a negative span. Removing the `Math.max(0, ...)` clamp left the
    // whole suite green until this case used a negative duration on the FIRST
    // final, which is the only shape that reaches it.
    // And a SECOND final does not work either, however badly timed the first
    // one is: `lastEnd` is a running maximum, so any later entry drags it back
    // above `firstStart` and the span goes positive again. The only shape that
    // reaches the clamp is a lone final whose own duration is negative.
    const out = answerMetricsInputs([f("bad timing", 1, 20, -5)]);

    expect(out.speechDurationMs).toBe(0);
  });

  it("survives an empty answer", () => {
    const out = answerMetricsInputs([]);

    expect(out.text).toBe("");
    expect(out.lines).toEqual([]);
    expect(out.speechDurationMs).toBe(0);
    expect(out.others).toEqual([]);
  });

  it("survives a missing list rather than throwing at the end of a recording", () => {
    expect(answerMetricsInputs(null).text).toBe("");
    expect(answerMetricsInputs(undefined).speechDurationMs).toBe(0);
  });
});
