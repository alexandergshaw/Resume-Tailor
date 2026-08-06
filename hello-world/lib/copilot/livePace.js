// Pure "how fast is the user talking right now" computation for live mode's
// dashboard (AC-I2). No React, no timers, no Date.now(), no randomness —
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
// (AC-I2.12).

import { paceLabelFor, countWords } from "./answerMetrics";

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
// count.
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

  const words = countWords(String(text || ""));
  if (words === 0) return base;

  return [...base, { words, start, end: start + duration }];
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
