// THE FROZEN CONTRACT for expandable answer bullets.
//
// One drafted bullet, expanded on demand into one to five sub-bullets that go
// further into that bullet and nothing else. This module owns every number and
// every shape rule both sides of that wire have to agree on, so the client's
// cache key and the server's filter cannot drift apart. Everything here is
// PURE: no React, no `app/` import, no network, no storage.
//
// WHAT IS DELIBERATELY NOT HERE. Provenance, meaning "may this sentence be
// spoken as the candidate's own experience?", is expansionHonesty.js's, and it
// is server-only because it needs the source material the client is never
// given. This module answers only "is this the SHAPE of a sub-bullet?".
//
// MODULE-CYCLE DISCIPLINE. pointLength.js imports answerLocal.js, which
// imports materialQuote.js, which imports pointLength.js again: a live ES
// module cycle. Nothing this module imports from inside it may be read at
// module-evaluation time. Every reference below is inside a function body, and
// every constant is a LITERAL. A top-level read throws a TDZ ReferenceError
// whenever the cycle is entered the other way round.

import { normalizeForComparison, stripStarLabel } from "./answerPoints.js";
import { resolvePageSources } from "./pageCitations.js";
import { normalizeQuestion } from "./questions.js";
import { isEmploymentHeaderLine } from "./materialQuote.js";
import { pointWordCount, standsAlone } from "./pointLength.js";

// ---------------------------------------------------------------------------
// Constants. Literals, all of them, for the cycle reason above.
// ---------------------------------------------------------------------------

// ONE, not two. With a restatement filter already in force, a single
// non-duplicate detail IS further detail; routing it to the empty state is a
// false negative the candidate cannot tell apart from a true one ("there is
// genuinely nothing more here").
export const EXPANSION_MIN = 1;

// Five is a ceiling on what a person can take in mid-interview, and on what
// one expansion may cost.
export const EXPANSION_MAX = 5;

// The shortest run of words that can carry a speakable claim.
//
// A LITERAL, and it must stay one. pointLength.js declares
// GROUNDED_SPAN_MIN_WORDS = 4, meaning "the shortest verbatim run worth
// quoting from the candidate's material", and the two numbers are equal BY
// COINCIDENCE, not by relationship. Aliasing this to that constant would make
// a future change to the quote floor silently move the sub-bullet floor, and
// it would be a top-level read of a cycle-adjacent import besides.
export const MIN_SUB_BULLET_WORDS = 4;

// The panel's minimum height, in px.
//
// THE RULE, tied to EXPANSION_MIN so it survives the next change to it: the
// floor equals the SMALLEST POSSIBLE SUCCESSFUL OUTCOME, which is EXPANSION_MIN
// times one `body2` line box (about 20.02px), so that no outcome ever shifts
// the content below it UPWARD and every other outcome shifts it downward only.
// An upward shift is the worse one because the reader's eye has already moved.
// A floor of 40 (two line boxes) would make `loading -> 1 sub-bullet` shift up
// by a whole line, which is the exact defect a floor exists to prevent.
//
// MUI TRAP: in `sx`, `minHeight` is a SIZING key, where a number > 1 is px and
// a number <= 1 is a PERCENTAGE (`minHeight: 0.5` is 50%). 20 is 20px. Same
// family as `width: 1` meaning 100% and `margin: -1` meaning -8px.
export const EXPANSION_MIN_HEIGHT = 20;

// The parent point's cap on the wire. GENUINELY NEW: normalizeModelPoints
// bounds the point COUNT and nothing in this repo bounds a point's LENGTH, so
// the parent point is unbounded on the wire today, and it is pasted straight
// into a prompt, so the prompt cost is unbounded with it.
export const MAX_PARENT_POINT_CHARS = 400;

// How much of a profile enters a cache key. The profile itself runs to 8000
// characters and must never sit in a map key.
const PROFILE_HASH_EDGE = 64;

// ---------------------------------------------------------------------------
// The cache key
// ---------------------------------------------------------------------------

/**
 * A stable, bounded stand-in for a profile string.
 *
 * Length plus the first and last `PROFILE_HASH_EDGE` characters. Not a
 * cryptographic digest and not trying to be: this is a CACHE key, so the only
 * property that matters is that two profiles which differ produce different
 * keys often enough that a stale expansion is not served across an edit, and
 * that the raw 8000-character text never sits in a Map key where a heap dump
 * or a debug log would print it.
 *
 * Total by construction: never throws, always returns a string.
 */
export function profileHash(profile) {
  const s = typeof profile === "string" ? profile : "";
  if (s.length <= PROFILE_HASH_EDGE * 2) return `${s.length}:${s}`;
  return `${s.length}:${s.slice(0, PROFILE_HASH_EDGE)}:${s.slice(-PROFILE_HASH_EDGE)}`;
}

/**
 * The one key an expansion record is stored and looked up under.
 *
 * TEXT KEYING, NOT INDEX KEYING, AND THAT IS THE WHOLE DESIGN. Because the key
 * carries the normalised parent SENTENCE, a redraft that replaces the bullet at
 * position 2 produces a different key, so there is no record, so that bullet
 * renders collapsed with no sub-bullets in the DOM at any point, with zero
 * invalidation code. And a redraft that reproduces the IDENTICAL sentence
 * produces the SAME key, so re-expanding it costs nothing. A token-keyed or
 * generation-keyed cache cannot have both of those properties at once.
 *
 * The key IS the generation guard: a response that settles under a key the UI
 * no longer computes is simply never read.
 *
 * WHAT IS IN IT, and why each one:
 *   question       the exported normaliser, the one both existing answer
 *                  caches already key on. It is also the only identifier all
 *                  surfaces can compute (live ids are integers, practice
 *                  "ids" are the raw question text, room ids are a third
 *                  integer space).
 *   parentPoint    normalised the same way a sub-bullet is compared against
 *                  it, so "the same point" means one thing in this feature.
 *   profile hash   see profileHash.
 *   interviewType / applicationId / codeLanguage: the same grounding fields
 *                  the answer caches compare, because an expansion drafted
 *                  under one posting is not an expansion of the same bullet
 *                  under another.
 *   engine         so the caption printed over the sub-bullets can never
 *                  disagree with what actually produced them.
 *
 * WHAT IS NOT IN IT: anything about how the parent is RENDERED. Which run of
 * the sentence is bolded is a display decision that changes between drafts of
 * identical text, and letting it into the key would re-buy a paid model call
 * for a bullet whose words did not move.
 */
export function expansionKey({ question, parentPoint, request } = {}) {
  const req = request && typeof request === "object" ? request : {};
  return [
    normalizeQuestion(question),
    normalizeForComparison(stripStarLabel(parentPoint)),
    profileHash(req.profile),
    String(req.interviewType ?? ""),
    String(req.applicationId ?? ""),
    String(req.codeLanguage ?? ""),
    String(req.engine ?? ""),
  ].join("::");
}

// ---------------------------------------------------------------------------
// The shape filter
// ---------------------------------------------------------------------------

function entryText(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.text === "string") return entry.text;
  return "";
}

/**
 * Is this string the SHAPE of a sub-bullet?
 *
 * Four named predicates, none of them hand-rolled here:
 *
 *   standsAlone            the repo's own "does this survive being read by
 *                          itself?" test: closed, unchained, predicated. It is
 *                          what "a complete, speakable sentence, not a
 *                          fragment or a heading" actually means here.
 *   pointWordCount         the repo's one word counter. Nothing in this
 *                          feature writes `split(/\s+/).length`.
 *   terminal punctuation   a sub-bullet is spoken; a line that does not end is
 *                          a line someone trails off in the middle of.
 *   isEmploymentHeaderLine a resume position header ("Senior Engineering
 *                          Manager, Acme Payments Corp, Jan 2019 - Mar 2022.")
 *                          passes all three above and is not something the
 *                          candidate DID. It is a likely miner output, so it
 *                          is rejected by name rather than left to luck.
 */
function hasSubBulletShape(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (!standsAlone(t)) return false;
  if (pointWordCount(t) < MIN_SUB_BULLET_WORDS) return false;
  if (!/[.!?]["')\]]?$/.test(t)) return false;
  if (isEmploymentHeaderLine(t)) return false;
  return true;
}

/**
 * The shape half of "may this reach the screen?", applied identically on both
 * engines. The deterministic drafter's output goes through it too, because a
 * fragment mined off a page is exactly as unspeakable as one a model invented.
 *
 * Accepts either bare strings or `{ text, pageId, source }` entries, and always
 * returns entries.
 *
 * Returns `[]`, never a partially filtered set presented as complete, when
 * fewer than EXPANSION_MIN survive. That empty array is the HONEST-EMPTY
 * state, and it is a SUCCESS: the caller answers 200 with an empty marker, not
 * a 5xx. (Four sites in the answer route return
 * `502 { error: "Could not generate an answer." }` on an empty points array,
 * and on two of them, the embedded branches, nothing had failed. That
 * precedent is deliberately not copied: it renders an error alert over a
 * truthful "there is nothing more here".)
 *
 * This half stops at the entries, with their raw `pageId` still attached, so
 * the deterministic drafter can reuse exactly this filter without handing its
 * own already-trusted page through a whitelist. Callers facing the wire use
 * normalizeSubBullets below, which resolves them.
 */
export function filterSubBulletEntries(raw, { parentPoint = "" } = {}) {
  const list = Array.isArray(raw) ? raw : [];
  const parentKey = normalizeForComparison(stripStarLabel(parentPoint));

  const kept = [];
  const seen = new Set();
  for (const entry of list) {
    if (kept.length >= EXPANSION_MAX) break;
    const text = entryText(entry).trim();
    if (!hasSubBulletShape(text)) continue;
    const key = normalizeForComparison(text);
    // A sub-bullet that merely restates its own parent is not further detail,
    // and one that restates a sibling sub-bullet is padding.
    if (!key || key === parentKey || seen.has(key)) continue;
    seen.add(key);
    kept.push({
      text,
      pageId: entry && typeof entry === "object" && typeof entry.pageId === "string" ? entry.pageId : null,
      source: entry && typeof entry === "object" && entry.source ? entry.source : null,
    });
  }

  return kept.length < EXPANSION_MIN ? [] : kept;
}

/**
 * filterSubBulletEntries, plus the page-id resolution the wire needs.
 *
 * Page ids go through the SHARED whitelist, positionally, AFTER filtering:
 * never a second whitelist, and never the model's own `title`. A blank title
 * once produced the rendered string "From your  page.", which is the guard
 * that lives inside resolvePageSources rather than being re-derived here.
 */
export function normalizeSubBullets(raw, { parentPoint = "", includedPages = [] } = {}) {
  const kept = filterSubBulletEntries(raw, { parentPoint });
  if (kept.length === 0) return [];

  const resolved = resolvePageSources(
    kept.map((k) => k.pageId),
    { includedPages, pointCount: kept.length },
  );

  return kept.map((k, i) => ({
    text: k.text,
    pageSource: resolved[i] || null,
    source: k.source,
  }));
}

// ---------------------------------------------------------------------------
// The caption
// ---------------------------------------------------------------------------

function describeSources(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const titles = [];
  let resume = false;
  let coverLetter = false;
  let profile = false;
  for (const source of list) {
    const kind = source && typeof source === "object" ? source.kind : "";
    if (kind === "page") {
      const title = typeof source.pageTitle === "string" ? source.pageTitle.trim() : "";
      if (title && !titles.includes(title)) titles.push(title);
    } else if (kind === "resume") resume = true;
    else if (kind === "coverLetter") coverLetter = true;
    else if (kind === "profile") profile = true;
  }

  const parts = [];
  if (titles.length === 1) parts.push(`your ${titles[0]} page`);
  else if (titles.length > 1) parts.push("your own project pages");
  if (resume && coverLetter) parts.push("the resume and cover letter you submitted for this posting");
  else if (resume) parts.push("the resume you submitted for this posting");
  else if (coverLetter) parts.push("the cover letter you submitted for this posting");
  if (profile) parts.push("your prep context");
  return parts;
}

/**
 * One sentence saying what THIS EXPANSION was mined from, and which engine
 * mined it.
 *
 * A SIBLING of SampleAnswer.js's `sourceCaption`, not a reuse of it: that one
 * describes an ANSWER's grounding flags ("what was in the prompt"), this one
 * describes WHICH MATERIAL these sub-bullets actually came from. Same voice,
 * different subject, which is why it takes a source list rather than booleans,
 * and why it cannot claim a source that was not in the request: there is no
 * branch that prints one.
 *
 * No em dash and no ellipsis: both are silent at default screen-reader
 * punctuation settings, so a caption whose meaning turns on one is not read
 * out at all. (app/copilot/CodeLanguagePicker.test.js states the rule.)
 *
 * Returns "" when there is nothing to describe. An expansion with no
 * sub-bullets makes no provenance claim.
 */
export function expansionCaption({ isEmbedded, sources } = {}) {
  const parts = describeSources(sources);
  if (parts.length === 0) return "";
  const engineText = isEmbedded
    ? "Found on this server with no AI provider"
    : "Found by Google Gemini";
  const joined =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `${engineText} in ${joined}.`;
}

/**
 * The one frozen "nothing more we can back up" record. A fresh object each
 * call: the store holds one per key and two keys must never alias.
 */
export function emptyExpansion() {
  return { subBullets: [], caption: "", empty: true };
}
