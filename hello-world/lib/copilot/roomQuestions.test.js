import { describe, expect, it } from "vitest";
import { shouldTreatAsRoomQuestion } from "./roomQuestions";

// Written from AC-M2 BEFORE the module existed.
//
// Practice mode is a solo drill: the app generates a question, you press Start
// answering, you speak, you press Done. But people also rehearse with a friend
// playing interviewer, and that friend's questions arrive on the same
// microphone. This decides which utterances are "the room asking something"
// rather than "the candidate answering".
//
// Two signals, and the FIRST one carries most of the weight:
//
//   1. Whether an answer is being collected. While it is, everything is the
//      candidate's answer by definition - that is what pressing Start answering
//      means. This signal needs no diarization at all and is why the feature
//      works before anyone has been identified.
//   2. Which speaker tag is the candidate's, learned from the dominant tag of
//      the previous answer. Only usable once an answer has completed.
//
// The deliberate asymmetry with live mode, which must not be "made consistent":
// with NO diarization at all, live mode evaluates everything (missing the
// interviewer's question is the catastrophic direction there), while practice
// mode evaluates nothing. Practice's default population is solo, the drill
// already supplies its own questions, and every detection in a solo session
// would be a false positive that spends a model call and puts a question the
// user never heard on their screen.

describe("shouldTreatAsRoomQuestion while an answer is being collected", () => {
  it("never treats speech during the candidate's own answer as a question", () => {
    // Pressing Start answering IS the statement that what follows is the answer.
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: 1, myTag: 0, collecting: true }),
    ).toBe(false);
  });

  it("holds even for a voice known not to be the candidate's", () => {
    // An interviewer interjecting mid-answer is not asking a new question to be
    // drafted; it would also evict the question the candidate is mid-answer on.
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: 2, myTag: 1, collecting: true }),
    ).toBe(false);
  });
});

describe("shouldTreatAsRoomQuestion between answers", () => {
  it("treats another voice as the room once the candidate's tag is known", () => {
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: 0, myTag: 1, collecting: false }),
    ).toBe(true);
  });

  it("does not treat the candidate's own voice as the room", () => {
    // Thinking out loud between questions must not spend a model call drafting
    // an answer to yourself.
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: 1, myTag: 1, collecting: false }),
    ).toBe(false);
  });

  it("stays silent for a tagged voice before any answer has been completed", () => {
    // myTag is only learnable from a finished answer. Before that a tag says
    // only that SOMEONE spoke, and in practice mode's overwhelmingly solo
    // population that someone is the candidate thinking out loud. This used
    // to return true here, on the argument that the downstream LLM confirm
    // would reject a non-question anyway - but that confirm is not a filter
    // before the transfer, it IS the transfer (the raw utterance is posted to
    // /api/copilot/detect to ask), so the candidate's own words had already
    // left the machine. See app/copilot/practice/useRoomQuestions.ownSpeech.
    // test.js, which pins that on the wire, and the disclosure in
    // practiceRoomQuestionPrivacy.js, which promises egress only for what
    // someone ELSE says.
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: 0, myTag: null, collecting: false }),
    ).toBe(false);
  });

  it("stays silent the same way for an undefined myTag, not just a null one", () => {
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: 0, myTag: undefined, collecting: false }),
    ).toBe(false);
  });

  it("handles tag 0 as a real tag on both sides", () => {
    // Deepgram numbers from 0. A truthiness check makes the first speaker
    // either always the room or never it.
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: 0, myTag: 0, collecting: false }),
    ).toBe(false);
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: 1, myTag: 0, collecting: false }),
    ).toBe(true);
  });
});

describe("shouldTreatAsRoomQuestion without diarization", () => {
  it("stays silent when no speaker tag is available at all", () => {
    // The provider cannot diarize (ElevenLabs Scribe v2 Realtime cannot), or
    // the frame carried no words array. Practice mode's population is
    // overwhelmingly solo, so treating untagged speech as the room would put
    // questions nobody asked on the user's screen. Live mode makes the OPPOSITE
    // call for its own good reasons - see this file's header.
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: undefined, myTag: null, collecting: false }),
    ).toBe(false);
  });

  it("stays silent even once a tag has been learned, if this frame has none", () => {
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: undefined, myTag: 1, collecting: false }),
    ).toBe(false);
  });

  it("stays silent for a null tag, not just an undefined one", () => {
    expect(
      shouldTreatAsRoomQuestion({ speakerTag: null, myTag: 1, collecting: false }),
    ).toBe(false);
  });
});

describe("shouldTreatAsRoomQuestion defaults", () => {
  it("does not throw on an empty argument", () => {
    expect(shouldTreatAsRoomQuestion({})).toBe(false);
  });

  it("does not throw when called with nothing at all", () => {
    expect(shouldTreatAsRoomQuestion()).toBe(false);
  });
});
