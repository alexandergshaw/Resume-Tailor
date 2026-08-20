// AC-Q3 - "About 96 words - roughly 41 seconds at a measured pace."
//
// The "Speak as" role drill needs to tell the user roughly how long its
// model answer takes to say out loud. Live mode and practice mode already
// have an opinion on what a "measured" spoken pace is - SLOW_WPM_MAX and
// RUSHED_WPM_MIN in answerMetrics.js, the boundaries of the "conversational"
// band paceLabelFor uses. This module reuses that SAME pair (their midpoint)
// rather than picking its own pace number, so all three surfaces describe
// "how long will this take to say" the same way. Restating 110/170 (or their
// midpoint, 140) here would let this module silently drift from the other
// two the next time someone retunes those bands.
//
// Deliberately dumb about its input: the drill wants to estimate a plain
// string, an array of situation-beat strings, or the `{label, text}[]` line
// shape roleResponse.js returns - so all three are accepted, and anything
// else (missing beats, a network error's undefined, a stray non-string
// entry) degrades to a zero estimate instead of throwing. A drill screen
// that crashes because the model answer had not loaded yet would be worse
// than one that briefly reads "About 0 words."

import { SLOW_WPM_MAX, RUSHED_WPM_MIN, countWords } from "./answerMetrics.js";

// Fixed for the lifetime of the module: SLOW_WPM_MAX/RUSHED_WPM_MIN are
// static exports, not something that changes per call, so there is no
// reason to recompute this per invocation of spokenEstimate.
const TARGET_WPM = (SLOW_WPM_MAX + RUSHED_WPM_MIN) / 2;

// Reduces the string | string[] | {text}[] union down to one joined string.
// A non-string, non-object array entry (null, a number, an object with no
// `text`) contributes nothing rather than throwing or stringifying into
// garbage like "[object Object]".
function joinedTextOf(input) {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  return input
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.text === "string") return item.text;
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

// countWords (answerMetrics.js) splits on whitespace and counts every
// resulting token - correct for its own callers, which measure a SPOKEN
// transcript, where a lone "-" token basically never occurs. This module
// measures WRITTEN model answers, which follow this codebase's own house
// style of spaced dashes ("one person's fault - I own the call"). Left
// alone, each of those spaced dashes counts as a full spoken word and
// inflates both the word count and the seconds derived from it. Nobody
// says a dash out loud, so a whitespace-delimited token with no letter and
// no digit in it (a bare "-", "--", "...", etc.) is dropped before the text
// ever reaches countWords. For ordinary prose - no token that is pure
// punctuation - this removes nothing, so the result is byte-for-byte what
// countWords(text) would have returned; that equivalence for ordinary text
// is deliberate, not incidental.
function droppingBarePunctuationTokens(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token && /[\p{L}\p{N}]/u.test(token))
    .join(" ");
}

export function spokenEstimate(input) {
  const text = droppingBarePunctuationTokens(joinedTextOf(input));
  const words = countWords(text);
  const seconds = words > 0 ? Math.round((words / TARGET_WPM) * 60) : 0;
  return { words, seconds, wpm: TARGET_WPM };
}
