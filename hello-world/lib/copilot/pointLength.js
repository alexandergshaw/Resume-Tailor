// The one place a drafted bullet's LENGTH gates and its "does this sentence
// stand on its own?" test are declared.
//
// Two things live here and nowhere else:
//
//   * the numeric thresholds every producer and every sweep compares against
//     (AC-D.1). A threshold copied into a fixture, a test, or a second module
//     is a threshold that drifts from the one the app actually applies, so the
//     corpus fixture READS these and never restates them.
//   * standsAlone(point) (AC-S.7), the executable form of the request's own
//     fourth constraint — "sufficient to stand on their own".
//
// NOT `pointBudget.js`: "budget" already means the CUE word budget in
// answerCues.js (MAX_CUE_WORDS and the clause slack around it), and two
// different budgets one module apart is exactly the collision that gets
// mis-imported.
//
// MODULE-CYCLE DISCIPLINE, stated because it is load-bearing. This module
// imports ACHIEVEMENT_VERBS from answerLocal.js — deliberately, because
// hasPredicate's test (c) must reuse the tree's own verb vocabulary rather
// than declare a second one — and answerLocal.js in turn imports
// materialQuote.js, which imports this module. That is an ES module cycle,
// and it is safe only while NO module in it reads a binding from another at
// TOP LEVEL. Every cross-module reference in this file is inside a function
// body; keep it that way, and keep materialQuote.js's the same, or importing
// whichever module the cycle happens to enter first throws a TDZ
// ReferenceError on a binding that is merely declared later.

import { ACHIEVEMENT_VERBS, STAR_LABEL_RE } from "./answerLocal.js";

// ---------------------------------------------------------------------------
// The gates (AC-D.1)
// ---------------------------------------------------------------------------

// The practice ceiling. A PREFERENCE, not an admission test: AC-B.3's
// selection prefers the highest-ranked candidate that composes within it and
// ships the highest-ranked one whole when none does, because an answer that
// claims nothing is on file while the candidate's résumé is open is worse than
// a bullet two words too long.
export const MAX_POINT_WORDS = 12;

// A tripwire, not a live filter: the shortest label-stripped point the tree can
// emit today is "Ledger Rebuild." at 2. standsAlone is what actually judges
// that line, and it fails it.
export const MIN_POINT_WORDS = 2;

// A project page title shorter than this is refused as a Situation beat rather
// than padded into one — the same judgement projectStories.js already encodes
// for its untitled-project placeholder.
export const MIN_TITLE_WORDS = 2;

// How many consecutive normalised tokens a point must share with ONE line of
// the candidate's own material before that point counts as grounded in it.
export const GROUNDED_SPAN_MIN_WORDS = 4;

// ---- the header predicate's own gates (materialQuote.js applies them) ------

// A header's date sits at the END. A tail longer than this means the sentence
// carries on past the date, which is what an achievement does and a header
// does not ("Ran the on-call rotation from 2019 to 2021 across three partner
// teams"). Two words is a location suffix ("| 2016 - 2018, Remote").
export const MAX_HEADER_TAIL_WORDS = 2;

// The share of a header's ratio-bearing tokens that must be capitalised.
// 0.8 rather than 1.0 for a measured reason: with exactly one lowercase token
// the two thresholds are IDENTICAL until the head carries five ratio-bearing
// tokens, and above that 0.8 accepts real headers with a stylised employer
// name ("Senior Platform Engineer, Developer Tools, thoughtbot Remote") that
// 1.0 rejects. Below 0.8 nothing further is bought.
export const HEADER_TITLECASE_RATIO = 0.8;

// A head that opens on a verb-shaped word is a clause, not a title — UNLESS it
// carries a second segment, because a real header is "<title>, <employer>" and
// can legitimately open on one ("Managed Services Engineer, Acme Payments").
export const MIN_HEADER_SEGMENTS = 2;

// ---------------------------------------------------------------------------
// AC-S.7's four closed word classes
// ---------------------------------------------------------------------------

// A bullet that OPENS on one of these has, by construction, no antecedent
// inside its own line — the thing it refers to is the bullet above it, or the
// interview question, neither of which is on screen when the line is read by
// itself. Interior anaphors are deliberately permitted: they have earlier
// material in the same line to bind to.
export const ANAPHOR_OPENERS = new Set([
  "it", "its", "this", "that", "these", "those", "they", "them", "their", "theirs",
  "he", "him", "his", "she", "her", "hers", "such", "one", "ones",
]);

// A bullet that opens on one of these is a syntactic fragment of the bullet
// above it. Discourse adverbs ("Finally, ...") are NOT in this class: they
// order a sentence that is already complete.
export const COORDINATOR_OPENERS = new Set(["and", "but", "or", "nor", "so", "yet", "plus", "which"]);

// Determiners, possessives, prepositions, subordinators and pronouns — the
// words that can open a NOUN PHRASE or a subordinate clause but never an
// imperative. Used only to close hasPredicate's imperative-head escape, so a
// CONTENT word must never appear here: "Describe", "Ground" and "Anchor" are
// the heads three of live's four carriers depend on.
export const FUNCTION_HEADS = new Set([
  // determiners and quantifiers
  "a", "an", "the", "this", "that", "these", "those", "each", "every", "some",
  "any", "no", "all", "both", "either", "neither", "another", "such", "much",
  "many", "few", "several",
  // possessives
  "my", "our", "your", "his", "her", "its", "their", "whose",
  // pronouns and pro-forms
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them",
  "mine", "yours", "hers", "ours", "theirs", "one", "ones", "who", "whom",
  "what", "which", "there", "here",
  // prepositions
  "of", "in", "on", "at", "to", "for", "with", "from", "by", "about", "into",
  "over", "under", "after", "before", "during", "through", "between", "across",
  "against", "without", "within", "among", "per", "via", "near", "upon",
  // subordinators and conjunctions
  "because", "although", "though", "while", "since", "unless", "until",
  "whether", "if", "when", "where", "why", "how", "as", "than", "and", "but",
  "or", "nor",
]);

// Auxiliary and copular forms. A clause carrying one of these HAS a finite
// verb, whatever else it contains.
export const FINITE_FORMS = new Set([
  "am", "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "do", "does", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
]);

// The hosts a bare "'s" may be read as a contracted IS/HAS on. "The platform's
// cache" is a possessive and is not a clause; "Here's the cache" is. Without
// this restriction hasPredicate reads every possessive noun phrase as
// predicated, which is precisely the shape S3 exists to reject.
const CONTRACTION_PRONOUN_HOSTS = new Set([
  "i", "you", "he", "she", "it", "we", "they", "that", "this", "there", "here",
  "who", "what", "where", "when", "why", "how", "one", "someone", "somebody",
  "anyone", "anybody", "everyone", "everybody", "nobody", "nothing", "something",
]);

// §1.3's verbShapedOpener endings, applied to ANY token rather than only the
// first. Deliberately noisy in the PERMISSIVE direction ("out", "about", "run"
// and "new" all match an ending): S3's job is to reject a bare noun phrase, and
// a gate whose failures are all real is worth more than one that argues about
// borderline cases.
const VERB_MORPH_RE =
  /(?:ed|ing|ised|ized|ght|ilt|ade|ook|ave|ent|elt|ept|old|ew|ut|ot|un|ang|ank)$/i;

const CONTRACTION_RE = /^(.+?)('s|'d|'ll|'ve|'m|'re)$/i;

// Where the OPENING CLAUSE ends. S3 is judged here and not over the whole
// body, because the example after the dash is full of verbs while the carrier
// in front of it may have none — which is the entire difference between
// "Action: Describe it — e.g. ..." and "Action: Your steps — e.g. ...".
const CLAUSE_CUTS = [" — ", " – ", ": ", "; "];

// ---------------------------------------------------------------------------

// Byte-identical to the private counter answerPoints.js used to carry, which
// now imports this one. An em dash standing alone between spaces IS a word —
// that is why "Ground it — e.g." measures 4 and "Action: Describe it — e.g."
// measures 5, and every `fixed` figure the carriers are gated on depends on it.
export function pointWordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function normalizeApostrophes(text) {
  return String(text == null ? "" : text).split("’").join("'");
}

// A whitespace token with its surrounding punctuation peeled off, keeping an
// internal apostrophe so a contraction survives.
function bareToken(token) {
  return String(token || "").replace(/^[^A-Za-z0-9']+/, "").replace(/[^A-Za-z0-9']+$/, "");
}

function isContractedFinite(token) {
  const m = CONTRACTION_RE.exec(token);
  if (!m) return false;
  if (m[2].toLowerCase() !== "'s") return true;
  return CONTRACTION_PRONOUN_HOSTS.has(m[1].toLowerCase());
}

// Five independent ways to find a verb, any one of which passes. A clause
// fails only when NO token can be a verb under any of them.
function hasPredicate(clause) {
  const tokens = String(clause || "").split(/\s+/).filter(Boolean).map(bareToken).filter(Boolean);
  if (!tokens.length) return false;

  for (const t of tokens) {
    if (VERB_MORPH_RE.test(t)) return true; // (a) morphology
    if (FINITE_FORMS.has(t.toLowerCase())) return true; // (b) a finite form
    if (ACHIEVEMENT_VERBS.test(t)) return true; // (c) the tree's own verb list
    if (isContractedFinite(t)) return true; // (d) a contraction
  }

  // ...or the clause opens on an IMPERATIVE HEAD: a capitalised token that is
  // not a function word, with at least one lowercase-initial token after it
  // inside the same clause. A bare proper-noun run ("Ledger Rebuild", "Acme
  // Payments, Senior Engineer") has no such token, which is what separates a
  // real instruction from a label plus two nouns.
  const head = tokens[0];
  if (!/^[A-Z]/.test(head)) return false;
  if (FUNCTION_HEADS.has(head.toLowerCase())) return false;
  return tokens.slice(1).some((t) => /^[a-z]/.test(t));
}

function openingClause(body) {
  let cut = body.length;
  for (const sep of CLAUSE_CUTS) {
    const i = body.indexOf(sep);
    if (i >= 0 && i < cut) cut = i;
  }
  return body.slice(0, cut);
}

/**
 * AC-S.7 — does this bullet survive being read by itself?
 *
 * A bullet in this product is read aloud, under pressure, out of order, next
 * to three siblings, with a bold STAR label in front of it that is NAVIGATION
 * rather than content. So the question is asked of the LABEL-STRIPPED body:
 * with the label covered up, without the bullet above it, and with nothing on
 * screen to resolve a pronoun against, is this still a sentence?
 *
 * Three mechanical conditions, all of which must hold:
 *
 *   S1 CLOSED      the body opens on a capital and ends in terminal
 *                  punctuation (a closing quote or bracket may follow).
 *   S2 UNCHAINED   the body's FIRST token is neither a pro-form nor a
 *                  coordinator. First-token-only, deliberately: a
 *                  clause-initial pro-form has no antecedent inside its own
 *                  line, while an interior one does.
 *   S3 PREDICATED  the OPENING CLAUSE carries a verb (hasPredicate above).
 *
 * It is NOT a grammar, a parser or a POS tagger, and it declares no new verb
 * list and no new job vocabulary. What it cannot see is recorded rather than
 * implied: interior anaphora ("Ground it" leans on an `it` meaning *your
 * answer*), free relatives ("What you did — e.g. ..."), possessive pro-forms
 * after the first token, and anything at all about how the line reads.
 *
 * Total by construction — never throws, always returns a boolean.
 */
export function standsAlone(point) {
  const raw = normalizeApostrophes(point).trim();
  if (!raw) return false;

  const body = raw.replace(STAR_LABEL_RE, "").trim();
  if (!body) return false;

  // S1 CLOSED
  if (!/^[A-Z]/.test(body)) return false;
  if (!/[.?!]["')\]]?$/.test(body)) return false;

  // S2 UNCHAINED
  const first = (body.split(/\s+/)[0] || "")
    .toLowerCase()
    .replace(/[^a-z']/g, "")
    .replace(/(?:'s|'d|'ll|'ve|'m|'re)$/, "");
  if (ANAPHOR_OPENERS.has(first) || COORDINATOR_OPENERS.has(first)) return false;

  // S3 PREDICATED
  return hasPredicate(openingClause(body));
}
