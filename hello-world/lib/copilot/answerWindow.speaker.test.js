import { describe, expect, it } from "vitest";
import { acceptedAnswerFinal } from "./answerWindow";

// Written from AC-M2 BEFORE practice mode carried speaker tags. Separate file so
// answerWindow.test.js - which pins the pre-feature accept/reject decision, and
// R-127's dedup behaviour with it - keeps its assertions untouched.
//
// `acceptedAnswerFinal` decides which finals belong to the answer being
// recorded. It must now also carry each accepted final's `speakerTag` through,
// because the decision about WHOSE words those are cannot be made here: it is a
// property of the whole answer, not of one final. A single "Mhm" from the
// interviewer looks identical to a short reply from the candidate until you can
// weigh it against everything else in the window. So this function keeps
// accepting on audio time alone and simply preserves the tag;
// `partitionAnswerFinals` makes the call at the end.
//
// Getting the accept/reject rule itself wrong here would be the R-127 defect
// again - a wrong word count presented confidently, with duration still looking
// right because it is a min/max and survives contamination unchanged.

const base = {
  isFinal: true,
  transcript: "I led the billing migration",
  start: 5,
  duration: 2,
  collecting: true,
  answerStart: 0,
  answerEnd: null,
};

describe("acceptedAnswerFinal speaker passthrough", () => {
  it("carries a speaker tag through onto the accepted entry", () => {
    const accepted = acceptedAnswerFinal({ ...base, speakerTag: 1 });

    expect(accepted).not.toBeNull();
    expect(accepted.speakerTag).toBe(1);
  });

  it("carries tag 0 through, rather than treating it as absent", () => {
    // Deepgram numbers speakers from 0. A truthiness check here silently drops
    // the first speaker's attribution, which is the most common one.
    const accepted = acceptedAnswerFinal({ ...base, speakerTag: 0 });

    expect(accepted.speakerTag).toBe(0);
  });

  it("still accepts a final that carries no tag at all", () => {
    // Every existing practice user is on this path, and a provider that cannot
    // diarize stays on it forever.
    const accepted = acceptedAnswerFinal({ ...base });

    expect(accepted).not.toBeNull();
    expect(accepted.text).toBe("I led the billing migration");
  });

  it("keeps the text, start and duration it already carried", () => {
    const accepted = acceptedAnswerFinal({ ...base, speakerTag: 2 });

    expect(accepted).toMatchObject({
      text: "I led the billing migration",
      start: 5,
      duration: 2,
    });
  });

  it("does not accept an out-of-window final just because it is tagged", () => {
    // A tag says nothing about whether the words belong to THIS answer.
    const rejected = acceptedAnswerFinal({
      ...base,
      speakerTag: 1,
      start: 1,
      answerStart: 10,
    });

    expect(rejected).toBeNull();
  });

  it("does not accept a re-delivered final just because it is tagged", () => {
    // R-127: ElevenLabs re-sends a span's text purely to carry speechFinal.
    // Appending it twice doubles the word count.
    const rejected = acceptedAnswerFinal({
      ...base,
      speakerTag: 1,
      textAlreadyDelivered: true,
    });

    expect(rejected).toBeNull();
  });
});
