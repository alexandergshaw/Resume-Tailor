// Pure "how fast is the user talking right now" computation for live mode's
// dashboard (AC-I2) — and, alongside it, how much verbal filler is in that
// same speech (AC-N1). No React, no timers, no Date.now(), no randomness —
// every function here is a straight function of its arguments, exactly the
// way answerMetrics.js's computeAnswerMetrics is.
//
// Context a caller needs before using this: session.js forwards each
// finalized transcript frame's `start`/`duration` — AUDIO-clock seconds
// from the speech-to-text provider (see lib/copilot/stt/index.js's
// onTranscript contract), not wall-clock arrival time. Dividing word count
// by wall-clock time instead of audio-time already burned this app once
// (BUG-1c — see answerMetrics.js's speechDurationSec comment): silence
// before and after speech makes a normal delivery read as "slow". This
// module must not reintroduce that, so every span it computes comes from
// `start`/`duration` values the provider actually supplied, never from when
// a frame happened to arrive.
//
// A second, distinct failure mode this module specifically guards against:
// `start`/`duration` are `undefined` whenever the provider did not supply
// timing for a frame at all — a REAL, expected case (ElevenLabs only
// timestamps word-level entries; see deriveSpan in stt/elevenlabs.js), not
// an error. Treating an undefined duration as 0 would silently corrupt the
// measurement rather than just omit that one frame from it, so frames with
// unusable timing are dropped at append time, never coerced to a fabricated
// zero.
//
// The thresholds and the wpm -> label mapping are imported from
// answerMetrics.js rather than restated here, so practice mode and live
// mode can never disagree about what "rushed" means for the same speaker
// (AC-I2.12). The filler matcher and its own thresholds/label mapping are
// imported from there for the identical reason (AC-N1's version of the same
// rule) — see computeLiveFillers below.
//
// The pace and filler readings are derived from ONE appended sample list
// and windowed together rather than kept as two separate lists, because
// they are rendered side by side: a user comparing "142 wpm" against
// "noticeable filler" is comparing two properties of the SAME stretch of
// speech only if both numbers actually came from that one stretch. Two
// lists, each windowed on its own, could each be internally correct and
// still describe two different spans — the last 30s of talking speed next
// to the last 30s of filler from a moment earlier, say — which would make
// the pairing on screen a lie even though neither number was wrong.

import { paceLabelFor, countWords, countPhrases, FILLER_PHRASES, fillerLabelFor } from "./answerMetrics";

// Seconds. Default width of the rolling window computeLivePace looks back
// over when the caller doesn't specify one — long enough to smooth over a
// normal breath or short pause, short enough that the reading actually
// tracks CURRENT pace rather than the whole session's average.
export const DEFAULT_WINDOW_SEC = 30;

// Minimum words the (windowed) samples need to add up to before a wpm
// figure is treated as a real measurement rather than noise. Two or three
// words extrapolated out to a per-minute rate swing wildly depending on
// exactly how long they took to say — the same "not enough to trust"
// reasoning bodyLanguage.js's MIN_FACE_SAMPLES/MIN_POSE_SAMPLES apply to
// video signals (AC-I2.14: an unmeasured signal must never be reported as
// though it were a stable reading).
export const MIN_WORDS_FOR_MEASUREMENT = 8;

// One appended, USABLE speech sample: `words` is the frame's word count,
// `start`/`end` are its audio-time span in seconds (`end` is stored rather
// than the frame's original `duration` because windowing below repeatedly
// needs each sample's END position to compare against the most recent one
// seen — storing it once at append time is less error-prone than
// recomputing `start + duration` on every comparison).
//
// A sample also carries `fillers` — its unambiguous-filler count, counted
// once here at append time so computeLiveFillers below only ever sums
// numbers already sitting on the samples it windows, the same way it sums
// `words`. It MUST be a plain, enumerable field, not hidden via
// Object.defineProperty(..., { enumerable: false }): a hidden field is
// dropped by `JSON.parse(JSON.stringify(...))`, `structuredClone`, object
// spread, or any future code that maps or rebuilds the sample array — and
// when it vanishes the filler reading does not error, it just silently
// reports a lower rate that still looks like a real measurement. That is
// exactly the failure mode this module's own header comment guards against
// for missing durations ("dropped rather than kept with a fabricated 0,
// which would silently corrupt every pace reading computed afterward").

// Appends one finalized transcript frame to `samples`, returning a NEW
// array — `samples` itself is never mutated, so a caller holding the
// running list (e.g. in a React ref) can't be surprised by an in-place
// change showing up where it isn't expected.
//
// `start`/`duration` missing, non-numeric, or negative means the provider
// gave no usable timing for this frame — a real, expected case (see the
// module comment above), not an error — and the frame is DROPPED rather
// than kept with a fabricated 0 duration, which would silently corrupt
// every pace reading computed afterward. `start === 0` (a frame that opens
// the stream) is a legitimate, USABLE value and must not be treated as
// falsy/missing — the checks below are explicit `typeof`/`Number.isFinite`
// checks for exactly that reason, not a truthiness check.
//
// A frame with usable timing but no actual words (should not happen in
// practice — every STT provider already filters empty/whitespace-only
// transcript before calling onTranscript — but defensively handled here
// too) is also dropped: it would only dilute the measured span with time
// during which nothing was said, without contributing anything to word
// count — or, now, to filler count either.
//
// Both drop rules apply identically to the filler reading: a frame with
// unusable timing can't be placed in the window at all, and a frame with no
// words has no fillers to count either, so there is no separate filler drop
// rule to keep in sync with this one.
export function appendSpeechSample(samples, { text, start, duration } = {}) {
  const base = Array.isArray(samples) ? samples : [];
  const hasTiming =
    typeof start === "number" &&
    Number.isFinite(start) &&
    start >= 0 &&
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration >= 0;
  if (!hasTiming) return base;

  const cleanText = String(text || "");
  const words = countWords(cleanText);
  if (words === 0) return base;

  // Counted with answerMetrics.js's own matcher (see countPhrases/
  // FILLER_PHRASES there) rather than a regex written here — see the
  // module-level import comment for why a second copy of "what counts as a
  // filler" is a bug waiting to happen, not a convenience.
  const fillers = countPhrases(cleanText, FILLER_PHRASES).total;

  const sample = { words, start, end: start + duration, fillers };
  return [...base, sample];
}

// Keeps only the tail of `samples` whose audio-time position falls within
// `windowSec` of the MOST RECENT sample's end — "the last N seconds of
// speech", not "the last N samples". `samples` is assumed to be in the
// order frames were appended (oldest to newest), exactly the order
// appendSpeechSample produces; the most recent sample's `end` is taken as
// the window's right edge since this module has no wall clock of its own
// to anchor "now" to.
//
// Returns a NEW array; input is never mutated. Empty input returns [].
export function trimToWindow(samples, windowSec) {
  const list = Array.isArray(samples) ? samples : [];
  if (list.length === 0) return [];

  const windowLen = Number.isFinite(windowSec) && windowSec > 0 ? windowSec : DEFAULT_WINDOW_SEC;
  const latestEnd = list[list.length - 1].end;
  const cutoff = latestEnd - windowLen;
  return list.filter((sample) => sample.end >= cutoff);
}

// Derives `{ wordsPerMinute, paceLabel, measured }` from the rolling window
// of the caller's own speech samples (built via appendSpeechSample).
//
// `measured` is `false` — with `wordsPerMinute` and `paceLabel` both
// `null`, NEVER `wordsPerMinute: 0` or a guessed label — whenever the
// window doesn't have enough usable timing to support a reading: no
// samples at all, or fewer than MIN_WORDS_FOR_MEASUREMENT words within the
// window, or a zero/negative measured span (a single frame whose start
// equals its end, which would otherwise divide by zero). AC-I2.14: a
// missing measurement is not a measurement of zero, the same rule the
// body-language work (lib/copilot/bodyLanguage.js) already established for
// video signals — an unmeasured signal is reported as unmeasured, not
// silently rendered as a real, if unflattering, one.
export function computeLivePace(samples, { windowSec } = {}) {
  const windowed = trimToWindow(samples, windowSec);
  if (windowed.length === 0) {
    return { wordsPerMinute: null, paceLabel: null, measured: false };
  }

  let totalWords = 0;
  let firstStart = null;
  let lastEnd = null;
  for (const sample of windowed) {
    totalWords += sample.words;
    if (firstStart === null || sample.start < firstStart) firstStart = sample.start;
    if (lastEnd === null || sample.end > lastEnd) lastEnd = sample.end;
  }

  const spanSec = lastEnd - firstStart;
  if (totalWords < MIN_WORDS_FOR_MEASUREMENT || spanSec <= 0) {
    return { wordsPerMinute: null, paceLabel: null, measured: false };
  }

  const wordsPerMinute = (totalWords / spanSec) * 60;
  return { wordsPerMinute, paceLabel: paceLabelFor(wordsPerMinute), measured: true };
}

// Derives `{ fillerCount, fillerRate, fillerLabel, measured }` from the SAME
// rolling window computeLivePace draws on — trimToWindow, unchanged, over
// the samples appendSpeechSample already built. fillerRate is fillers per
// hundred words, and fillerLabel is answerMetrics.js's fillerLabelFor
// applied to that rate, so a live filler reading and a post-answer one can
// never disagree about what the same rate means (the same reasoning
// computeLivePace's own doc comment gives for sharing paceLabelFor).
//
// `measured` follows the identical AC-I2.14 floor computeLivePace uses —
// fewer than MIN_WORDS_FOR_MEASUREMENT words in the window (including no
// samples at all) means "not enough to trust a rate", not a rate of 0.
//
// Unlike computeLivePace, this function does NOT require spanSec > 0.
// computeLivePace's span guard exists purely to avoid dividing by zero —
// wordsPerMinute needs a length of TIME in the denominator. A filler rate's
// denominator is WORDS, which the word-count guard above already protects;
// there is no division here that a zero-length window could break. Copying
// computeLivePace's span guard across would be the obvious move and the
// wrong one: it would report "not measured" for a real, complete answer
// that happened to arrive as a single zero-duration transcript frame,
// exactly the case liveFiller.test.js's "still reports when the speech span
// has no measurable length" case exists to catch.
//
// Zero fillers over enough words is a real measurement, not the absence of
// one — the AC-I2.14 "unmeasured is never reported as a real-looking zero"
// rule, applied to the one signal here where zero is the goal rather than
// the failure: only too little speech is unmeasured, never a clean stretch
// of it.
export function computeLiveFillers(samples, { windowSec } = {}) {
  const windowed = trimToWindow(samples, windowSec);

  let totalWords = 0;
  let totalFillers = 0;
  for (const sample of windowed) {
    totalWords += sample.words;
    // A sample whose `fillers` isn't a finite number (should not happen —
    // appendSpeechSample always sets it from countPhrases — but guarded here
    // too, same defensive posture as the missing-timing guard in
    // appendSpeechSample above) contributes nothing rather than being summed
    // as-is: an unguarded `NaN` here would propagate into `fillerCount` and
    // `fillerRate` below and still satisfy `totalWords >=
    // MIN_WORDS_FOR_MEASUREMENT`, producing `measured: true` alongside a
    // `NaN` reading — precisely the "unmeasured reported as a plausible
    // number" failure this module's header (and AC-I2.14) rules out.
    totalFillers += Number.isFinite(sample.fillers) ? sample.fillers : 0;
  }

  if (totalWords < MIN_WORDS_FOR_MEASUREMENT) {
    return { fillerCount: null, fillerRate: null, fillerLabel: null, measured: false };
  }

  const fillerRate = (totalFillers / totalWords) * 100;
  return { fillerCount: totalFillers, fillerRate, fillerLabel: fillerLabelFor(fillerRate), measured: true };
}
