// THE MANDATORY OUTPUT GATE for a project bullet's detail. SERVER-ONLY.
//
// WHY A GATE AND NOT ONLY A PROMPT CLAUSE. The bullet is INVENTED (a hypothetical
// example project, never the candidate's own work) and the detail elaborates it
// in the third person. A detail that drifts into "You could say: 'I built the
// pipeline.'" hands the candidate a scripted claim about work they never did,
// which is the one lie that ends an interview. PROJECT_BULLET_DETAIL_SYSTEM bans
// that shape, but a prompt clause is not a control anyone can apply to what the
// model actually wrote. This module is: the route runs it on every non-embedded
// success, unconditionally, and what it returns is what the reader sees.
//
// THE DETECTOR IS NOT COPIED. The claim-shape list lives in exactly one module,
// techTermDetailHonesty.js, and this gate imports it together with the markup and
// sentence helpers. The need is identical (a claim-SHAPE filter, no source
// material required), so a second copy could only drift from the first.

import { isFirstPersonClaim, splitSentences, stripMarkup } from "./techTermDetailHonesty.js";

// Owner-tunable. Wider than a term's four because a bullet's elaboration covers
// what was done, how it might have gone and why it matters; still a few short
// sentences, never a page.
export const PROJECT_BULLET_DETAIL_MAX_SENTENCES = 6;

// A model stuck in a loop can return far more than a few sentences, and the strip
// below scans what it is given, so the input is bounded before it is scanned.
const MAX_RAW_CHARS = 4000;

/**
 * The model's detail -> the string that may be shown.
 *
 *   1. coerce a non-string to ""
 *   2. strip markdown, links, URLs and email addresses
 *   3. split into sentences, in order
 *   4. DROP every sentence for which isFirstPersonClaim is true
 *   5. rejoin, capped at PROJECT_BULLET_DETAIL_MAX_SENTENCES
 *
 * The offending SENTENCE is stripped and the clean remainder kept, rather than
 * refusing the whole detail: an elaboration with one claim-sentence removed is
 * still honest and still useful. When EVERY sentence is a claim the result is ""
 * and the route reports an honest empty.
 *
 * Never throws: a splitter edge case degrades to "" rather than an error.
 */
export function sanitizeProjectBulletDetail(raw) {
  try {
    if (typeof raw !== "string") return "";
    const cleaned = stripMarkup(raw.trim().slice(0, MAX_RAW_CHARS));
    if (!cleaned) return "";
    return splitSentences(cleaned)
      .filter((sentence) => !isFirstPersonClaim(sentence))
      .slice(0, PROJECT_BULLET_DETAIL_MAX_SENTENCES)
      .join(" ")
      .trim();
  } catch {
    return "";
  }
}
