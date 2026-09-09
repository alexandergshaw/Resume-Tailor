// "Is this text the candidate's OWN work, and if so which line of their
// material did it come from?" — the two halves of that one question, in one
// module, because a header predicate living inside one of the two drafters
// would be re-derived by the other.
//
// NAMING. `answerGrounding.js` one file over means ANSWER-CACHE grounding
// (groundingFor / sameGrounding / cachedAnswerFor) and `answerProvenance.js`
// means VIDEO provenance, so a text-provenance module called
// `pointGrounding.js` would collide an already-overloaded word twice.
// *Quote* and *material* are this codebase's own words for this:
// combineMaterial (answerLocal.js) builds the string, and the question is
// "how many words of this point are quoted verbatim from ONE line of the
// candidate's own material?".
//
// NO DATE PATTERN AND NO TITLE VOCABULARY IS DECLARED HERE. headerDateSpan
// and TITLE_KEYWORDS_RE are imported from lib/resume/parseEmployment.js, which
// is where résumé date and job-noun patterns already live; a second copy of
// either, in the module that CLASSIFIES headers, is the copy that drifts from
// the one that PARSES them. The numeric gates come from pointLength.js for the
// same reason (AC-D.1): not one threshold is written as a literal below.
//
// MODULE-CYCLE DISCIPLINE. pointLength.js imports answerLocal.js (for
// ACHIEVEMENT_VERBS) and answerLocal.js imports this module (for the header
// demotion), so this file sits inside an ES module cycle. Every reference to
// an imported binding below is INSIDE a function body, never at top level.
// Keep it that way: a top-level read of, say, HEADER_TITLECASE_RATIO throws a
// TDZ ReferenceError whenever the cycle is entered through pointLength.js.

import { headerDateSpan, TITLE_KEYWORDS_RE } from "@/lib/resume/parseEmployment";
import {
  GROUNDED_SPAN_MIN_WORDS,
  HEADER_TITLECASE_RATIO,
  MAX_HEADER_TAIL_WORDS,
  MIN_HEADER_SEGMENTS,
} from "./pointLength.js";

// The same leading-marker strip cleanLine (answerLocal.js) performs, so a
// bulleted header and a bare one get the same verdict.
const BULLET_STRIP_RE = /^[\s•\-*–—>]+/;

// The punctuation a header uses to set its date off from the text in front of
// it, peeled off the head; and the punctuation that can lead whatever follows
// the date, peeled off the tail.
const HEAD_TRAILING_PUNCT_RE = /[\s|,;:([–—-]+$/;
const TAIL_LEADING_PUNCT_RE = /^[\s|,;:.)\]–—-]+/;

// A header is a sequence of noun-phrase SEGMENTS ("<title>, <employer>",
// "<title> | <employer>"). An achievement clause is one segment.
const SEGMENT_SPLIT_RE = /\s*(?:,|\||\t|\s[–—]\s|\s{2,})\s*/;

// Morphology, not a vocabulary: the endings an English verb form takes. Used
// only to ask whether a SINGLE-segment head opens on a verb, which makes it a
// clause rather than a title.
const VERB_SHAPED_RE =
  /(?:ed|ing|ised|ized|ght|ilt|ade|ook|ave|ent|elt|ept|old|ew|ut|ot|un|ang|ank)$/i;

// Dropped before the title-case ratio is measured: they are lowercase inside
// perfectly ordinary headers ("Director of Engineering", "Head of Platform").
const TITLE_CONNECTIVES = new Set(["of", "and", "&", "for", "the", "at", "in", "on", "to", "with"]);

function wordsIn(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

// The share of a head's ratio-bearing tokens that are capitalised, or `null`
// when there are too few tokens to measure one.
//
// THE FIRST TOKEN IS EXCLUDED because cleanLine (answerLocal.js:127)
// lowercases the leading word on the candidate path, so a header arrives as
// "senior Engineer, Acme Payments" and its first token carries no information
// about how the line was written.
//
// A token is tested on its FIRST LETTER, not its first character: a
// parenthesised qualifier — "(Contract)", "(Part-time)", "(Maternity cover)" —
// is an ordinary résumé header shape, and /^[A-Z]/ scores it as lowercase.
function titleCaseRatio(head) {
  const tokens = wordsIn(head)
    .slice(1)
    .filter((t) => /[A-Za-z]/.test(t))
    .filter((t) => !TITLE_CONNECTIVES.has(t.toLowerCase().replace(/[^a-z&]/g, "")));
  if (tokens.length < 2) return null;
  return tokens.filter((t) => /^[^A-Za-z]*[A-Z]/.test(t)).length / tokens.length;
}

/**
 * Is this line an EMPLOYMENT HEADER — a position/company/date line — rather
 * than something the candidate actually did?
 *
 * It matters because rankedExperienceLines scores a line on question overlap
 * plus `hasSignal = /\d/.test(s) || ACHIEVEMENT_VERBS.test(s)`, and a date
 * range is digits: a CV position header therefore out-ranks every
 * accomplishment bullet beneath it whenever the question shares no distinctive
 * term with either. A bullet grounded in a job title is grounded in nothing
 * useful, so consumers DEMOTE what this returns true for (AC-B.12) rather than
 * treating it as evidence.
 *
 * Five conjuncts, in the order they are cheapest to refute:
 *
 *   (1) the line carries a date, LOCATED rather than merely detected.
 *   (2) that date is TERMINAL — a header's date sits at the end, an
 *       achievement's sits inside the sentence with the achievement carrying
 *       on past it.
 *   (3) the head NAMES A JOB, word-anchored — unanchored, `head` matches
 *       inside "Overhead" and `Head` inside "Headcount".
 *   (4) the head is not a single-segment CLAUSE opening on a verb.
 *   (5) the head is TITLE-CASED, and ABSTAINS rather than rejects when it
 *       cannot measure a ratio — a head with fewer than two ratio-bearing
 *       tokens ("Engineer, Acme") is not evidence of prose, it is an absence
 *       of evidence, and (1)-(4) already carry the burden. That shape is a
 *       top-frequency résumé header and rejecting it put the defect above back
 *       in full.
 *
 * WHAT IT COSTS, measured and not hidden. On a 55-line hand-labelled probe set
 * it is 0 false positives and 2 false negatives (an all-lowercase header, and
 * a header with no date at all), and 0 of 12 on a proper-noun-dense
 * achievement class. But a verb-initial, title-cased, MULTI-segment
 * achievement that names a job — "Owned Sales Engineering, Support and
 * Onboarding | 2019 - 2022" — is indistinguishable from "<title>, <employer> |
 * <dates>" by structure alone, and is misread on 8 of 8 and 4 of 5 held-out
 * sets built to find it. Closing that class needs a real verb detector.
 * Demotion rather than deletion is what makes the residual survivable.
 *
 * RECORDED LIMITATION: a header longer than cleanLine's 140-character clamp
 * loses its date to the clamp and is invisible to this predicate.
 */
export function isEmploymentHeaderLine(line) {
  const s = String(line == null ? "" : line).replace(BULLET_STRIP_RE, "").trim();
  if (!s) return false;

  const span = headerDateSpan(s); // (1)
  if (!span) return false;

  const head = s.slice(0, span.start).replace(HEAD_TRAILING_PUNCT_RE, "");
  const tail = s.slice(span.end).replace(TAIL_LEADING_PUNCT_RE, "");

  if (tail !== "" && wordsIn(tail).length > MAX_HEADER_TAIL_WORDS) return false; // (2)
  if (!TITLE_KEYWORDS_RE.test(head)) return false; // (3)

  const firstWord = wordsIn(head)[0] || ""; // (4)
  const segments = head.split(SEGMENT_SPLIT_RE).map((seg) => seg.trim()).filter(Boolean);
  if (VERB_SHAPED_RE.test(firstWord) && segments.length < MIN_HEADER_SEGMENTS) return false;

  const ratio = titleCaseRatio(head); // (5)
  return ratio === null || ratio >= HEADER_TITLECASE_RATIO;
}

// lowercase, non-alphanumerics to spaces, split on whitespace — the one
// normalisation every span comparison in this chunk uses.
function normalizedTokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter(Boolean);
}

function longestRunIn(needle, haystack) {
  let best = 0;
  for (let i = 0; i < needle.length; i += 1) {
    for (let j = 0; j < haystack.length; j += 1) {
      let n = 0;
      while (i + n < needle.length && j + n < haystack.length && needle[i + n] === haystack[j + n]) n += 1;
      if (n > best) best = n;
    }
  }
  return best;
}

/**
 * How much of `text` is quoted VERBATIM out of one line of the candidate's own
 * material — the longest contiguous run of normalised tokens `text` shares
 * with a single line of `lines`, plus which line that was.
 *
 * Returns `{ words, line, lineIndex }`; `words` is 0 (and `line` is "",
 * `lineIndex` -1) whenever nothing reaches GROUNDED_SPAN_MIN_WORDS.
 *
 * THREE PROPERTIES THAT ARE THE WHOLE POINT:
 *
 *  * It is computed against a SLOT VALUE, never a composed point. A point
 *    whose only overlap with the material is its own template prose has no
 *    span at all — "Ground it in your hands-on experience with Distributed
 *    Systems, Node.js, PostgreSQL" used to score 6, four of those six tokens
 *    being the scaffold's own fixed words.
 *  * EMPLOYMENT HEADERS ARE OUT OF THE SOURCE SET. A point that quotes a job
 *    title is not grounded in anything the candidate did.
 *  * A run is never stitched across two lines. Three tokens of one line plus
 *    three of another is a quote of neither.
 *
 * THE LIMIT OF THIS METRIC, stated where it is defined because it is load-
 * bearing elsewhere: the source set is filtered with the SAME classifier that
 * orders the candidate list, so a point shipping a real accomplishment the
 * classifier misread as a header records as ungrounded BY DEFINITION. This
 * number cannot arbitrate a false positive, and no caller should read it as if
 * it could.
 */
/**
 * How many tokens `text` has under THIS module's normalisation.
 *
 * Exported because "is this text quoted WHOLE out of one line?" is
 * `materialQuote(text, lines).words === materialTokenCount(text)`, and that
 * comparison is only sound when both sides count the same way. A caller
 * reaching for a whitespace word count instead gets a check that is wrong in
 * both directions: "Cut CI time in-half" is four whitespace words and five
 * normalised tokens, so a whole quote is rejected, while a text with
 * punctuation-only words can make a PARTIAL run compare equal and be accepted.
 */
export function materialTokenCount(text) {
  return normalizedTokens(text).length;
}

export function materialQuote(text, lines) {
  const empty = { words: 0, line: "", lineIndex: -1 };
  const needle = normalizedTokens(text);
  if (!needle.length || !Array.isArray(lines)) return empty;

  let best = empty;
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] == null ? "" : lines[i]);
    if (!line.trim()) continue;
    if (isEmploymentHeaderLine(line)) continue;
    const run = longestRunIn(needle, normalizedTokens(line));
    if (run > best.words) best = { words: run, line, lineIndex: i };
  }

  return best.words >= GROUNDED_SPAN_MIN_WORDS ? best : empty;
}
