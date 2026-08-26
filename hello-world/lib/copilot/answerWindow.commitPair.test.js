import { describe, expect, it } from "vitest";
import { applyAnswerFinal } from "./answerWindow";

// AC-V1.9. Practice mode's answer window, restored for a provider that
// delivers one utterance as two frames.
//
// THE REGRESSION, introduced by AC-V1 and caught by the review pass. On
// ElevenLabs the frame carrying an utterance's TEXT is the untimed member of a
// commit pair; its timed twin arrives afterwards flagged
// `textAlreadyDelivered`. `acceptedAnswerFinal` refuses a flagged frame
// outright — correctly, for the text — and `isFinalInAnswerWindow` treats a
// non-numeric `start` as "no evidence this is out of range". So the frame the
// window is asked about has no span, the rule accepts unconditionally, and the
// answer window goes INERT: speech from before "Start answering" and after
// "Done" lands in the answer, `deriveSpeechSpan` returns {null,null}, and
// per-answer words-per-minute is gone.
//
// `acceptedAnswerFinal` cannot fix this, and that is not a shortcoming of the
// function — it is a pure function of ONE frame, and the span it needs exists
// only on a LATER one. The decision belongs to whatever owns the sequence.
// That was `usePracticeAnswer.js`'s `recordTranscriptEvent`, a React hook this
// repo's `environment: "node"` cannot exercise — which is exactly the signal
// this project has learned to read as "move the logic, don't accept the gap".
//
// So the sequencing moves here, as a pure reduction over the entries so far:
// `applyAnswerFinal({ entries, ... }) -> next entries`. The hook keeps the
// refs and the audio clock; this owns the decision, and can be sabotaged.

const WINDOW = { collecting: true, answerStart: 10, answerEnd: 20 };

function untimed(text) {
  return { isFinal: true, transcript: text, speakerTag: 1 };
}
function timedTwin(text, start, duration) {
  return { isFinal: true, transcript: text, start, duration, speakerTag: 1, textAlreadyDelivered: true };
}

describe("applyAnswerFinal — a commit pair contributes one entry with its span", () => {
  it("appends the untimed member, then backfills the span from its timed twin", () => {
    const afterFirst = applyAnswerFinal({ entries: [], frame: untimed("I led the migration."), ...WINDOW });
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].text).toBe("I led the migration.");

    const afterTwin = applyAnswerFinal({
      entries: afterFirst,
      frame: timedTwin("I led the migration.", 12, 3),
      ...WINDOW,
    });

    // Still ONE entry — the twin's text is not appended a second time, which
    // is the double-count AC-V1 exists to kill...
    expect(afterTwin).toHaveLength(1);
    // ...and it now carries the timing, which is the half that was lost.
    expect(afterTwin[0].start).toBe(12);
    expect(afterTwin[0].duration).toBe(3);
  });

  it("drops an entry the twin's span proves was outside the answer window", () => {
    // The whole point of the window, and the case that was silently accepted
    // while the span was missing: the candidate was still talking about the
    // PREVIOUS question when they pressed "Start answering".
    const afterFirst = applyAnswerFinal({ entries: [], frame: untimed("...as I was saying."), ...WINDOW });
    expect(afterFirst).toHaveLength(1);

    const afterTwin = applyAnswerFinal({
      entries: afterFirst,
      frame: timedTwin("...as I was saying.", 2, 3),
      ...WINDOW,
    });

    expect(afterTwin).toEqual([]);
  });

  it("KEEPS an entry whose span lands after Done, and still backfills it", () => {
    // THIS CASE WAS ORIGINALLY WRITTEN THE OTHER WAY ROUND, AND THAT WAS MY
    // ERROR — it asserted the entry should be dropped. A re-review proved the
    // rule I asked for deletes the last sentence of every practice answer on
    // ElevenLabs, and the implementer built exactly what I asserted.
    //
    // Why the upper bound cannot be enforced here. `doneAnswer` freezes
    // `answerEnd` to the audio clock the instant Done is pressed, but leaves
    // `collecting` true for the whole drain window so the answer's own last
    // sentence can still land. The audio clock only advances on frames
    // carrying numeric start AND duration — and on ElevenLabs that is
    // exclusively the `*_with_timestamps` member. Partials and the untimed
    // `committed_transcript` never move it. So `answerEnd` is systematically
    // one whole utterance STALE on that provider, and the final sentence's
    // twin always arrives with `start > answerEnd`.
    //
    // The lower bound is different in kind and IS enforceable: "the candidate
    // was still answering the previous question when they pressed Start" is
    // settled by a span the clock had already passed. So the amend path
    // re-evaluates against `answerStart` only. This is not a tuned constant;
    // it is the recognition that a backfilled span can settle one bound and
    // not the other. The sibling case above pins the half that works.
    const afterFirst = applyAnswerFinal({ entries: [], frame: untimed("Oh, and one more thing."), ...WINDOW });
    const afterTwin = applyAnswerFinal({
      entries: afterFirst,
      frame: timedTwin("Oh, and one more thing.", 25, 2),
      ...WINDOW,
    });

    expect(afterTwin).toHaveLength(1);
    expect(afterTwin[0].text).toBe("Oh, and one more thing.");
    // Backfilled anyway — the span is still the truth about when it was said,
    // and the metrics downstream need it.
    expect(afterTwin[0].start).toBe(25);
    expect(afterTwin[0].duration).toBe(2);
  });

  it("still drops an entry the twin proves began before Start", () => {
    // The bound that survives, asserted right beside the one that does not,
    // so a future reader sees the asymmetry is deliberate rather than an
    // oversight. Duplicated from the case above on purpose: these two are the
    // whole rule, and they must be read together.
    const afterFirst = applyAnswerFinal({ entries: [], frame: untimed("...as I was saying."), ...WINDOW });
    const afterTwin = applyAnswerFinal({
      entries: afterFirst,
      frame: timedTwin("...as I was saying.", 2, 3),
      ...WINDOW,
    });
    expect(afterTwin).toEqual([]);
  });

  it("only ever backfills the entry the twin actually belongs to", () => {
    // The twin's text must match the entry it is amending. A rule that
    // backfilled "the last entry" unconditionally would stamp one utterance's
    // timing onto a different utterance — worse than no timing, because it
    // reads as measured.
    let entries = applyAnswerFinal({ entries: [], frame: untimed("First point."), ...WINDOW });
    entries = applyAnswerFinal({ entries, frame: timedTwin("First point.", 11, 2), ...WINDOW });
    entries = applyAnswerFinal({ entries, frame: untimed("Second point."), ...WINDOW });
    entries = applyAnswerFinal({
      entries,
      frame: timedTwin("A completely different sentence.", 15, 2),
      ...WINDOW,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0].start).toBe(11);
    // The unmatched twin amended nothing and appended nothing.
    expect(entries[1].start).toBeUndefined();
    expect(entries.map((e) => e.text)).toEqual(["First point.", "Second point."]);
  });
});

describe("applyAnswerFinal — the single-frame behaviour is unchanged", () => {
  it("still accepts a timed final inside the window", () => {
    const entries = applyAnswerFinal({
      entries: [],
      frame: { isFinal: true, transcript: "In window.", start: 12, duration: 2, speakerTag: 1 },
      ...WINDOW,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].start).toBe(12);
  });

  it("still rejects a timed final outside the window", () => {
    const entries = applyAnswerFinal({
      entries: [],
      frame: { isFinal: true, transcript: "Too early.", start: 2, duration: 2, speakerTag: 1 },
      ...WINDOW,
    });
    expect(entries).toEqual([]);
  });

  it("still rejects everything while not collecting", () => {
    // Including a twin — nothing may be amended into an answer that is not
    // being recorded.
    const idle = { collecting: false, answerStart: 10, answerEnd: 20 };
    expect(applyAnswerFinal({ entries: [], frame: untimed("Nope."), ...idle })).toEqual([]);
    expect(
      applyAnswerFinal({ entries: [], frame: timedTwin("Nope.", 12, 2), ...idle }),
    ).toEqual([]);
  });

  it("still ignores an interim", () => {
    expect(
      applyAnswerFinal({
        entries: [],
        frame: { isFinal: false, transcript: "partial", ...WINDOW },
        ...WINDOW,
      }),
    ).toEqual([]);
  });

  it("a flagged twin with no numeric span amends nothing", () => {
    // The flag alone is not evidence of anything — it says the TEXT is a
    // re-delivery. A twin that carries no `start` has nothing the entry
    // doesn't already have, so the only correct outcome is the untouched
    // list (and, in particular, not a `start: undefined` stamped over a
    // span some other frame may still supply).
    const entries = applyAnswerFinal({ entries: [], frame: untimed("No timing came."), ...WINDOW });
    const after = applyAnswerFinal({
      entries,
      frame: { isFinal: true, transcript: "No timing came.", textAlreadyDelivered: true },
      ...WINDOW,
    });
    expect(after).toBe(entries);
    expect(after[0].start).toBeUndefined();
  });

  it("a flagged twin with nothing to amend is a no-op, not an append", () => {
    // The partner text frame was rejected by the window (or never arrived),
    // so there is no entry this twin belongs to. Appending it would put an
    // already-rejected utterance into the answer through the back door.
    const after = applyAnswerFinal({ entries: [], frame: timedTwin("Orphan.", 12, 2), ...WINDOW });
    expect(after).toEqual([]);
  });

  it("returns the SAME array instance when nothing changed", () => {
    // So the caller can assign the result unconditionally without forcing a
    // re-render or a ref write on every ignored frame.
    const entries = applyAnswerFinal({ entries: [], frame: untimed("Kept."), ...WINDOW });
    const after = applyAnswerFinal({
      entries,
      frame: { isFinal: false, transcript: "partial" },
      ...WINDOW,
    });
    expect(after).toBe(entries);
  });
});
