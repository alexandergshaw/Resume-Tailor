// The ONE module that owns the citation marker's syntax.
//
// Three things in this feature reason about the string `[n](url)`: the render
// splice that emits one, the check that decides whether emitting one at a
// given point is safe, and the check that decides whether a URL may appear
// inside one. They must agree BYTE FOR BYTE, or a write-time proof is about a
// different string than the render emits.
//
// HOW THAT AGREEMENT IS OBTAINED, because "we were careful" is not a
// mechanism. This repo has already paid for the alternative: a link scanner
// written to its own regex disagreed with the renderer on 6 of 9 measured
// inputs - four total misses, one of them an unbalanced "(" that made the
// scanner see nothing at all while the renderer emitted a live anchor. A
// second recogniser is the defect.
//
//   * `emitMarker` is the ONLY place the bytes "[", "](" and ")" are written
//     in this feature. Nothing else constructs marker syntax.
//   * `markerUrlAllowed` does not enumerate the characters that break a
//     marker. It builds a probe with `emitMarker` and asks `parseMarkdown` -
//     the renderer itself - what came out.
//   * `differsOnlyByMarker` constructs nothing at all. It parses the caller's
//     two strings and compares the results.
//
// There is therefore no second recogniser to drift from, and no regex
// anywhere in this file that has to be kept in step with lib/experience/
// markdown.js. citationMarker.test.js proves it rather than asserting it:
// five NEIGHBOURING syntaxes are spliced at every one of the eight safe
// insertion points and every one is refused, so a change to `emitMarker` that
// the predicates did not follow turns eight rows red at once.
//
// WHY A DIFFERENTIAL CHECK RATHER THAN A LIST OF UNSAFE CONTEXTS. The ruling
// that created this module named four unsafe contexts; measurement found
// EIGHT (inline code, fenced code, an emphasis delimiter run, a link
// destination, a link label, an unmatched bracket run, after a "!", after a
// backslash), plus two nobody listed - splicing between the two newlines of a
// blank-line break, and a URL containing ")". markdown.js's own header states
// the principle: "a denylist only ever blocks the schemes someone thought to
// write down." A list of eight contexts is a denylist assembled by whoever
// was paying attention this week.
//
// REFUSE, NEVER NUDGE, AND NEVER RE-ENCODE. A nudged marker points at the
// wrong sentence, which is the harm this feature exists to prevent.
// Percent-encoding a URL's parentheses makes the ")" case pass - and a URL we
// rewrote is not the URL we were given. A refused citation with a usable URL
// is disclosed as "Also searched"; without one it is counted.

import { parseMarkdown } from "../experience/markdown.js";
import { citationHref } from "./citationHref.js";

// Any digit string works; the marker's number is the caller's and never
// affects how a URL parses. One digit keeps the probe at one tiny parse.
const MARKER_PROBE_DIGITS = "1";

/**
 * THE syntax. The only producer of marker bytes anywhere.
 *
 * Callers must have passed `url` through `markerUrlAllowed` first, and must
 * have checked the insertion point with `precededByDigit` and
 * `differsOnlyByMarker`. This function is a formatter, not a gate: making it
 * validate would put a second copy of the decision here.
 *
 * @param {number|string} n  the marker's number, rendered as its digits
 * @param {string} url
 * @returns {string}
 */
export function emitMarker(n, url) {
  return `[${n}](${url})`;
}

// A single walk of the shipped parser's token tree, producing the two things
// both predicates need: the VISIBLE text a reader sees, and the multiset of
// link hrefs.
//
// Blocks are concatenated with NO separator, deliberately. A paragraph's own
// line breaks live inside its text values, so splitting one paragraph into
// two LOSES a "\n" from the visible text and the arithmetic below sees it. A
// synthetic block separator would cancel that loss out exactly, and the
// blank-line-break splice - which silently turns one paragraph into two -
// would pass.
function render(markdown) {
  const hrefs = [];
  let text = "";
  const visit = (nodes) => {
    for (const token of nodes || []) {
      if (token.type === "text") {
        text += token.value;
        continue;
      }
      // Inline code carries `value`; a fenced block carries `text`. Both are
      // read aloud by the reader, so both are visible text.
      if (token.type === "code") {
        text += typeof token.value === "string" ? token.value : token.text || "";
        continue;
      }
      if (token.type === "link") hrefs.push(token.href);
      if (Array.isArray(token.children)) visit(token.children);
      if (Array.isArray(token.items)) for (const item of token.items) visit(item.children);
    }
  };
  visit(parseMarkdown(markdown));
  return { hrefs, text };
}

/**
 * Whether a URL may appear inside a marker at all.
 *
 * `citationHref` must admit it, AND the renderer must reproduce it: emitting
 * a marker for it must yield exactly one link, whose href is the URL BYTE FOR
 * BYTE, with the digits as the only visible text.
 *
 * Measured consequences, none of them enumerated here:
 *   - `[1](https://en.wikipedia.org/wiki/Nimbus_(company))` yields the href
 *     ".../Nimbus_(company" - a URL Google never supplied - plus a stray ")"
 *     in the prose, because parseInline takes the FIRST ")" with no
 *     balancing. Refused.
 *   - a URL carrying a blank line yields NO link at all and prints the raw
 *     URL in the prose. The enumerated rule ("admitted, and contains no ')'")
 *     admits it. This one refuses it, and the difference is exactly the
 *     scanner-versus-renderer gap this module exists to close.
 *   - a URL containing "(" but no ")", or a space, renders correctly and is
 *     ADMITTED. Refusing every parenthesis would discard a real citation.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function markerUrlAllowed(url) {
  // The typeof test is load-bearing rather than decorative: citationHref(null)
  // is null, so `citationHref(url) !== url` alone would let null through.
  if (typeof url !== "string" || citationHref(url) !== url) return false;
  const probe = render(emitMarker(MARKER_PROBE_DIGITS, url));
  return probe.hrefs.length === 1 && probe.hrefs[0] === url && probe.text === MARKER_PROBE_DIGITS;
}

/**
 * The one harm the differential check cannot see, because the splice is
 * parse-IDENTICAL: "Nimbus employs 400 people." becomes "Nimbus employs 4001
 * people.", and a candidate reads "four thousand and one employees" to a
 * recruiter.
 *
 * "Decimal digit" is read as the Unicode Nd category rather than as [0-9]:
 * this feature's prose is company research and carries non-ASCII. That
 * over-refuses on nothing measurable and under-refuses on nothing at all, and
 * over-refusal is the cheap direction - the citation goes to "Also searched",
 * which is honest.
 *
 * Returns false when there is no preceding character. Callers validate the
 * span before they get here; this predicate answers only about the character
 * at `at - 1`.
 *
 * @param {unknown} text
 * @param {unknown} at   a UTF-16 index into `text`
 * @returns {boolean}
 */
export function precededByDigit(text, at) {
  if (typeof text !== "string") return false;
  if (!Number.isInteger(at) || at <= 0 || at > text.length) return false;
  let ch = text[at - 1];
  // A digit outside the BMP is a surrogate pair, and a lone low surrogate
  // matches no Unicode category at all.
  if (at >= 2 && ch >= "\uDC00" && ch <= "\uDFFF") ch = text.slice(at - 2, at);
  return /\p{Nd}/u.test(ch);
}

// Whether `va` is `vb` with exactly one run of `digits` inserted somewhere.
//
// Computed from the longest common prefix and suffix rather than by scanning
// every position: any valid insertion point p satisfies p <= lcp and
// p >= vb.length - lcs, so the candidate range is bounded by those two, and
// the run at p must BE the digits - equal lengths and matching ends are not
// enough on their own.
function insertsExactlyOneRun(va, vb, digits) {
  const d = digits.length;
  if (va.length !== vb.length + d) return false;

  let lcp = 0;
  while (lcp < vb.length && va[lcp] === vb[lcp]) lcp++;
  let lcs = 0;
  while (lcs < vb.length - lcp && va[va.length - 1 - lcs] === vb[vb.length - 1 - lcs]) lcs++;

  const lo = Math.max(0, vb.length - lcs);
  const hi = Math.min(lcp, vb.length);
  for (let p = lo; p <= hi; p++) {
    if (va.slice(p, p + d) === digits) return true;
  }
  return false;
}

// Whether the href multiset gained exactly `url` and lost nothing.
function gainsExactlyOneHref(before, after, url) {
  const delta = new Map();
  for (const href of before) delta.set(href, (delta.get(href) || 0) - 1);
  for (const href of after) delta.set(href, (delta.get(href) || 0) + 1);
  for (const [href, n] of delta) {
    if (n !== (href === url ? 1 : 0)) return false;
  }
  // Covers the case where `url` appears in neither list, which the loop above
  // never visits: the marker's link was not created at all.
  return (delta.get(url) || 0) === 1;
}

/**
 * The differential check. Comparing `parseMarkdown` of `before` with
 * `parseMarkdown` of `after`, a marker may be spliced iff:
 *
 *   (1) deleting ONE occurrence of `digits` from the spliced VISIBLE TEXT, at
 *       some position, reproduces `before`'s visible text exactly; and
 *   (2) the multiset of link hrefs gains exactly `url` and loses nothing.
 *
 * Both halves are load-bearing and neither subsumes the other. Splicing into
 * an emphasis delimiter run keeps the href and mangles the prose - clause (1)
 * catches it. Splicing after a "!" makes the image handler swallow the marker,
 * so the citation vanishes with no error and no residue while the visible
 * text is exactly right - only clause (2) catches that.
 *
 * CALLERS MUST RUN THIS CUMULATIVELY. `before` is the string as it stands
 * with every previously accepted marker already in it, never the stored
 * markdown. Two markers each individually safe, where the second lands inside
 * the first's emitted syntax, produce a raw URL in the prose and the WRONG
 * surviving href - and both per-marker checks against the stored string pass.
 *
 * @param {unknown} before
 * @param {unknown} after
 * @param {unknown} digits  the marker's rendered digits, e.g. String(n)
 * @param {unknown} url
 * @returns {boolean}
 */
export function differsOnlyByMarker(before, after, digits, url) {
  if (typeof before !== "string" || typeof after !== "string") return false;
  if (typeof digits !== "string" || digits.length === 0) return false;
  if (typeof url !== "string" || url.length === 0) return false;

  const rb = render(before);
  const ra = render(after);

  if (!insertsExactlyOneRun(ra.text, rb.text, digits)) return false;
  return gainsExactlyOneHref(rb.hrefs, ra.hrefs, url);
}
