// AC-S3: the pure decision behind the always-visible "what is the copilot
// hearing" strip. See liveHearing.test.js's header for the full narrative
// of the bug this exists to fix — a live session that looked "● Live" and
// transcribed nothing, with no visible difference from a session that was
// actually working, because both the transcript and the detected-question
// feed lived behind a disclosure that collapses on every Start.
//
// No DOM, no React, no timers of its own — every quantity this needs
// (`now`, `startedAt`, the transcript so far) is handed in by the caller,
// the same discipline answerWindow.js/livePace.js already follow for this
// codebase's other pure live-session decisions. `now` defaults to
// `Date.now()` purely so a caller that doesn't care about exact timing
// (e.g. an idle-state check) doesn't have to supply one — every test in
// liveHearing.test.js passes `now` explicitly.

import { speakerDisplayLabel } from "./speakerIdentity";

// AC-S3.3: how long the session can go without hearing anything at all —
// final OR interim — before the strip stops merely "waiting" and states
// plainly that something is plausibly wrong. Comfortably above an ordinary
// between-question pause (the interviewer thinking, the candidate finishing
// an answer) so this never fires during a session that is actually working.
export const HEARD_NOTHING_AFTER_MS = 10_000;

// AC-S3.6: the strip is bounded to about two lines — a single very long
// turn (or a hostile/malformed one) is clipped here, at the source of the
// text, rather than relying on CSS alone to hide the overflow.
const MAX_TEXT_LEN = 200;

function asText(value) {
  return typeof value === "string" ? value : "";
}

function truncate(text) {
  if (text.length <= MAX_TEXT_LEN) return text;
  return `${text.slice(0, MAX_TEXT_LEN - 1).trimEnd()}…`;
}

// AC-S3.4: a final turn's speaker label. A turn carrying a numeric
// `speakerTag` (in-person capture) resolves through `speakerDisplayLabel` —
// the one authoritative resolver this app has for that, reused rather than
// restated per this module's own contract. A turn with no `speakerTag`
// (tab/system capture never carries one) falls back to the plain two-value
// vocabulary those sources already use, the same fallback
// resolveTranscriptLabel (useLiveSession.js) applies — restated in miniature
// here rather than imported, since that file is a React hook module this
// pure one must not depend on.
function labelForFinal(entry, speakerSnapshot) {
  if (entry && typeof entry.speakerTag === "number") {
    return speakerDisplayLabel(entry.speakerTag, speakerSnapshot);
  }
  return entry && entry.speaker === "them" ? "Them" : "You";
}

// AC-S3.2: an interim is the earliest possible proof audio is flowing —
// checked before any final, and before the silence clock, because it is
// exactly what tells "connected but deaf" apart from "working" in the first
// couple of seconds of a session, before a single utterance has completed.
// "them" (the interviewer) is checked first: with both channels producing
// interim text at once, what the interviewer is mid-saying is the more
// actionable thing to surface, since it is what a detected question will be
// drawn from.
function activeInterim(interims) {
  const src = interims && typeof interims === "object" ? interims : {};
  const them = asText(src.them).trim();
  if (them) return { key: "them", text: them };
  const you = asText(src.you).trim();
  if (you) return { key: "you", text: you };
  return null;
}

// Defensive against malformed entries (AC-S3.5) — `null`, a bare number, or
// an object whose `text` isn't a usable string are all skipped rather than
// thrown on, and the search runs from the end so the MOST RECENT valid
// entry wins even if a later one is malformed.
function lastValidFinal(finals) {
  const list = Array.isArray(finals) ? finals : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i];
    if (entry && typeof entry === "object" && asText(entry.text).trim()) return entry;
  }
  return null;
}

// AC-S3.1/S3.2/S3.3/S3.4 — the whole decision. `status` drives the strip's
// visual treatment (the wiring layer handles AC-S3.7's "silent" styling and
// source-specific hint, since `source` isn't part of this function's
// contract — see liveHearing.test.js); `label`/`text` are what it shows.
export function hearingState({
  live,
  finals,
  interims,
  startedAt,
  // D2: `startedAt` lands only once status reaches "live" — a session stuck
  // "connecting" (live === true from the moment Start is pressed) has no
  // `startedAt` at all, so the silence clock had nothing to measure from and
  // never fired: the strip reassured the user with "Listening for speech."
  // indefinitely, exactly the class of bug this module exists to eliminate,
  // reappearing inside its own fix. `liveSince` is the caller's own "Start
  // was pressed" timestamp — a second, earlier clock that exists for
  // exactly this gap.
  liveSince,
  now = Date.now(),
  speakerSnapshot,
} = {}) {
  if (!live) return { status: "off", label: "", text: "" };

  const interim = activeInterim(interims);
  if (interim) {
    return {
      status: "heard",
      label: interim.key === "them" ? "Them" : "You",
      text: truncate(interim.text),
    };
  }

  const last = lastValidFinal(finals);
  // AC-S3.3/D2: silence is measured from the last thing actually heard — a
  // final turn if one exists. Without one, it runs from the LATER of
  // `liveSince` and `startedAt`: a slow connect (liveSince well before
  // startedAt) must not let the clock run from the moment Start was
  // pressed once the session actually goes live, or a normal connect delay
  // would make the strip cry wolf the instant it does. Neither value being
  // a real number at all (no clock, not even a connecting session) is not
  // evidence of silence — `since` stays `null` and the threshold check
  // below is skipped entirely, the same "never breaks the page" contract
  // AC-S3.5 already pins.
  let since = null;
  if (last) {
    since = last.at;
  } else {
    const clocks = [startedAt, liveSince].filter((v) => Number.isFinite(v));
    if (clocks.length) since = Math.max(...clocks);
  }
  const elapsed = Number.isFinite(now) && Number.isFinite(since) ? now - since : null;

  if (elapsed !== null && elapsed >= HEARD_NOTHING_AFTER_MS) {
    return {
      status: "silent",
      label: "",
      text: "No speech has been detected in a while. The copilot may not be hearing anything.",
    };
  }

  if (last) {
    return {
      status: "heard",
      label: labelForFinal(last, speakerSnapshot),
      text: truncate(asText(last.text).trim()),
    };
  }

  // AC-S3.2: quiet, but not yet long enough to say anything is wrong —
  // waits rather than crying wolf in the first few seconds of a session.
  return { status: "waiting", label: "", text: "Listening for speech." };
}
