// SERVER-SIDE PROVENANCE FILTERS for expansion sub-bullets.
//
// expansionContract.js answers "is this a speakable sentence?". This module
// answers the other half, and it is the half that can only be answered on the
// server: "may this sentence be spoken as the CANDIDATE'S OWN EXPERIENCE, and
// is every specific in it actually theirs?" It needs the source material, and
// the client is deliberately never given any.
//
// APPLIED ON BOTH ENGINES. The deterministic drafter quotes whole page lines
// and passes trivially. Running it there anyway is what makes the guarantee a
// property of the RESPONSE rather than of which branch produced it, so a
// future third producer inherits it instead of being trusted.
//
// THE ONE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE. Containment is
// not sufficient, and the contact-shape reject list is not redundant with it.
// A hostile job posting reaches the candidate's resume through the tailor
// pipeline, and from there it reaches this prompt as "the candidate's own
// material". A posting that asks for the candidate's home address produces
// model output every token of which IS in the material, so the containment
// check below would positively certify it. checkContactShapes is the only
// control that stops that, and no amount of provenance checking replaces it.
//
// EVERY SOURCE QUESTION IS ASKED AGAINST ONE NAMED UNIT, never a concatenation
// of everything the server holds. `combineMaterial` is a concatenator that
// performs no check and omits page bullets entirely; certifying against the
// joined corpus is precisely how a figure from one project gets transplanted
// onto another, which is a defect this repo has already shipped once.

import { literallyMentioned, isPastWorkLine, MOTIVATION_LINE_RE } from "./answerLocal.js";
import { materialQuote, materialTokenCount } from "./materialQuote.js";
import { normalizeForComparison, stripStarLabel } from "./answerPoints.js";
import { FIRST_PERSON_RE } from "./questionVocabulary.js";
import { significantTerms } from "./projectStories.js";

// Every numeral-shaped run: a digit, then any digits, commas or stops, then an
// optional percent sign. Tokenised EXPLICITLY so the rule is testable rather
// than implied, and so "2043 in the unit" cannot license "43" in a sub-bullet:
// the comparison is between matches of the SAME regex on both sides, not
// substring containment.
const NUMERAL_RE = /\d[\d,.]*%?/g;

// The contact-shape reject list. Each of these is a shape a candidate's
// PERSONAL DETAILS take, and none of them is something a sub-bullet about work
// the candidate did needs to contain.
const CONTACT_SHAPES = [
  /\S+@\S+\.\S+/, // an email address
  /https?:\/\//i, // a URL
  /\bwww\./i, // a bare host
  /\+?\d[\d ()-]{7,}\d/, // a phone-shaped run
  /\d{9,}/, // a long digit run: account, national id, card
  /\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/,
];

function numeralsOf(text) {
  return String(text || "").match(NUMERAL_RE) || [];
}

function unitLines(unit) {
  if (!unit || typeof unit !== "object") return [];
  return (Array.isArray(unit.lines) ? unit.lines : []).filter((l) => typeof l === "string" && l.trim());
}

/**
 * Is every numeral in `text` one the NAMED unit actually contains?
 *
 * Whitespace is normalised before comparison and nothing else is: "43%" and
 * "43" are different figures and a filter that conflated them would let a
 * percentage be invented out of a count.
 */
function numeralsScopedToUnit(text, lines) {
  const wanted = numeralsOf(text);
  if (wanted.length === 0) return true;
  const available = new Set();
  for (const line of lines) for (const n of numeralsOf(line)) available.add(n);
  return wanted.every((n) => available.has(n));
}

/**
 * Is `text` quoted WHOLE out of a single line of the unit?
 *
 * `materialQuote` reports the longest contiguous run of normalised tokens the
 * text shares with any ONE line, and never stitches a run across two lines.
 * Requiring that run to be the text's entire token count is therefore exactly
 * "this sentence appears, in order, inside one line of one named unit".
 *
 * Both sides count with the SAME normalisation, which is why materialQuote.js
 * exports its token counter: a whitespace word count on one side and a
 * normalised token count on the other is wrong in both directions.
 */
function isQuotedWhole(text, lines) {
  const need = materialTokenCount(text);
  if (need === 0) return false;
  return materialQuote(text, lines).words >= need;
}

/**
 * A sentence the model COMPOSED rather than quoted may still be honest, but it
 * has to earn it: every distinctive term it names must literally occur in the
 * named unit, it has to read as past work rather than motivation, and its
 * numerals are scoped by the caller above.
 *
 * `literallyMentioned` is the repo's own term check and carries the recorded
 * "team" -> "Microsoft Teams" hazard: a bare substring test says the material
 * mentions "team" when all it contains is a product name.
 */
function composedPasses(text, lines) {
  const material = lines.join("\n");
  for (const term of significantTerms(text)) {
    if (!literallyMentioned(term, material)) return false;
  }
  return isPastWorkLine(text);
}

function checkContactShapes(text) {
  return !CONTACT_SHAPES.some((re) => re.test(text));
}

/**
 * The sub-bullets that may be shown, out of the ones a producer offered.
 *
 * @param candidates  `[{ text, ... }]` or `["..."]`
 * @param unit        the ONE named source unit this expansion is allowed to
 *                    draw from: `{ kind, pageId, pageTitle, lines }`
 * @param parentPoint the bullet being elaborated
 * @param corpusLines material from ELSEWHERE, used only to make the "in the
 *                    corpus but not in this unit" case explicit in tests. It is
 *                    never a source: nothing here ever certifies against it.
 *
 * Returns kept entries `{ text, pageId, source }`, in the order offered.
 * Total by construction: never throws.
 */
export function filterExpansionCandidates(candidates, { parentPoint = "", unit } = {}) {
  const lines = unitLines(unit);
  if (lines.length === 0) return [];

  const parentKey = normalizeForComparison(stripStarLabel(parentPoint));
  const pageId = unit && typeof unit.pageId === "string" ? unit.pageId : null;
  const kind = unit && typeof unit.kind === "string" ? unit.kind : "page";

  const kept = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const text = (typeof candidate === "string" ? candidate : candidate?.text) || "";
    const trimmed = String(text).trim();
    if (!trimmed) continue;

    // 1. THE EXFILTRATION CONTROL, first because it is the one containment
    //    cannot do. See this file's header.
    if (!checkContactShapes(trimmed)) continue;

    // 2. It is the candidate speaking about themselves.
    if (!FIRST_PERSON_RE.test(trimmed)) continue;

    // 3. It is not a restatement of the bullet the reader clicked.
    if (normalizeForComparison(trimmed) === parentKey) continue;

    // 4. It is about work done, not about work wanted.
    //
    //    UNCONDITIONAL, DELIBERATELY, and NOT scoped to the composed branch
    //    below. This is a fact about what the sentence IS, not about where it
    //    came from: a candidate's own page can carry "I want to work on
    //    settlement systems at a larger scale.", and quoting it whole makes it
    //    perfectly provenanced and still not further detail about what they
    //    did. Scoping this to composed output let exactly that through, which
    //    is how the case was found.
    if (MOTIVATION_LINE_RE.test(trimmed)) continue;

    // 5. Every figure in it is a figure the NAMED unit carries.
    if (!numeralsScopedToUnit(trimmed, lines)) continue;

    // 6. It is either quoted whole out of one line, or composed and earning
    //    it. Nothing else reaches the screen.
    if (!isQuotedWhole(trimmed, lines) && !composedPasses(trimmed, lines)) continue;

    kept.push({
      text: trimmed,
      pageId: kind === "page" ? pageId : null,
      source: { kind, pageId: kind === "page" ? pageId : null },
    });
  }

  return kept;
}
