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
//                 by Deepgram. May be `undefined`/non-number when Deepgram
//                 didn't supply timing for some reason; treated as "cannot
//                 be excluded on this basis" (include it) rather than
//                 silently dropping real transcript — an unknown position is
//                 not evidence the final is out of range.
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
