// Pure decision logic for practice mode's answer flow: which finalized
// Deepgram transcripts belong to the answer currently being recorded, and
// the audio-time span the accepted ones cover. Extracted out of
// PracticeClient (AC-C4-8) so this — the riskiest logic in the feature — is
// reachable from the repo's node-only vitest setup. No React, no DOM, no
// browser globals: every function here is a straight function of its
// arguments.
//
// Context a caller needs to have straight before using these: Deepgram
// finals are bounded by AUDIO time, not wall-clock arrival time or the order
// finals happen to arrive in. A final for a sentence spoken before "Start
// answering" must never leak into the answer, while the final for the
// answer's own last sentence — which can arrive a beat AFTER "Done" was
// pressed, since Deepgram's endpointing plus network latency lags real
// speech by 0.3-1.5s — must still land. That's why the caller tracks
// "answerStart"/"answerEnd" in audio-clock seconds (see PracticeClient's
// audioClockRef) rather than Date.now().

// Whether one Deepgram final belongs to the answer currently being
// collected, decided purely from audio-stream time.
//
//   start       — the final's own audio-time offset in seconds, as reported
//                 by the provider. May be `undefined`/non-number when the
//                 provider didn't supply timing for this frame; treated as
//                 "cannot be excluded on this basis" (include it) rather
//                 than silently dropping real transcript — an unknown
//                 position is not evidence the final is out of range. That
//                 permissive rule is only half a decision on a provider
//                 that splits an utterance across two frames, and AC-V1.9
//                 supplies the other half: on ElevenLabs the frame carrying
//                 an utterance's TEXT is the untimed member of a commit
//                 pair, and its timed twin arrives afterwards flagged
//                 `textAlreadyDelivered`, so a rule applied to the text
//                 frame alone would accept unconditionally and the answer
//                 window would go inert on that provider — speech from
//                 before "Start answering" and after "Done" landing in the
//                 answer, and no span left for deriveSpeechSpan to measure
//                 pace over. This function still cannot see that coming;
//                 it is a pure function of ONE frame, and the span lives on
//                 a LATER one. applyAnswerFinal (below) owns the sequence
//                 and calls this a SECOND time once the twin's span is
//                 known — with `answerEnd: null`, against the LOWER bound
//                 only — dropping the provisionally-accepted entry when the
//                 real position turns out to be before "Start answering".
//                 So "include it" is correctly read as "include it for now,
//                 subject to revision on the lower bound" rather than
//                 "include it forever". The upper bound is deliberately NOT
//                 revised there, and applyAnswerFinal's amend path carries
//                 the full reason: `answerEnd` is one utterance stale on the
//                 only provider that reaches it, so enforcing it against a
//                 late span deletes the answer's own last sentence.
//   answerStart — the audio-time position when "Start answering" was
//                 pressed, captured from the caller's running audio clock.
//   answerEnd   — the audio-time position when "Done" was pressed, or
//                 `null` while the answer is still being collected (no
//                 upper bound yet — everything from answerStart onward is
//                 still a candidate).
export function isFinalInAnswerWindow({ start, answerStart, answerEnd }) {
  const finalStart = typeof start === "number" ? start : null;
  const afterStart = finalStart === null || finalStart >= answerStart;
  const beforeDone = answerEnd === null || finalStart === null || finalStart < answerEnd;
  return afterStart && beforeDone;
}

// The audio-time span the ACCEPTED finals for an answer actually cover —
// first accepted final's start through the latest end (start + duration)
// seen among them. This is what words-per-minute must be computed over
// (BUG-1c): the wall-clock Start-to-Done duration includes silence before
// the first word and after the last, and dividing word count by that
// instead systematically understates pace for an answer that has a normal
// pace but is bookended by a couple of seconds of silence.
//
// `finals` is the list of accepted finals for one answer, each shaped
// `{ start, duration }` in audio-time seconds (both may be non-numbers for
// a final Deepgram didn't timestamp — such entries are skipped for span
// purposes, same as they're never excluded from inclusion above on that
// basis alone).
//
// `firstStart` is the FIRST timed final encountered, in list order — not
// the minimum across the list. Finals arrive from the transcript stream in
// speech order, so in practice these coincide; preserving "first
// encountered" rather than "earliest value" keeps this an exact behavioral
// match for the inline logic it replaces. `lastEnd` is the running maximum
// end across the whole list, which the original tracked incrementally as
// finals arrived and is equivalent computed as a batch here.
//
// Returns `{ firstStart: null, lastEnd: null }` when no final in the list
// carried a numeric start — never NaN — so callers can check for that
// case explicitly instead of accidentally computing a span from nothing.
export function deriveSpeechSpan(finals) {
  let firstStart = null;
  let lastEnd = null;
  for (const final of finals || []) {
    const start = typeof final?.start === "number" ? final.start : null;
    if (start === null) continue;
    if (firstStart === null) firstStart = start;
    const end = typeof final?.duration === "number" ? start + final.duration : start;
    if (lastEnd === null || end > lastEnd) lastEnd = end;
  }
  return { firstStart, lastEnd };
}

// The accept/reject DECISION usePracticeAnswer.js's recordTranscriptEvent
// applies to every transcript event (interim or final) from the session's
// STT socket — extracted out to a plain function (R-127) for the same
// reason isFinalInAnswerWindow/deriveSpeechSpan above already are: it is
// this feature's riskiest logic, and a pure function of its arguments is far
// cheaper to exercise exhaustively than the same rule read out of a mounted
// hook. (This used to claim a hook COULD NOT be mounted here — "no jsdom
// anywhere in the suite". That was false: `jsdom` is a devDependency,
// vitest.config.js documents the per-file `// @vitest-environment jsdom`
// docblock as the supported opt-in, and app/copilot/useLiveSession.cues.test.js
// and usePracticeAnswer.commitPair.test.js both mount real hooks. The false
// claim mattered: it is the stated reason nobody wrote the hook-level test of
// doneAnswer + drain, which is exactly the test that would have caught the
// last-sentence deletion this file's amend path had.)
// recordTranscriptEvent still owns the
// running audio clock and the refs themselves — a ref has no meaning
// outside a React lifecycle — this function owns only whether one final
// gets appended, and what.
//
// Returns `null` (reject, append nothing) when: the event isn't a final at
// all, nothing is currently being collected (`collecting`), the final falls
// outside the answer's audio-time window (isFinalInAnswerWindow, above), or
// `textAlreadyDelivered` is set. Otherwise returns the
// `{ text, start, duration, speakerTag }` entry to append.
//
// `textAlreadyDelivered` (see stt/index.js's onTranscript contract) means
// THIS FRAME'S TEXT was already delivered on an earlier final, and means
// nothing else — in particular it does NOT mean the frame is a duplicate,
// and it does NOT mean the frame repeats the earlier one's span. ElevenLabs
// delivers one committed utterance as an untimed `committed_transcript`
// followed by a `committed_transcript_with_timestamps`; the second is the
// flagged one and is the only member of the pair that ever carries
// `start`/`duration`. Refusing its TEXT here is right — appending it a
// second time would double this answer's word count, filler count and
// words-per-minute — but that is a decision about text alone, and a caller
// that needs TIMING must read it off this same flagged frame rather than
// skipping it (AC-V1.8; useLiveSession.js and usePracticeCaptureSession.js
// both gate their pace sampler on the span for exactly this reason, and
// applyAnswerFinal below reads the practice answer's span off the flagged
// frame rather than letting this function's `null` be the last word on the
// pair).
// Absent/falsy (Deepgram, and every ElevenLabs frame that ISN'T a
// re-delivery) behaves exactly as this function did before the flag
// existed.
//
// `speakerTag` (AC-M2): carried straight through onto the returned entry,
// unexamined. This function still decides accept/reject purely on audio
// time (plus the R-127 dedup flag above) — whose words a final belongs to
// is not something one final can settle. A short "Mhm" from the
// interviewer is indistinguishable from a short reply from the candidate
// until it can be weighed against the rest of the window, which is exactly
// what partitionAnswerFinals (answerSpeakers.js) does once the whole
// answer's finals are in. Passed through with no truthiness check — tag `0`
// is a real speaker id (Deepgram numbers speakers from 0), and `!speakerTag`
// would treat it as absent, silently dropping the most common speaker's
// attribution. Absent entirely (every non-diarized final, i.e. every
// existing practice user) comes through as `undefined`, same as before this
// field existed.
export function acceptedAnswerFinal({
  isFinal,
  transcript,
  start,
  duration,
  speakerTag,
  textAlreadyDelivered,
  collecting,
  answerStart,
  answerEnd,
} = {}) {
  if (!isFinal) return null;
  if (!collecting) return null;
  if (textAlreadyDelivered) return null;
  const included = isFinalInAnswerWindow({ start, answerStart, answerEnd });
  if (!included) return null;
  return { text: transcript, start, duration, speakerTag };
}

// One transcript frame folded into the list of finals accepted so far for
// the answer being collected: `{ entries, frame, collecting, answerStart,
// answerEnd } -> next entries`. This is the SEQUENCING acceptedAnswerFinal
// above structurally cannot do (AC-V1.9), and it lives here rather than in
// the caller for the reason every other piece of this feature's risky logic
// already does: a fold over the entries so far is a pure function of its
// arguments, so every ordering of every frame shape can be driven directly,
// while the same rule read out of usePracticeAnswer.js would have to be
// reached through a mounted hook, a fake session and a drain timer. That is
// a cost argument, NOT an impossibility one — an earlier version of this
// paragraph claimed the hook "cannot be mounted" in this repo, which was
// false (see the note on acceptedAnswerFinal above) and is precisely why the
// hook-level regression test that would have caught the last-sentence
// deletion went unwritten. usePracticeAnswer.commitPair.test.js is that test
// now, and it exercises this function through the hook rather than instead of
// it. The hook keeps what only React can own — the refs and the running audio
// clock — and hands the decision here.
//
// THE PROBLEM THIS EXISTS FOR. ElevenLabs delivers one committed utterance
// as TWO frames: an untimed `committed_transcript` carrying the text, then
// a `committed_transcript_with_timestamps` carrying `start`/`duration` and
// flagged `textAlreadyDelivered` (see stt/elevenlabs.js and stt/index.js's
// onTranscript contract). acceptedAnswerFinal refuses the flagged frame —
// right, for the text, since appending it again would double the answer's
// word count and its words-per-minute — and isFinalInAnswerWindow reads a
// missing `start` as "no evidence this is out of range". Applied to the
// text frame alone, those two correct rules compose into an answer window
// that accepts everything: speech from before "Start answering" and after
// "Done" lands in the answer, deriveSpeechSpan finds no numeric start at
// all and returns {null, null}, and per-answer pace is gone. Neither
// function can see it, because the evidence is on the OTHER frame.
//
// So a commit pair contributes exactly one entry, in two steps:
//
//   1. The untimed member goes through acceptedAnswerFinal unchanged and is
//      appended PROVISIONALLY — accepted because nothing yet contradicts
//      it, not because it was measured.
//   2. Its flagged twin appends nothing (that would be the double count)
//      and instead BACKFILLS the span onto the entry it belongs to, then
//      re-runs isFinalInAnswerWindow against the LOWER BOUND ONLY with the
//      position finally known. An entry the span proves began before "Start
//      answering" is dropped here — this is the deferred half of step 1's
//      decision, and skipping it would leave the window exactly as inert as
//      before, just with timings attached. An entry whose span lands past
//      "Done" is KEPT and backfilled: see the amend path's own comment for
//      why that bound cannot be settled by a late span, and what enforcing
//      it cost.
//
// The twin only ever amends the LAST entry, and only when its transcript
// matches that entry's text. A rule that backfilled "the last entry"
// unconditionally would stamp one utterance's timing onto a DIFFERENT
// utterance — strictly worse than no timing, because a wrong span reads as
// a measured one and silently poisons words-per-minute instead of just
// being absent. A twin matching nothing (a text frame this window already
// rejected, a flag arriving with no partner) amends nothing and appends
// nothing: the safe outcome for an unrecognised frame is that the answer is
// unchanged. A twin with no numeric `start` has nothing to contribute either
// way and is likewise a no-op.
//
// P5, the assumption that rule rests on, stated rather than left implicit:
// "an unmatched twin amends nothing" is true only when the TEXT differs.
// Given interleaved pairs `Au, Bu, Btwin, Atwin` whose two utterances have
// IDENTICAL text, `Atwin` matches the last entry — B's — and lands B's
// neighbour's span on it. Nothing here can tell those apart, because the
// protocol carries no id, sequence number or utterance marker on any
// transcript message (see stt/elevenlabs.js and R-261), so text is the only
// correlation available at all. This is theoretical rather than live:
// ElevenLabs emits each commit's pair together and does not interleave two
// commits, so the shape has never been observed. It is written down so a
// future provider that DOES reorder is recognised as breaking a stated
// assumption instead of read as a bug in the matching.
//
// Deepgram, which carries text and timing on the SAME frame and never sets
// the flag, never reaches the amend path at all — step 1 alone is exactly
// what recordTranscriptEvent did before this function existed, so this is a
// pure addition for that provider rather than a change to it.
//
// Returns the SAME array instance whenever nothing changed (an interim, a
// rejected final, an unmatched twin, anything while `collecting` is false),
// so the caller can assign the result unconditionally without forcing a ref
// write or a re-render on every ignored frame — and callers that compare by
// identity keep working.
export function applyAnswerFinal({ entries, frame, collecting, answerStart, answerEnd } = {}) {
  const current = entries || [];
  const {
    isFinal,
    transcript,
    start,
    duration,
    speakerTag,
    textAlreadyDelivered,
  } = frame || {};

  // The amend path: a flagged final is a re-delivery of text already
  // accounted for, so it is never appended — it exists here only to supply
  // the span its untimed partner could not. Gated on `collecting` for the
  // same reason acceptedAnswerFinal is: nothing may be amended into an
  // answer that is not being recorded (between answers, `entries` belongs
  // to no answer at all).
  if (isFinal && collecting && textAlreadyDelivered) {
    if (typeof start !== "number") return current;
    const lastIndex = current.length - 1;
    if (lastIndex < 0) return current;
    // Text identity is the only link between the two members of a pair —
    // the provider gives no correlation id — so it is also the only thing
    // that may authorise writing a span onto an existing entry.
    if (current[lastIndex].text !== transcript) return current;

    // The decision step 1 could not make — AGAINST THE LOWER BOUND ONLY,
    // which is what `answerEnd: null` says here (isFinalInAnswerWindow reads
    // a null upper bound as "no upper bound yet"). `duration` rides along
    // unexamined, exactly as acceptedAnswerFinal passes it through:
    // deriveSpeechSpan already treats a non-numeric duration as "span ends
    // at start", so there is nothing to validate here.
    //
    // WHY THE ASYMMETRY, since re-evaluating BOTH bounds is the obvious
    // reading and it is wrong. The two bounds are not the same kind of claim
    // once the span arrives a frame late:
    //
    //   Lower bound — "this began before Start answering" — IS settled by a
    //   backfilled span. `answerStart` was captured from an audio clock that
    //   had already reached that point when Start was pressed, so a span
    //   landing behind it is real evidence about a moment the clock has
    //   already passed. This is the case that matters: the candidate was
    //   still finishing the PREVIOUS answer when they pressed Start.
    //
    //   Upper bound — "this began after Done" — is NOT. `doneAnswer` freezes
    //   `answerEnd` to the audio clock the instant Done is pressed, then
    //   deliberately leaves `collecting` true for the whole drain so the
    //   answer's own last sentence can still land. But that clock only
    //   advances on frames carrying numeric `start` AND `duration`, and on
    //   ElevenLabs the only frame that ever carries both is the
    //   `*_with_timestamps` member of a commit pair — partials and the
    //   untimed `committed_transcript` never move it. So on the one provider
    //   that reaches this amend path at all, `answerEnd` is structurally one
    //   whole utterance STALE: the clock has not seen the in-flight
    //   utterance, and the final sentence's twin therefore ALWAYS arrives
    //   with `start > answerEnd`. Enforcing that bound here deletes the last
    //   sentence of every practice answer — measured on the real module,
    //   three sentences in and two out, with the dropped one gone from the
    //   transcript, the word count, the filler count, the words-per-minute
    //   and the speaker partitioning.
    //
    // So an entry whose span lands past `answerEnd` is KEPT and backfilled
    // anyway: the span is still the truth about when it was said, and every
    // metric downstream needs it. That is not a relaxed rule, it is the
    // recognition that a late span can settle one bound and cannot settle
    // the other. `answerWindow.commitPair.test.js` pins both halves side by
    // side so the asymmetry reads as deliberate rather than as an oversight.
    if (!isFinalInAnswerWindow({ start, answerStart, answerEnd: null })) {
      return current.slice(0, lastIndex);
    }
    const next = current.slice();
    next[lastIndex] = { ...current[lastIndex], start, duration };
    return next;
  }

  // The ordinary path, unchanged: one frame, one decision, appended if
  // accepted. speakerTag rides through untouched (AC-M2) — whose words a
  // final belongs to is settled over the whole answer by
  // partitionAnswerFinals, never here.
  const entry = acceptedAnswerFinal({
    isFinal,
    transcript,
    start,
    duration,
    speakerTag,
    textAlreadyDelivered,
    collecting,
    answerStart,
    answerEnd,
  });
  if (!entry) return current;
  return [...current, entry];
}
