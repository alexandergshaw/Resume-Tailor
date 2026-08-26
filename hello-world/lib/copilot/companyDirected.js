// AC-V4.6/V4.6.1. Whether a question is ABOUT the employer — the one case
// where a live answer WAITS for the verified-company-facts lookup
// (companyFactsSource.js's buildCompanyFacts) instead of being drafted
// without it. See lib/copilot/companyFacts.js and
// lib/copilot/companyFactsSource.js for what "the lookup" actually is; this
// module has no idea a search exists at all — it is pure text classification,
// nothing else.
//
// THIS IS DELIBERATELY NOT A RELEVANCE SCORE. This repo has already spent
// four rounds on a hand-tuned word score for a related problem — "is this
// page relevant enough to speak aloud" — and the record is unambiguous about
// how that went: bare keyword overlap answered a question about disagreeing
// with a manager using a BEEKEEPING page, and every subsequent fix moved the
// hole to a different sentence rather than closing it. What finally worked
// was changing the KIND of rule, not tuning the existing one. So this
// function has exactly TWO structural conditions, no weights, no thresholds,
// and no score to tune:
//
//   1. the employer is NAMED. The company name is DATA — it comes out of the
//      user's own `positions` row (lib/copilot/applicationDocs.js's
//      fetchPostingEmployer), so it is different for every user and cannot
//      be tuned by anyone editing this file.
//   2. a determiner from the CLOSED set {the, this, your} immediately in
//      front of the head noun {company, organisation, organization}. This is
//      a grammatical paradigm — the complete set of English determiners that
//      make that head noun refer to the addressee's own employer — not a
//      curated phrase list, and it cannot grow without someone noticing that
//      it is growing.
//
// THE ASYMMETRY THAT MAKES A NARROW RULE THE RIGHT CHOICE (ARCH §2.5): a
// MISS costs exactly one factless answer, and only when the company question
// happens to be the FIRST question of the session — the facts build starts
// on question one regardless of what this function says, so every later
// question has the facts either way. A FALSE POSITIVE costs, at most, the
// bounded deadline the route waits before answering anyway (FACTS_DEADLINE_MS
// in app/api/copilot/answer/route.js). Neither failure mode is expensive
// enough to justify widening this past two structural conditions — in
// particular, no "you guys", no "here", no "the role", no "the team", no verb
// list, no question-word list. If a future round wants to widen this, the
// fix is a new structural condition, never a new word.
import { normalizeQuestion } from "./questions.js";

// Regex-escapes every character `RegExp` would otherwise treat specially, so
// a company name containing one (rare, but "AT&T", "Yahoo!", "Dunder
// Mifflin, Inc." all exist) is matched as literal text rather than partially
// interpreted as a pattern.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// AC-V4.6.1 (rule 1): a posting's stored company name frequently carries a
// legal suffix nobody actually says out loud ("Acme Inc.", "Acme, LLC").
// Strips one trailing suffix, tolerating a preceding comma-or-space and an
// optional trailing period. Requires an ACTUAL leading separator character
// (a comma, or at least one space) before the suffix — never just position 0
// — which is what keeps a company literally named "Co" or "SA" (the whole-
// token substring test below) from being stripped down to an empty string:
// there is nothing in front of the suffix token to consume in that case, so
// the regex simply does not match and the name passes through unchanged.
const LEGAL_SUFFIX_RE = /(,\s*|\s+)(?:inc|llc|ltd|corp|co|gmbh|plc|sa|bv)\.?$/i;

function stripLegalSuffix(normalizedCompany) {
  const stripped = normalizedCompany.replace(LEGAL_SUFFIX_RE, "").trim();
  // Never return an empty string: a company name that IS entirely a legal
  // suffix word (there is no realistic case, but this function must never
  // manufacture "match everything" out of one) falls back to the original.
  return stripped || normalizedCompany;
}

// AC-V4.6.1 (rule 2): the closed determiner set and the two spellings of the
// head noun. `HEAD_NOUN_END_SRC` is the boundary guard voiceCues.js already
// solved for its own "the company" cue (COMPANY_END_SRC there) — reused as
// the same STRUCTURAL idea, not the same literal pattern, because this rule
// additionally has to admit a possessive ("your company's market") that the
// voiceCues.js cue never needed to. The head noun must be followed by
// end-of-utterance, a punctuation mark, or a possessive "'s" — never by a
// bare word, which is what would let "company" read as the front half of a
// DIFFERENT compound noun ("the company culture", "the company retreat").
// Confirmed false positives of the unguarded pattern, recorded here because
// voiceCues.js recorded the same two shapes for its own cue: "What is the
// company culture like?" (a question about culture in general, not the
// employer) and "How many people were at the company you worked for?" (the
// CANDIDATE's previous employer, not the one being interviewed for).
const DETERMINER_SRC = "(?:the|this|your)";
const HEAD_NOUN_SRC = "(?:company|organisation|organization)";
const HEAD_NOUN_END_SRC = "(?=$|[.,!?;:]|['’]s\\b)";
const DETERMINER_HEAD_NOUN_RE = new RegExp(`\\b${DETERMINER_SRC}\\s+${HEAD_NOUN_SRC}${HEAD_NOUN_END_SRC}`);

// AC-V4.6.1. Never throws — it rides beside an answer the candidate is
// waiting on mid-question (the same reason buildCompanyFacts, below in
// companyFactsSource.js, never rejects), so every malformed input degrades
// to `false` rather than an exception the route would have to guard against
// a second time.
export function isCompanyDirected(question, options) {
  const text = typeof question === "string" ? question : "";
  if (!text) return false;
  // normalizeQuestion (questions.js) is reused rather than reinvented, for
  // the same reason voiceCues.js already reuses it: it is the exact
  // lowercase/whitespace-collapse normalization live speech already goes
  // through, and it deliberately does NOT strip punctuation — every pattern
  // below depends on a trailing "?"/"."/"," still being present to anchor on.
  const normalized = normalizeQuestion(text);
  if (!normalized) return false;

  // Rule 1: the employer is named.
  const opts = options && typeof options === "object" ? options : {};
  const rawCompany = typeof opts.company === "string" ? opts.company.trim() : "";
  if (rawCompany) {
    const normalizedCompany = stripLegalSuffix(normalizeQuestion(rawCompany));
    const tokens = normalizedCompany
      .split(" ")
      .filter(Boolean)
      .map(escapeRegExp);
    if (tokens.length > 0) {
      // Whole tokens only, never a substring — `\b` on both ends is what
      // keeps a two-letter company name ("Co", "SA") from matching inside
      // an ordinary word ("coffee", "salary") that merely contains those
      // letters. A substring rule would make a short company name match
      // most sentences in the language.
      const namePattern = new RegExp(`\\b${tokens.join("\\s+")}\\b`);
      if (namePattern.test(normalized)) return true;
    }
  }

  // Rule 2: determiner + head noun, ending the phrase. Independent of
  // whether a company is on file at all — it is the fallback for exactly
  // the case rule 1 cannot serve (no company name known yet).
  return DETERMINER_HEAD_NOUN_RE.test(normalized);
}
