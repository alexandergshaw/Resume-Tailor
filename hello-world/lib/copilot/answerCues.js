// Short, glanceable CUES for a drafted answer — the few-word prompts a
// candidate reads mid-question to remember where the answer goes, as opposed
// to the full sentences the draft itself is made of.
//
// Why this is a derivation rather than a second thing the model generates:
// `points` (complete, speakable sentences) is already the contract the rest
// of the pipeline depends on — app/api/copilot/answer/route.js derives the
// prose `answer` from it (deriveAnswerFromPoints), and R-097 exists because
// a later speech-synthesis feature reads that prose, where fragments read
// aloud sound like fragments. Shortening for DISPLAY at the edge keeps both:
// the spoken material stays whole, and what a person actually reads under
// pressure is a handful of words. The Gemini path may supply its own `cues`
// (it phrases them better than any mechanical trim can); resolveCues below
// accepts those only when they line up with the points, and every supplied
// cue is still put through the same shortener, so the model cannot hand back
// a "cue" that is really another sentence.
//
// Deliberately no React, no MUI, no DOM — same reason answerPoints.js is a
// standalone module: this repo's vitest config runs `environment: "node"`,
// so anything defined inside a component module is unreachable from a test.

import { cleanAnswerPoints } from "./answerPoints.js";
import { STAR_LABEL_RE } from "./answerLocal.js";

// The budget a cue is trimmed to. "A few words" is the whole point: this is
// read in the two seconds between hearing a question and starting to talk,
// so anything that needs a second pass to parse has already failed.
export const MAX_CUE_WORDS = 6;

// A clause that ENDS on a natural boundary is allowed to run this far over
// budget rather than being chopped mid-phrase — "Made it my job to own the
// outcome" reads as a prompt; "Made it my job to own" reads as a bug.
const CLAUSE_SLACK_WORDS = 2;

// Where a sentence's first clause ends. Cutting here is preferred over
// counting words because the first clause of a spoken answer sentence is
// almost always the part worth remembering ("As Senior Engineer at Acme, I
// ran into a situation that..." -> "As Senior Engineer at Acme").
//
// Two tiers, tried in order. A STRONG boundary (punctuation, or a
// subordinating word) genuinely ends a thought, so cutting there loses
// nothing a prompt needed. A WEAK one (a bare conjunction) only sometimes
// does — "Open with where AND when" is one thought, "restate the problem AND
// pin down the constraints" is two — so it is used only when the strong cut
// came back too long to be a cue. Trying weak first would shorten the first
// example to "Open with where", which is not a prompt, it is half a phrase.
const STRONG_BOUNDARY_RE =
  /\s*(?:[—–-]{1,2}\s|[;:,]\s|\bbecause\b|\bso that\b|\bwhich\b|\brather than\b|\bwhile\b|\bbefore\b|\bafter\b)/i;
const WEAK_BOUNDARY_RE = /\s*(?:\band\b|\bthen\b|\bor\b)/i;

// Openers that carry no information once the sentence becomes a prompt.
const LEADING_FILLER_RE =
  /^(?:and|but|so|then|next|also|finally|basically|essentially|honestly|overall|in general|for example|e\.g\.)\b[\s,]*/i;

// A leading subordinate clause ("Rather than rewriting the service, I
// patched the hot path and moved on.") is not the point of the sentence —
// the main clause after the comma is. Left unstripped, the hard word-cut
// below keeps the subordinate clause and discards the main one, which
// inverts the meaning of the cue (it reads as though the subordinate clause
// is what happened). Requires a comma, so this only fires on a genuine
// "subordinate clause, main clause" shape and never on a mid-sentence use —
// STRONG_BOUNDARY_RE still treats these same words as valid mid-sentence cut
// points, unchanged.
const LEADING_SUBORDINATE_RE =
  /^(?:rather than|instead of|even though|although|whereas|despite|while|because)\b[^,]{0,120},\s*/i;

// The first-person subject (and any auxiliary behind it) a spoken answer
// point opens with. Stripped so the cue leads with the verb or the noun that
// actually identifies the beat — every point in a sample answer starts "I",
// so the word distinguishes nothing. The auxiliary alternation is
// `\b`-terminated so "do" cannot eat the front of "doubled", "was" of
// "wasted", and so on; the negative lookahead after it stops a negation
// ("I did not lead that project") from being stripped into its opposite
// ("Not lead that project").
const LEADING_SUBJECT_RE =
  /^(?:i(?:'d|'ll|'ve|'m)?|we(?:'d|'ll|'ve|'re)?|my|our)\b\s*(?:(?:would|will|had|have|has|am|are|was|were|can|could|should|did|do)\b(?!\s+not\b)\s*)?/i;

// Function words that must never be the last word of a cue — a cue ending on
// "to", "and" or "the" reads as a sentence that got cut off, which is exactly
// the impression this module exists to avoid.
const DANGLING_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "so", "to", "of", "in", "on", "at", "for", "with", "by",
  "from", "into", "onto", "over", "under", "as", "than", "then", "that", "which", "who", "whom",
  "is", "was", "are", "were", "be", "been", "being", "it", "its", "my", "our", "their", "his",
  "her", "this", "these", "those", "about", "up", "out", "off", "if", "when", "while", "not",
  "i", "we", "you", "they", "down", "through", "back", "away", "around", "along", "very", "just",
]);

function words(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

// A sentence whose tail is an enumeration ("...the strengths I'd bring are
// Django, PostgreSQL, Python") must NOT be cut at its first comma: the list
// is the content, and half a list does not read as a shortened answer — it
// reads as a complete one that names fewer things than the candidate can
// actually claim.
function isEnumeration(body) {
  const parts = String(body || "").split(/,\s*/);
  return parts.length >= 3 && parts.slice(1).every((part) => words(part).length <= 3);
}

function stripTrailingDanglers(list) {
  const out = list.slice();
  while (out.length > 1) {
    const last = out[out.length - 1].toLowerCase().replace(/[^a-z']/g, "");
    if (!DANGLING_WORDS.has(last)) break;
    out.pop();
  }
  return out;
}

function tidy(text) {
  const trimmed = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    // A cue is not a sentence, so it carries no terminal punctuation — and
    // cleanLine (answerLocal.js) can leave a mid-word ellipsis behind on a
    // truncated résumé bullet, which must not survive into a cue either. The
    // word right before the ellipsis is itself a truncated fragment (e.g.
    // "provi…" out of "provider"), so it is dropped along with the ellipsis
    // rather than left behind as a fake whole word.
    .replace(/\s*\S*…$/u, "")
    .replace(/[\s.,;:!?…]+$/u, "")
    .replace(/^[\s.,;:!?…]+/u, "");
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// Shorten one sentence to a cue, preserving a leading STAR label verbatim so
// a behavioral answer's four beats stay identifiable at a glance (the label
// is the navigation; shortening it would defeat the point). `maxWords`
// applies to the sentence BEHIND the label, not to the label itself.
//
// Returns "" for anything that shortens to nothing, so callers can drop it
// rather than render a blank bullet — the same failure cleanAnswerPoints
// guards for full points.
export function shortenToCue(text, maxWords = MAX_CUE_WORDS) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  const labelMatch = STAR_LABEL_RE.exec(raw);
  const label = labelMatch ? labelMatch[1] : "";
  let body = labelMatch ? raw.slice(labelMatch[0].length) : raw;

  // Strip a leading subordinate clause BEFORE the filler/subject strips
  // below, so what remains is the main clause the sentence is actually
  // about. Guarded: if stripping would leave nothing, keep the original body
  // rather than shortening to an empty cue.
  const withoutSubordinate = body.replace(LEADING_SUBORDINATE_RE, "").trim();
  if (withoutSubordinate) body = withoutSubordinate;

  body = body.replace(LEADING_FILLER_RE, "").replace(LEADING_SUBJECT_RE, "").trim();
  if (!body) body = labelMatch ? raw.slice(labelMatch[0].length).trim() : raw;

  const full = words(body);
  let chosen;
  if (full.length <= maxWords) {
    chosen = full;
  } else if (isEnumeration(body)) {
    chosen = stripTrailingDanglers(full.slice(0, maxWords + CLAUSE_SLACK_WORDS));
  } else {
    // Prefer the first clause that lands inside the budget, strong boundary
    // before weak; fall back to a hard word cut with any dangling function
    // words peeled off.
    const budget = maxWords + CLAUSE_SLACK_WORDS;
    const fits = (clause) => clause.length >= 2 && clause.length <= budget;
    const strong = words(body.split(STRONG_BOUNDARY_RE)[0]);
    const weak = words(body.split(WEAK_BOUNDARY_RE)[0]);
    if (fits(strong)) chosen = strong;
    else if (fits(weak)) chosen = weak;
    else chosen = stripTrailingDanglers(full.slice(0, maxWords));
  }

  const cue = tidy(chosen.join(" "));
  if (!cue) return "";
  return label ? `${label}: ${cue}` : cue;
}

// Every point shortened to a cue, ONE ENTRY PER CLEANED POINT — positions
// preserved, never dropped. Input is sanitised through cleanAnswerPoints
// first so this behaves identically to the render layer for a malformed
// `points` array.
//
// A `.filter(Boolean)` used to sit at the end of this pipeline, dropping any
// point that shortened to "" (a point too terse for shortenToCue to make a
// cue from — see its own doc comment). That reads harmless in isolation, but
// this array's whole reason for existing is to sit next to `points` and be
// read positionally: answerLines (answerPoints.js) trusts cues[i] to head
// points[i] only when the two arrays come out the SAME LENGTH. Dropping one
// blank cue shrinks this array by one, so a single terse sentence anywhere
// in a three-, four-, ten-point draft made the lengths disagree and
// answerLines discarded every cue in the whole answer — not just the one for
// the terse line. "" now holds that point's place instead: the line it heads
// simply renders with no cue, which is exactly what an empty `cue` already
// means at the render layer, and every other line keeps the cue it earned.
export function deriveCues(points) {
  return cleanAnswerPoints(points).map((p) => shortenToCue(p));
}

// The cues to actually ship for a set of points. Model-supplied cues win when
// there is exactly one per point — a mismatched count means the model paired
// them up differently than the points array reads, and a cue sitting against
// the wrong beat is worse than a mechanical one sitting against the right
// one. Supplied cues still go through shortenToCue, so "cues" that came back
// as full sentences are trimmed rather than trusted.
//
// Two different things are being cleaned here, and they are not the same
// operation. `cleanAnswerPoints(modelCues)` measures what the model actually
// SUPPLIED: a blank, whitespace-only, or non-string entry in the raw
// response isn't a cue placeholder, it's nothing, so dropping it before
// counting is correct — there was never anything at that position to hold a
// place for. What must NOT happen is dropping an entry AFTER shortenToCue
// has already run on it. An entry that shortens to "" (e.g. the model sent
// back "..." as a "cue") was genuinely supplied and still occupies its own
// position against cleanPoints; a `.filter(Boolean)` used to sit after the
// `.map(shortenToCue)` below and remove it anyway, which is the exact same
// mistake deriveCues used to make — it shrank `suppliedRaw`'s paired-up
// length by one, turned an exact-count match into a mismatch, and discarded
// every OTHER correctly-supplied cue along with the one that had nothing in
// it. `supplied` (post-shortenToCue, blanks intact) is what ships; the
// length check that decides whether it ships at all is judged on
// `suppliedRaw` — the supplied array's own length, before shortening.
export function resolveCues(modelCues, points) {
  const cleanPoints = cleanAnswerPoints(points);
  const suppliedRaw = cleanAnswerPoints(modelCues);
  const supplied = suppliedRaw.map((c) => shortenToCue(c));
  if (suppliedRaw.length > 0 && suppliedRaw.length === cleanPoints.length) return supplied;
  return deriveCues(cleanPoints);
}
