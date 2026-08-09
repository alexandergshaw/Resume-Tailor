// Which finals collected during a practice-mode answer belong to the
// CANDIDATE, once that answer's single microphone is diarized (AC-M2), and
// the metrics inputs (text + speech span) derived from that split. A pure
// module: no React, no DOM, no browser globals — every function here is a
// straight function of its arguments, importable from this repo's node-only
// vitest config the same way answerWindow.js and speakerIdentity.js already
// are. This file used to carry "no imports at all" as part of that claim;
// answerMetricsInputs below now imports deriveSpeechSpan from
// ./answerWindow, which is fine because that function is the same kind of
// module — pure, node-only, argument-in/value-out — so importing it doesn't
// bring React/DOM back in the door. It exists so the span arithmetic stays
// defined in exactly one place instead of being copied here a second time.
//
// *** WHY THIS EXISTS — READ BEFORE CHANGING THE DOMINANCE RULE ***
// Practice mode records from ONE microphone and reports delivery metrics —
// word count, words per minute, filler rate — on whatever that mic captured.
// Once the mic is diarized, a mock interviewer (or a real one sitting across
// the table) lands in the same transcript stream as the candidate. Letting
// their words into the answer window is not a crash and does not look
// broken: it is a WRONG NUMBER presented confidently. This repo has already
// shipped exactly that class of defect once — an STT bug counted every
// utterance twice, so a 98-word answer measured 196 words at 367 wpm and the
// critique told the user to be more concise and slow down. Both numbers were
// artifacts (R-127). It hid for as long as it did because duration is a
// min/max over spans and is IDEMPOTENT under contamination, while word count
// is a SUM — so the numbers stayed superficially coherent while one of them
// was wrong. A speaker who leaks into "mine" reproduces that exact failure
// shape through a different door, so this module is the one thing standing
// between a diarized stream and that class of bug recurring.
//
// The compatibility rule that keeps practice mode unchanged for the
// overwhelmingly common case (no in-person setup, or a provider that can't
// diarize at all — see stt/index.js's diarizationActive): a final with NO
// speaker tag is ALWAYS the candidate's. That makes "no diarization" a
// special case of the general rule rather than a separate branch that could
// drift from it, and it means a final the provider could not attribute is
// never silently dropped from the candidate's own word count — dropping it
// would UNDERSTATE the answer, which is the same class of dishonest number
// as over-counting it.

import { deriveSpeechSpan } from "./answerWindow";

// Plain whitespace word count. Deliberately a local copy rather than an
// import — this module's original contract was "no imports at all" (see
// header for why that's now down to the one import above), so a second
// trivial splitter here is still correct, the same call speakerIdentity.js
// already made for its own countWords and for the same reason.
function countWords(text) {
  const trimmed = String(text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Deepgram/ElevenLabs speaker tags are small integers, but AC-M2 puts no
// constraint on the type beyond "present or absent" — untagged is the only
// state this module treats specially. `undefined` (the field omitted
// entirely, as every existing non-diarized final already arrives) and
// `null` both mean "no tag"; `0` is a real tag (speaker id zero) and must
// NOT be treated as falsy-and-therefore-untagged, or the very first voice a
// diarizing provider numbers would be silently merged into "mine" no matter
// who was actually talking.
function isUntagged(tag) {
  return tag === undefined || tag === null;
}

// Which speaker tag dominated the TAGGED portion of `finals`, measured in
// WORDS spoken under that tag — not in how many finals carried it. An
// interviewer interjecting "Right" / "Mhm" / "Got it" three separate times
// must not outrank one long answer just because it produced more finals;
// only total words spoken settles it (see
// "measures dominance by WORDS, not by how many times each voice spoke" in
// answerSpeakers.test.js).
//
// Ties resolve to whichever tag's WORDS were tallied first, which — because
// `finals` arrives in speech order and this function only ever swaps the
// leader on a STRICTLY GREATER total — is exactly the tag that appears
// earliest in the list. That is a deliberate, not incidental, proxy for "the
// candidate is the one who began speaking when they pressed Start
// answering" (see "resolves a tie to whoever started the answer" in
// answerSpeakers.test.js): the candidate's own tag is, in practice, the tag
// attached to whichever final an answer window starts with.
//
// Returns `null` when no final in the list carries a tag at all — there is
// nothing to be dominant OVER, and the untagged path never reaches this
// function's return value in the first place (see partitionAnswerFinals).
function dominantTag(finals) {
  const wordsByTag = new Map();

  for (const final of finals) {
    const tag = final?.speakerTag;
    if (isUntagged(tag)) continue;
    wordsByTag.set(tag, (wordsByTag.get(tag) || 0) + countWords(final?.text));
  }

  let winner = null;
  let winnerWords = -Infinity;
  // Map iterates in insertion order, and a tag is inserted the first time it
  // is encountered — i.e. in the SAME order those tags first appear in
  // `finals`. Only updating on `>` (never `>=`) means the first tag to reach
  // the current maximum keeps the win, which is exactly the tie-break this
  // function documents above.
  for (const [tag, words] of wordsByTag) {
    if (words > winnerWords) {
      winner = tag;
      winnerWords = words;
    }
  }
  return winner;
}

// AC-M2's public surface. Splits the finals collected during one practice
// answer into `{ mine, others, myTag }`:
//
//   mine   — every untagged final (see the header comment for why that is
//            unconditional), plus every final carrying the DOMINANT tag.
//   others — every final carrying a tag that is not the dominant one.
//   myTag  — the dominant tag itself (dominantTag's own return value,
//            `null` when nothing in `finals` carried a tag at all). This is
//            practice mode's strongest identity signal: the voice that
//            dominated an answer window is, by definition, the candidate's
//            own — see answerMetricsInputs below, which is what actually
//            surfaces this to a caller, and roomQuestions.js, which is what
//            later CONSUMES it to tell the candidate's own voice apart from
//            someone else in the room.
//
// Order within each half is preserved exactly as it appeared in `finals`.
// This matters downstream, not just cosmetically: deriveSpeechSpan
// (answerWindow.js) takes the FIRST timed entry in list order as an answer's
// start, not the minimum value — sorting or otherwise reordering here would
// silently move an answer's reported start time.
//
// `finals` is never mutated — this function only reads it and pushes its
// entries (by reference, unchanged) into two new arrays. A null/undefined
// list is tolerated (treated as empty) rather than thrown on, since this
// runs mid-answer and a defensive caller should never have an empty answer
// turn into a crash.
export function partitionAnswerFinals(finals) {
  const list = Array.isArray(finals) ? finals : [];
  const winner = dominantTag(list);

  const mine = [];
  const others = [];
  for (const final of list) {
    const tag = final?.speakerTag;
    if (isUntagged(tag) || tag === winner) {
      mine.push(final);
    } else {
      others.push(final);
    }
  }
  return { mine, others, myTag: winner };
}

// R-127/AC-M2: everything usePracticeAnswer.js's doneAnswer needs to score
// one completed answer, derived from `collected` (every accepted final for
// that answer, candidate and anyone else in the room alike) in one place so
// it can be pinned by a test that can actually mount it — usePracticeAnswer
// is a React hook and this repo's vitest config has no jsdom, so nothing
// inside a hook is reachable from a test here (see
// answerMetricsInputs.test.js's own header for the full incident this
// module exists to prevent a repeat of).
//
// Splits FIRST via partitionAnswerFinals, then derives text and span from
// `mine` alone, never from `collected` — an interviewer's words leaking into
// either would reproduce R-127 (a 98-word answer measuring 196 words at
// 367 wpm) through a different door. The two numbers below inherit that
// asymmetry on purpose: `text`/`lines` is effectively a SUM over the
// candidate's finals and moves a lot under contamination, while
// `speechDurationMs` is a min/max over spans and barely moves — which is
// exactly why a test must cover the span independently of the word count
// (see the "spans only the candidate's own speech" case in
// answerMetricsInputs.test.js) rather than trusting that one being right
// implies the other is too.
//
// `speechDurationMs`'s `firstStart`/`lastEnd` !== null checks and the
// `Math.max(0, ...)` clamp are both load-bearing, not defensive filler:
// deriveSpeechSpan returns null/null (never NaN) when nothing in `mine` was
// timed, so the !== null checks are what keep that case reporting 0 instead
// of NaN propagating into computeAnswerMetrics' wpm math; the clamp is what
// keeps a pathological/out-of-order timing pair from reporting a NEGATIVE
// duration, which would flip the sign of every rate computed from it rather
// than merely being wrong in magnitude. Both have their own case in
// answerMetricsInputs.test.js and neither may be simplified away.
//
// Returns `{ lines, text, speechDurationMs, mine, others, myTag }`. `lines`
// and `others` are handed straight to setAnswerTranscript/setOtherSpeakerFinals
// by the caller; `text` (`lines.join(" ")`) and `speechDurationMs` are the
// exact two values computeAnswerMetrics is called with — this function does
// not compute metrics itself, only their inputs, so answerMetrics.js stays
// untouched by this feature.
//
// `myTag` rides straight through from partitionAnswerFinals's own return —
// it already computes the dominant tag internally (as `winner`) to decide
// the mine/others split, so this surfaces that existing value rather than
// calling dominantTag a second time. `null` means nothing in `collected`
// carried a speaker tag at all (no diarization, or an empty answer) — never
// treated as "no signal learned" versus a REAL tag, since a diarizing
// provider's first voice is commonly tag `0`, which is falsy but still a
// genuine answer (see partitionAnswerFinals/dominantTag's own isUntagged
// checks, which compare against `undefined`/`null` explicitly rather than
// with a truthiness test, for exactly this reason).
export function answerMetricsInputs(collected) {
  const { mine, others, myTag } = partitionAnswerFinals(collected);
  const lines = mine.map((final) => final.text);
  const { firstStart, lastEnd } = deriveSpeechSpan(mine);
  const speechDurationMs =
    firstStart !== null && lastEnd !== null ? Math.max(0, (lastEnd - firstStart) * 1000) : 0;

  return { lines, text: lines.join(" "), speechDurationMs, mine, others, myTag };
}
