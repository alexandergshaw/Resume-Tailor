import { describe, expect, it } from "vitest";
import { partitionAnswerFinals } from "./answerSpeakers";

// Written from AC-M2 BEFORE the module existed.
//
// Practice mode records an answer from ONE microphone. Once that mic is
// diarized, someone else in the room - a mock interviewer, a real one sitting
// across the table - lands in the same transcript stream as the candidate. This
// function decides whose words belong to the candidate's answer.
//
// Getting it wrong is not a visible failure. It is a WRONG NUMBER presented
// confidently. This repo has already shipped exactly that: an STT bug counted
// every utterance twice, so a 98-word answer measured 196 words at 367 wpm and
// the critique told the user to be more concise and slow down. Both were
// artifacts (R-127). Letting another person's words into the answer window
// reproduces that class of defect through a different door - and the numbers
// stay superficially coherent, because duration is a min/max over spans and is
// idempotent under contamination while the word count is a sum.
//
// The compatibility rule that keeps practice mode unchanged for everyone not
// using an in-person setup: when no final carries a speaker tag, EVERYTHING is
// the candidate's, so the existing metrics path sees byte-identical input.

const f = (text, speakerTag, start = 0, duration = 1) => ({
  text,
  speakerTag,
  start,
  duration,
});

describe("partitionAnswerFinals with no diarization", () => {
  it("treats every untagged final as the candidate's own", () => {
    // This is the path every existing practice user is on. It must be
    // indistinguishable from before the feature existed.
    const finals = [f("I led the billing migration"), f("and we cut reconciliation time")];
    const { mine, others } = partitionAnswerFinals(finals);

    expect(mine).toEqual(finals);
    expect(others).toEqual([]);
  });

  it("returns empty halves for an empty answer", () => {
    const { mine, others } = partitionAnswerFinals([]);

    expect(mine).toEqual([]);
    expect(others).toEqual([]);
  });

  it("tolerates a null or missing list rather than throwing mid-answer", () => {
    expect(partitionAnswerFinals(null).mine).toEqual([]);
    expect(partitionAnswerFinals(undefined).others).toEqual([]);
  });
});

describe("partitionAnswerFinals with one voice", () => {
  it("keeps a single tagged voice as the candidate's own", () => {
    const finals = [f("I owned the ingest pipeline", 0), f("end to end for two years", 0)];

    expect(partitionAnswerFinals(finals).mine).toEqual(finals);
    expect(partitionAnswerFinals(finals).others).toEqual([]);
  });
});

describe("partitionAnswerFinals with two voices", () => {
  it("gives the answer to whoever actually did the talking", () => {
    // During an answer window the person answering is the candidate. That is a
    // far stronger signal than anything live mode gets.
    const mineFinal = f(
      "I led the migration off the nightly batch job onto a streaming path and reconciliation went from three days to under an hour",
      1,
    );
    const theirs = f("Mhm", 0);
    const { mine, others } = partitionAnswerFinals([theirs, mineFinal]);

    expect(mine).toEqual([mineFinal]);
    expect(others).toEqual([theirs]);
  });

  it("measures dominance by WORDS, not by how many times each voice spoke", () => {
    // An interviewer interjecting three short times must not outrank one long
    // answer. Counting finals instead of words gets this backwards.
    const answer = f(
      "We ran both paths side by side and compared them for a full month before we cut over and only then deleted the old job",
      1,
    );
    const interjections = [f("Right", 0), f("Mhm", 0), f("Got it", 0)];
    const { mine } = partitionAnswerFinals([...interjections, answer]);

    expect(mine).toEqual([answer]);
  });

  it("keeps every one of the candidate's finals, not just the longest", () => {
    const a = f("I spent two years on the billing platform", 1);
    const b = f("and owned the ingest pipeline end to end", 1);
    const theirs = f("Okay", 0);
    const { mine, others } = partitionAnswerFinals([a, theirs, b]);

    expect(mine).toEqual([a, b]);
    expect(others).toEqual([theirs]);
  });

  it("resolves a tie to whoever started the answer", () => {
    // Deterministic, and the right guess: the candidate is the one who began
    // speaking when they pressed Start answering.
    const first = f("one two three", 1);
    const second = f("four five six", 0);
    const { mine } = partitionAnswerFinals([first, second]);

    expect(mine).toEqual([first]);
  });
});

describe("partitionAnswerFinals with three or more voices", () => {
  it("treats every voice that is not the candidate as someone else", () => {
    const answer = f(
      "The hardest part was the dual write window because we could not take any downtime at all",
      2,
    );
    const panelist = f("Why not?", 0);
    const other = f("Interesting", 1);
    const { mine, others } = partitionAnswerFinals([panelist, answer, other]);

    expect(mine).toEqual([answer]);
    expect(others).toEqual([panelist, other]);
  });
});

describe("partitionAnswerFinals mixed tagging", () => {
  it("counts an untagged final as the candidate's own", () => {
    // A final the provider did not attribute cannot be blamed on anyone else.
    // Dropping it would silently UNDERSTATE the candidate's word count, and
    // this module's whole purpose is that the numbers it feeds are honest.
    // It also keeps the no-diarization path above a special case of this one
    // rather than a separate branch that could drift.
    const tagged = f("I owned the ingest pipeline end to end for about two years", 1);
    const untagged = f("and before that I was on the payments team");
    const theirs = f("Got it", 0);
    const { mine, others } = partitionAnswerFinals([tagged, untagged, theirs]);

    expect(mine).toEqual([tagged, untagged]);
    expect(others).toEqual([theirs]);
  });

  it("preserves the original order within each half", () => {
    // The span derivation downstream takes the FIRST timed entry in list order,
    // not the minimum, so reordering here would silently move an answer's start.
    const a = f("first", 1, 1);
    const b = f("second", 1, 2);
    const c = f("third", 1, 3);
    const { mine } = partitionAnswerFinals([a, f("x", 0), b, f("y", 0), c]);

    expect(mine.map((e) => e.text)).toEqual(["first", "second", "third"]);
  });

  it("does not mutate the list it was given", () => {
    const finals = [f("mine", 1), f("theirs", 0)];
    const copy = [...finals];
    partitionAnswerFinals(finals);

    expect(finals).toEqual(copy);
  });
});
