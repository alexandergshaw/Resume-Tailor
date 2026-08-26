import { describe, expect, it, vi } from "vitest";
import { ElevenLabsStream } from "./elevenlabs";

// AC-V1. The COMMIT PAIR, read off a real session the user recorded on
// 2026-08-25 (interview-log-live-2026-08-25-1644.json). Every single one of
// that session's five utterances arrived TWICE, 66-114ms apart, both frames
// carrying speechFinal:true — so both came from this module's
// committed_transcript / committed_transcript_with_timestamps branches. The
// first of the pair carried no `start`/`duration` at all; the second carried
// both:
//
//   {"text":"Talk to me about ...","isFinal":true,"speechFinal":true,"t":9799}
//   {"text":"Talk to me about ...","isFinal":true,"speechFinal":true,"start":3.639,"duration":3.62,"t":9885}
//
// ElevenLabs' published AsyncAPI spec carries NO id, sequence number or
// utterance marker on any transcript message, so the two members of a commit
// can only be correlated by their text. That is not a shortcut taken here for
// convenience; it is the only correlation the protocol offers.
//
// R-127's existing rule requires BOTH sides to carry a numeric span before it
// will call a frame a re-delivery, so the untimed member of the pair defeats
// it every time. What that cost, in that session: six question.added events
// for three spoken questions, six drafted answers, and two concurrent model
// calls per question contending with each other (one draft took 9.2s while
// its own twin took 4.0s). Every downstream dedupe is defeated by
// construction — useLiveSession.js's acceptQuestion deliberately falls
// THROUGH its back-to-back guard when the prior card is still "loading"
// (AC-P4.4), and the twin always arrives ~70ms later, always while loading.
//
// These cases live in their own file rather than in elevenlabs.test.js so the
// existing R-127 suite stays exactly as it is: none of its cases are wrong,
// they simply never covered a pair whose members disagree about whether they
// have timing.

function makeStream(overrides = {}) {
  return new ElevenLabsStream({ speaker: "them", ...overrides });
}

// `words` is omitted entirely unless passed, mirroring the real protocol
// where only the *_with_timestamps message types carry it.
function transcriptMessage(messageType, { text, words } = {}) {
  const msg = { message_type: messageType, text };
  if (words !== undefined) msg.words = words;
  return msg;
}

function wordsSpanning(start, end, text = "word") {
  return [{ type: "word", start, end, text }];
}

function framesFrom(onTranscript) {
  return onTranscript.mock.calls.map((call) => call[0]);
}

describe("ElevenLabsStream commit pair (AC-V1)", () => {
  it("flags the timestamped member of a commit pair whose untimed member was already delivered", () => {
    // AC-V1.1, replaying the exact shape of the user's captured session:
    // committed_transcript with no words, then
    // committed_transcript_with_timestamps carrying the same text.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });
    const text = "Talk to me about what appealed to you about Purple Wave and why you applied.";

    stream._handleMessage(transcriptMessage("committed_transcript", { text }));
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text,
        words: wordsSpanning(3.639, 7.259),
      }),
    );

    const frames = framesFrom(onTranscript);
    expect(frames).toHaveLength(2);

    // The first member is delivered normally — a text-accumulating consumer
    // must append it, exactly as today.
    expect(frames[0].transcript).toBe(text);
    expect(frames[0].speechFinal).toBe(true);
    expect("textAlreadyDelivered" in frames[0]).toBe(false);

    // The second member is the SAME commit. It is still delivered (consumers
    // need its speechFinal and its timing), but its text must not be
    // accumulated a second time.
    expect(frames[1].transcript).toBe(text);
    expect(frames[1].speechFinal).toBe(true);
    expect(frames[1].textAlreadyDelivered).toBe(true);
    expect(frames[1].start).toBeCloseTo(3.639, 5);
  });

  it("flags the untimed member when it is the one that arrives second", () => {
    // AC-V1.1 again with the pair in the other order. The spec does not
    // promise an order, and a rule that only works one way round would fix
    // the captured session and leave the mirror image broken.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });
    const text = "What do you know about Purple Wave?";

    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text,
        words: wordsSpanning(71.807, 73.167),
      }),
    );
    stream._handleMessage(transcriptMessage("committed_transcript", { text }));

    const frames = framesFrom(onTranscript);
    expect(frames).toHaveLength(2);
    expect("textAlreadyDelivered" in frames[0]).toBe(false);
    expect(frames[1].textAlreadyDelivered).toBe(true);
  });

  it("still treats an exactly equal numeric span as a re-delivery", () => {
    // AC-V1.2: today's rule is not replaced, only widened. This is the case
    // elevenlabs.test.js's own R-127 suite already covers, asserted here too
    // so a change that satisfies V1.1 by DELETING the span comparison fails
    // this file rather than passing it.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });
    const words = wordsSpanning(1, 1.3, "hello");

    stream._handleMessage(
      transcriptMessage("final_transcript_with_timestamps", { text: "hello", words }),
    );
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", { text: "hello", words }),
    );

    const frames = framesFrom(onTranscript);
    expect(frames[1].textAlreadyDelivered).toBe(true);
  });

  it("delivers a genuinely repeated sentence twice when the two spans differ", () => {
    // AC-V1.3. The negative control for the widened rule: two real
    // utterances with identical text, distinguishable only by their spans.
    // Neither may be swallowed.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "Okay.",
        words: wordsSpanning(1, 1.3, "okay"),
      }),
    );
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "Okay.",
        words: wordsSpanning(9, 9.3, "okay"),
      }),
    );

    const frames = framesFrom(onTranscript);
    expect(frames).toHaveLength(2);
    expect("textAlreadyDelivered" in frames[0]).toBe(false);
    expect("textAlreadyDelivered" in frames[1]).toBe(false);
  });

  it("does not let a suppressed twin become the comparison point for the next real utterance", () => {
    // AC-V1.4, and the reason this case exists at all: if a frame that was
    // itself identified as a re-delivery overwrites the remembered final,
    // then after the sequence timed("yes") -> untimed("yes") the remembered
    // final is UNTIMED, and the next genuine timed "yes" matches the widened
    // V1.1 rule ("exactly one side has a span") and is silently swallowed.
    // A dedupe that eats real speech is worse than the duplication it fixes.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });

    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "Yes.",
        words: wordsSpanning(1, 1.2, "yes"),
      }),
    );
    stream._handleMessage(transcriptMessage("committed_transcript", { text: "Yes." }));
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "Yes.",
        words: wordsSpanning(12, 12.2, "yes"),
      }),
    );

    const frames = framesFrom(onTranscript);
    expect(frames).toHaveLength(3);
    expect("textAlreadyDelivered" in frames[0]).toBe(false);
    expect(frames[1].textAlreadyDelivered).toBe(true);
    // The third frame is a NEW utterance: a different span, and the only
    // thing it can honestly be compared against is the first frame.
    expect("textAlreadyDelivered" in frames[2]).toBe(false);
  });

  it("recovers the span from a suppressed twin, so the next real utterance is not swallowed", () => {
    // AC-V1.4, the OTHER order — and the order the user's session actually
    // delivers, untimed member first. A peer review with a mutation harness
    // found that the previous version of this criterion ("keep the richer
    // original") admitted an implementation that passes every other case here
    // and eats real speech on exactly this sequence: the remembered final is
    // still untimed after the pair, so the NEXT genuine utterance with the
    // same text also matches "exactly one side has a span" and disappears.
    //
    // The property, stated so the implementation follows from it rather than
    // from a case list: the remembered final always holds the best span known
    // for the commit it represents.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });

    stream._handleMessage(transcriptMessage("committed_transcript", { text: "Yes." }));
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "Yes.",
        words: wordsSpanning(1, 1.2, "yes"),
      }),
    );
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "Yes.",
        words: wordsSpanning(30, 30.2, "yes"),
      }),
    );

    const frames = framesFrom(onTranscript);
    expect(frames).toHaveLength(3);
    expect("textAlreadyDelivered" in frames[0]).toBe(false);
    expect(frames[1].textAlreadyDelivered).toBe(true);
    expect("textAlreadyDelivered" in frames[2]).toBe(false);
  });

  it("delivers two identical utterances that each arrive as a full commit pair", () => {
    // AC-V1.3/V1.4 together, at full protocol fidelity: this is what a real
    // repeated sentence looks like on the wire when INCLUDE_TIMESTAMPS is on
    // — four frames, two commits. Exactly two of them may carry the text
    // forward, and they must be one from each commit.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });

    for (const start of [1, 9]) {
      stream._handleMessage(transcriptMessage("committed_transcript", { text: "Okay." }));
      stream._handleMessage(
        transcriptMessage("committed_transcript_with_timestamps", {
          text: "Okay.",
          words: wordsSpanning(start, start + 0.3, "okay"),
        }),
      );
    }

    const frames = framesFrom(onTranscript);
    expect(frames).toHaveLength(4);
    const accumulating = frames.filter((f) => f.textAlreadyDelivered !== true);
    expect(accumulating).toHaveLength(2);
    expect(accumulating.map((f) => f.transcript)).toEqual(["Okay.", "Okay."]);
    // One per commit, proven rather than counted: a count of 2 is equally
    // satisfied by both survivors coming from the FIRST commit while the
    // second is swallowed whole. The surviving frame of the second commit is
    // whichever member of that pair arrived first with a distinguishable
    // span, so it must carry the second commit's start.
    expect(accumulating[1].start).toBe(9);
  });

  it("delivers an untimed pair unchanged, because nothing distinguishes them", () => {
    // AC-V1.5: with neither side carrying a span there is no evidence either
    // way, and this module's standing judgement (see _emitTranscript) is that
    // an unproven re-delivery is delivered rather than swallowed. Unchanged
    // from today on purpose.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });

    stream._handleMessage(transcriptMessage("committed_transcript", { text: "same text" }));
    stream._handleMessage(transcriptMessage("committed_transcript", { text: "same text" }));

    const frames = framesFrom(onTranscript);
    expect(frames).toHaveLength(2);
    expect("textAlreadyDelivered" in frames[1]).toBe(false);
  });

  it("delivers different text as different utterances even when one side is untimed", () => {
    // The other negative control: the widened rule keys on TEXT EQUALITY
    // first. A rule that deduped on "one side has no span" alone would eat
    // every second utterance in a session.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });

    stream._handleMessage(transcriptMessage("committed_transcript", { text: "First question?" }));
    stream._handleMessage(
      transcriptMessage("committed_transcript_with_timestamps", {
        text: "Second question?",
        words: wordsSpanning(4, 5.5, "second"),
      }),
    );

    const frames = framesFrom(onTranscript);
    expect(frames).toHaveLength(2);
    expect("textAlreadyDelivered" in frames[1]).toBe(false);
  });

  it("reports a warning message without tripping the unrecognized-message-type report", () => {
    // AC-V1.6. `warning` is in ElevenLabs' published server-to-client message
    // list and this module does not handle it, so a real warning would arrive
    // as "this module was written against ElevenLabs' documented protocol and
    // has not been verified against the live service" — a message that tells
    // the user their wire format has drifted when it has not.
    const onError = vi.fn();
    const onTranscript = vi.fn();
    const stream = makeStream({ onError, onTranscript });

    stream._handleMessage({ message_type: "warning", error: "audio is very quiet" });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const message = onError.mock.calls[0][0]?.message || "";
    expect(message).toContain("audio is very quiet");
    expect(message).not.toContain("unrecognized message_type");
    expect(message).not.toContain("has not been verified");
  });

  it("reports the warning's own text, whichever field the service put it in", () => {
    // AC-V1.6.1. The handler read `msg.error` and nothing else. `error` is
    // what the ERROR message types carry — this module's own
    // ERROR_MESSAGE_TYPES comment says so — and a warning is deliberately not
    // one of those, so the field that actually carries a warning's text is
    // the one thing the handler never looked at. The result was a report
    // reading "ElevenLabs warning: no further detail given." while the
    // detail sat unread in the message, which is worse than not handling the
    // type at all: it states positively that there was nothing to say.
    //
    // AC-V1.6 only required that a warning not trip the unrecognized-type
    // branch, which the original did satisfy — so this is a gap in that
    // criterion, not a failure to meet it.
    const cases = [
      { message_type: "warning", message: "audio too quiet" },
      { message_type: "warning", warning: "audio too quiet" },
      { message_type: "warning", error: "audio too quiet" },
    ];
    for (const msg of cases) {
      const onError = vi.fn();
      makeStream({ onError })._handleMessage(msg);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]?.message || "").toContain("audio too quiet");
    }
  });

  it("still says so plainly when a warning really carries no detail", () => {
    // The negative control for the fallback chain: reaching wider must not
    // turn "nothing to report" into an empty or undefined-looking message.
    const onError = vi.fn();
    makeStream({ onError })._handleMessage({ message_type: "warning" });
    expect(onError).toHaveBeenCalledTimes(1);
    const message = onError.mock.calls[0][0]?.message || "";
    expect(message).toContain("no further detail given.");
    expect(message).not.toContain("undefined");
  });
});

describe("ElevenLabsStream commit pair — the captured session end to end (AC-V1.7)", () => {
  it("emits one accumulating frame per spoken utterance for the whole recorded session", () => {
    // The five utterances of interview-log-live-2026-08-25-1644.json, in the
    // order and with the timing the provider actually delivered them. Before
    // the fix this produces ten accumulating frames; after it, five.
    //
    // This asserts the WHOLE sequence with toEqual rather than a count: a
    // count is satisfied by a dedupe that drops the wrong five.
    const onTranscript = vi.fn();
    const stream = makeStream({ onTranscript });

    const session = [
      { text: "Talk to me about what appealed to you about Purple Wave and why you applied.", start: 3.639, duration: 3.62 },
      { text: "That's a great question.", start: 32.899, duration: 1.06 },
      { text: "What do you know about Purple Wave?", start: 71.807, duration: 1.36 },
      { text: "That's a great question. What do you know about Purple Wave?", start: 86.168, duration: 2.739 },
      { text: "Um, so I would say...", start: 90.795, duration: 1.24 },
    ];

    for (const { text, start, duration } of session) {
      stream._handleMessage(transcriptMessage("committed_transcript", { text }));
      stream._handleMessage(
        transcriptMessage("committed_transcript_with_timestamps", {
          text,
          words: wordsSpanning(start, start + duration),
        }),
      );
    }

    const frames = framesFrom(onTranscript);
    // Every frame is still delivered — nothing is dropped from the wire.
    expect(frames).toHaveLength(10);

    // ...but exactly one member of each pair carries the text forward.
    const accumulating = frames.filter((f) => f.textAlreadyDelivered !== true);
    expect(accumulating.map((f) => f.transcript)).toEqual(session.map((u) => u.text));
  });
});
