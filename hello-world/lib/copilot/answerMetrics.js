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

// Rate bands for fillerLabel (fillers per hundred words). 1% is roughly one
// hesitation marker per hundred words — a listener does not register that as
// a pattern; 5% is one in twenty, which reads as an audible verbal tic.
//
// Deliberately NOT the same constants as critiqueLocal.js's
// FILLER_RATE_GOOD_PCT / FILLER_RATE_BAD_PCT, even though both pairs bound
// "clean" versus "heavy" filler use. Those two are the endpoints of a
// continuous SCORE ramp (100 down to 30); these two are the boundaries of a
// LABEL a person reads. Merging them would force one pair of numbers to
// serve two different jobs — a score ramp wants a wide span to grade inside,
// a label wants the "heavy" boundary set at the point a listener would
// actually call it a tic, and there's no reason those two design goals
// should land on the same number.
export const FILLER_RATE_CLEAN_MAX = 1;
export const FILLER_RATE_HEAVY_MIN = 5;

// R-127: a hard ceiling on what a computed wpm can possibly mean, distinct
// from RUSHED_WPM_MIN above — RUSHED_WPM_MIN is a delivery judgement ("this
// person is talking fast"); this is a physical-plausibility judgement ("no
// person is talking at all"). Sustained conversational speech tops out
// around 250 wpm even for a naturally fast talker; 300 gives that real
// upper end a wide margin while still catching a number no human voice can
// produce. A wpm above this is not evidence of a fast talker, it's evidence
// of a MEASUREMENT fault — the production case this constant exists for was
// the ElevenLabs adapter double-emitting every committed utterance, which
// doubled wordCount while speechDurationSec (a min/max span, idempotent
// under exact duplication) stayed the same, reporting 367 wpm for a true
// pace of ~184 wpm. See computeAnswerMetrics's `paceIsPlausible` below and
// lib/copilot/critiqueLocal.js's normalizeMetrics, which independently
// re-derives this same check server-side rather than trusting a client's
// own claim.
export const MAX_PLAUSIBLE_WPM = 300;

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
//
// Exported for the same reason `countWords` and `paceLabelFor` already are:
// so livePace.js counts fillers with this SAME matcher rather than
// restating it. The lookaround inside phraseRegex is specifically the part
// that must not be re-implemented by eye — a plain `\b` boundary matches
// "um" inside "summary" and "right" inside "right-hand", and a rewritten
// version could easily reintroduce exactly that.
export function countPhrases(text, phrases) {
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

// The FILLER_RATE_CLEAN_MAX/FILLER_RATE_HEAVY_MIN -> label mapping, alone,
// exported so livePace.js's rolling filler reading derives a label the same
// way this module's own callers eventually will, rather than re-deriving
// one from the two constants by hand (the same "one source of the mapping"
// reasoning paceLabelFor above exists for).
//
// Boundaries are INCLUSIVE at both ends — at or below FILLER_RATE_CLEAN_MAX
// is "clean", at or above FILLER_RATE_HEAVY_MIN is "heavy" — which is the
// opposite of paceLabelFor's strict `<`/`>` above. That is deliberate, not
// an inconsistency to "fix": the difference is in the names. A "MAX for
// clean" is a ceiling clean is allowed to touch; a wpm band edge is just
// where one band's territory ends and the next one's begins.
export function fillerLabelFor(rate) {
  if (rate <= FILLER_RATE_CLEAN_MAX) return "clean";
  if (rate >= FILLER_RATE_HEAVY_MIN) return "heavy";
  return "noticeable";
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
  // R-127: a FLAG, not a clamp — see MAX_PLAUSIBLE_WPM's own comment above
  // for why a clamp would be the wrong fix (it would render a measurement
  // fault as a plausible-looking, wrong number instead of an honest "this
  // reading can't be trusted"). Trivially true whenever wordsPerMinute is 0
  // (no pace was measured at all) — there is nothing implausible about "no
  // reading". Does not affect paceLabel or any score: a measurement fault
  // must stop being reported as a delivery fault, not move one.
  const paceIsPlausible = wordsPerMinute <= MAX_PLAUSIBLE_WPM;

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
    paceIsPlausible,
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
