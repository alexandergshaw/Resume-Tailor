// ARCH-stats-in-strip r3 §2.7 — the STT-failure rule for the sticky strip's
// speaking-stats row and CopilotDashboard's DeliveryPanel, applied with NO
// new timer. `trimToWindow` (livePace.js) anchors its rolling window to the
// last sample's own AUDIO-clock `end`, not to a wall clock, so once a
// speech-to-text socket stops delivering frames, the last computed reading
// persists indefinitely — `measured` never flips back to `false` on its
// own, because nothing about the window's own math changes. The bound that
// catches that has to live OUTSIDE livePace.js, on a wall clock, which is
// why this is a separate module rather than a change to that one.
//
// Both clients already own a 1-second wall clock that ticks only while
// capture runs (useLiveSession.js:267-271,
// usePracticeCaptureSession.js:123-127) — that ticker's `now`, plus a
// wall-clock `lastSampleAt` recorded alongside the readings
// (useCopilotDashboard.js), is the whole input this module needs. WHILE
// CAPTURE RUNS, `now` keeps advancing, so a window whose newest sample is
// too old to still contain anything current renders unmeasured — the STT
// failure, caught within STALE_AFTER_SEC seconds. AFTER A DELIBERATE STOP,
// the interval is torn down and `now` freezes at whatever it last was, so a
// finished session's true final reading survives untouched for as long as
// the user looks at it, in CopilotDashboard's DeliveryPanel — the sticky
// strip itself has no row at all once the session is no longer live (§2.4),
// so there is no second surface left that could show a different, expired
// answer.

import { DEFAULT_WINDOW_SEC } from "./livePace";

// AC 28: imported, never restated. `trimToWindow`'s window and this
// staleness bound are two DIFFERENT clocks measuring two different things
// (audio-time span vs. wall-clock silence) that happen to want the same
// number today — a policy call ("a reading whose window can no longer
// contain any sample is not a current reading"), not an identity. A second,
// independent literal here would silently stop agreeing with the window the
// moment DEFAULT_WINDOW_SEC is retuned, expiring readings on a bound that no
// longer means anything.
export const STALE_AFTER_SEC = DEFAULT_WINDOW_SEC;

// Fields a pace or filler reading may carry its actual measurement in.
// Nulled together, whichever of them the caller's reading shape happens to
// have, rather than forking this function into a pace version and a filler
// version — the two reading shapes never both appear on one object, so
// nulling the union is exactly as precise as nulling each shape by hand.
const MEASURED_VALUE_FIELDS = ["wordsPerMinute", "paceLabel", "fillerCount", "fillerRate", "fillerLabel"];

// Returns `reading` unchanged when it is still current, or an unmeasured
// twin — `measured: false`, every value field nulled — when the wall clock
// has moved more than STALE_AFTER_SEC past the last sample. NEVER mutates
// its argument: the same adjusted object is handed to both the strip and
// CopilotDashboard (§2.7), so a mutating version would silently expire the
// dashboard's own copy the instant the strip rendered.
//
// An already-unmeasured reading (or no reading, or no `lastSampleAt` yet —
// a fresh session that has heard nothing usable) is returned as-is: there is
// no real measurement to expire, and inventing one is exactly the failure
// AC-I2.14 exists to rule out.
export function staleAdjusted(reading, { lastSampleAt, now } = {}) {
  if (!reading || reading.measured !== true || lastSampleAt == null) return reading;
  // The bound is `>`, not `>=` — a sample exactly STALE_AFTER_SEC old is
  // still the most recent thing the app has heard and is not yet stale.
  if (now - lastSampleAt <= STALE_AFTER_SEC * 1000) return reading;

  const stale = { ...reading, measured: false };
  for (const field of MEASURED_VALUE_FIELDS) {
    if (field in stale) stale[field] = null;
  }
  return stale;
}
