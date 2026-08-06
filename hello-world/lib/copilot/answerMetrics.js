// Pure, deterministic scoring of one recorded practice answer's DELIVERY —
// pace, filler words, structure, and (via the video summary) lighting and
// motion. This is strictly the measurable half: judging the answer's
// SUBSTANCE is feature C4, built on top of the numbers this module produces,
// not part of it. No Date.now(), no randomness — computeAnswerMetrics is a
// straight function of its arguments, every time.

import { profileMetric } from "./answerLocal";
import { summarizeVideoStats } from "./videoStats";

// Unambiguous fillers: hesitation markers with essentially no legitimate use
// as ordinary words, so every occurrence is safe to count as a filler.
// Case-insensitive, matched on word boundaries so a filler never fires
// inside a larger word ("unlike" must never count "like") or across a
// hyphen ("right-hand" must never count "right" — see phraseRegex). Multi-
// word phrases match with flexible whitespace between their words, so
// "you  know" (a hesitant pause mid-phrase) still counts.
export const FILLER_PHRASES = ["um", "uh", "er", "you know", "sort of", "kind of", "i mean"];

// Ambiguous discourse markers: also ordinary words with common, legitimate
// uses ("I like Python", "the right approach", "it actually shipped"), so
// counting every occurrence as a filler would systematically overstate the
// count and there would be no way for the user to tell which occurrences
// were real hesitation versus normal speech. Counted and reported
// separately from FILLER_PHRASES for exactly that reason — see BUG-7.
export const DISCOURSE_MARKER_PHRASES = ["like", "right", "actually", "basically", "literally"];

// wpm bands for paceLabel, chosen around typical interview speech: most
// candidates land around 120-160 wpm when speaking deliberately; below ~110
// reads as slow/hesitant to a listener, above ~170 reads as rushed. The
// bands are deliberately wide — this is a coarse delivery signal, not a
// toastmasters score.
//
// Exported so live mode's rolling pace reading (lib/copilot/livePace.js)
// uses this SAME pair rather than restating the numbers — two copies of a
// threshold would drift, and then practice mode and live mode would
// disagree about what "rushed" means for the same speaker.
export const SLOW_WPM_MAX = 110;
export const RUSHED_WPM_MIN = 170;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `\b` treats a hyphen as a word boundary (it is a non-word character), so a
// plain `\bright\b` matches "right" inside "right-hand" — a real compound
// word, not a filler. Lookaround requiring a non-letter/digit/hyphen on
// each side closes that hole while still allowing normal punctuation and
// whitespace boundaries to match.
function phraseRegex(phrase) {
  const pattern = phrase.split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(?<![a-z0-9-])${pattern}(?![a-z0-9-])`, "gi");
}

// Shared by both the unambiguous-filler and discourse-marker passes: counts
// each phrase's occurrences in `text` and returns the per-phrase breakdown
// (highest count first) plus the total.
function countPhrases(text, phrases) {
  let total = 0;
  const matches = [];
  for (const phrase of phrases) {
    const found = text.match(phraseRegex(phrase));
    const count = found ? found.length : 0;
    if (count > 0) {
      matches.push({ phrase, count });
      total += count;
    }
  }
  matches.sort((a, b) => b.count - a.count);
  return { total, matches };
}

// Deepgram's punctuate/smart_format params (see deepgram.js) mean finalized
// speech is usually already sentence-punctuated; text with no terminal
// punctuation at all just comes back as a single sentence, which is the
// right fallback rather than 0.
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Exported so livePace.js counts words the same way this module does —
// whitespace split, filtering empties — instead of restating the algorithm
// and risking the two drifting apart on some edge case (tabs, repeated
// spaces) neither module's author thought to test.
export function countWords(s) {
  const trimmed = s.trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

// The wpm -> label mapping alone, WITHOUT the "was pace even measured"
// guard computeAnswerMetrics applies before calling this (see there: when
// speechDurationSec <= 0 or wordCount === 0, the label is "conversational"
// by fallback, not because wordsPerMinute — which is 0 in that case —
// genuinely landed in the conversational band). Exported so livePace.js
// derives a label from a wpm value using the exact same bands and the
// exact same boundary rules (`<`/`>`, not `<=`/`>=`) practice mode uses,
// rather than restating them (AC-I2.12).
export function paceLabelFor(wordsPerMinute) {
  if (wordsPerMinute < SLOW_WPM_MAX) return "slow";
  if (wordsPerMinute > RUSHED_WPM_MIN) return "rushed";
  return "conversational";
}

// Signature/shape is a contract with feature C4, which consumes this
// output — see AC-C3-3. `speechDurationMs` and `micMuted` were added for
// BUG-1/BUG-6: additive fields, the original ones are unchanged in meaning.
export function computeAnswerMetrics({ text, durationMs, speechDurationMs, video, micMuted = false } = {}) {
  const clean = String(text || "").trim();
  const wordCount = countWords(clean);

  // durationSec is wall clock between "Start answering" and "Done" — the
  // answer length as the user experienced it. It is deliberately NOT used
  // for pace below: see speechDurationSec.
  const durationSec = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;

  // speechDurationSec is the span the collected words actually cover (last
  // word's audio end minus first word's audio start), supplied by the
  // caller from Deepgram's per-final timing. Wall-clock duration includes
  // silence before the first word and after the last — dividing word count
  // by IT instead of the speech span was BUG-1c: an answer delivered at a
  // normal pace, bookended by a couple of seconds of silence, came out
  // labeled "slow". The two are kept as separate fields rather than one
  // silently standing in for the other.
  const speechDurationSec =
    Number.isFinite(speechDurationMs) && speechDurationMs > 0 ? speechDurationMs / 1000 : 0;

  const wordsPerMinute = speechDurationSec > 0 && wordCount > 0 ? (wordCount / speechDurationSec) * 60 : 0;
  // The guard stays here rather than moving into paceLabelFor: with no
  // measured speech span (or no words), wordsPerMinute is 0 above, and 0
  // would land in the "slow" band if run through paceLabelFor's plain
  // threshold check — "conversational" is the deliberate fallback for "not
  // enough to judge," not a claim that 0 wpm was actually measured.
  const paceLabel = speechDurationSec <= 0 || wordCount === 0 ? "conversational" : paceLabelFor(wordsPerMinute);

  const { total: fillerCount, matches: fillers } = clean
    ? countPhrases(clean, FILLER_PHRASES)
    : { total: 0, matches: [] };
  const fillerRate = wordCount > 0 ? (fillerCount / wordCount) * 100 : 0;

  const { total: discourseMarkerCount, matches: discourseMarkers } = clean
    ? countPhrases(clean, DISCOURSE_MARKER_PHRASES)
    : { total: 0, matches: [] };
  const discourseMarkerRate = wordCount > 0 ? (discourseMarkerCount / wordCount) * 100 : 0;

  const sentences = clean ? splitSentences(clean) : [];
  const sentenceCount = sentences.length;
  const longestSentenceWords = sentences.reduce((max, s) => Math.max(max, countWords(s)), 0);

  const hasMetric = !!profileMetric(clean);

  // The caller (PracticeClient) hands this the already-computed summary
  // from VideoFrameSampler.stop() — pass it through as-is, or fall back to
  // a zeroed summary (hadVideo: false, every flag false) when none was
  // given, so this function's return shape never depends on whether a
  // camera was involved at all.
  const videoSummary = video && typeof video === "object" ? video : summarizeVideoStats();

  return {
    wordCount,
    durationSec,
    speechDurationSec,
    wordsPerMinute,
    paceLabel,
    fillerCount,
    fillerRate,
    fillers,
    discourseMarkerCount,
    discourseMarkerRate,
    discourseMarkers,
    hasMetric,
    sentenceCount,
    longestSentenceWords,
    // Whether the mic was muted at any point between Start and Done — the
    // caller tracks this (it isn't derivable from the text itself). True
    // means word count, filler counts, and pace are all understated: real
    // words were said into a muted mic and never transcribed at all.
    micMuted: !!micMuted,
    video: videoSummary,
  };
}
