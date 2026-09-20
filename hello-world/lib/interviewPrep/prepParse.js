// normalizePack -- the O-15 write/read choke point (design-structure.r1.md
// §9, design-operate.r1.md §1). Runs at BOTH write time (before a generated
// pack is stored) and read time (before any pack reaches a candidate's
// screen), so the two instruments below bind production behaviour, not
// merely a CI check.
//
// O-15: "a pack MAY name a real person only as the subject of a
// corroborated, cited company fact -- never as a prediction about who will
// interview the candidate." That is TWO independent constraints, closed by
// two independent instruments that never substitute for one another:
//
//   K1-SHAPE       -- a citation constraint on the CLAIM: a detected name
//                     implies a resolvable, non-empty, non-redirect
//                     sourceUrl behind it. Uncited -> refused.
//   K1-PROHIBITION -- a content/predicate constraint on the SENTENCE
//                     containing the name: even when cited, it must not
//                     assert a prediction about who will be in the
//                     interview. A citation cannot license a prediction.
//
// K1-PROHIBITION's predicate is the SIX independent terms design-operate.r1
// §1b names, matched structurally (any one term refuses the line on its
// own) -- never a lookup table keyed on the two example sentences that
// happen to share "panel" and "will most likely include". rulings.md
// R-IP3-63/R-IP3-64 record why that distinction matters: a build that
// hardcodes those two n-grams passes every visible fixture and still ships
// a held-out, structurally-identical prediction unrefused. Nothing in this
// file enumerates specific sentences; the six terms below are copied
// verbatim from design-operate.r1.md §1b, and are the whole mechanism.
//
// The redirect-shaped citation rule (contract C-46 / R-IP3-55 item 1): a
// `sourceUrl` that is a vertexaisearch redirect proxy is not "cited" for
// K1-SHAPE, because it never resolves to the publisher page a candidate
// could actually check -- see [[gemini-grounding-redirects]].
//
// SHAPE, RESOLVED BY THE MIGRATION. supabase/migrations/
// 20260914000000_interview_prep.sql's `interview_prep_packs_ready_is_complete`
// CHECK (~:194-211) names the four scanned surfaces and their exact JSON
// paths directly, closing what an earlier revision of this file recorded as
// unresolvable:
//
//   pack #> '{sections,aboutYou,answer,lines}'  jsonb array; AnswerLine[]
//   pack #> '{sections,whyRole,answer,lines}'   jsonb array; AnswerLine[]
//   pack #> '{sections,askThem,questions}'      jsonb array; Question[]
//   pack #> '{sections,stages,stages}'          jsonb array; Stage[]
//
// The `stages` section is `{ stages: Stage[] }` -- one level deeper than the
// other three, because "stages" names both the section key and its one
// field. An earlier revision of `normalizePack` read `sections.stages`
// itself as the array (`Array.isArray(sections.stages)`), which is `false`
// for this shape, so a correctly-shaped pack's entire stage list was
// silently replaced with `[]` at both write and read time. This file
// normalizes all four surfaces, not stages alone; see prepParse.test.js for
// the regression coverage and `lib/interviewPrep/prepPack.js` for the
// derived `completeSections`/`packStatus` predicate this shape enables.
//
//   Pack = { version: 1, sections: {
//     aboutYou: { answer: { lines: AnswerLine[] } },
//     whyRole:  { answer: { lines: AnswerLine[] } },
//     askThem:  { questions: Question[] },
//     stages:   { stages: Stage[] },
//   }, claims: Claim[], templateOrigin?: "embedded-template" }
//   AnswerLine = { text, support? }   Question = { text, support? }
//   Stage = { name, questions: string[], recommendedAnswer: string|null, support? }
//   Support = { kind: "claim", claimId }   Claim = { id, text, sourceUrl }
//
// F-1's K1-SHAPE EXEMPTION, NARROWLY SCOPED -- AND NARROWLY JUSTIFIED. The
// embedded (no-LLM) engine's pack is our own fixed template with the
// posting's own title/company interpolated (lib/interviewPrep/prepPack.js's
// buildEmbeddedPack). An EARLIER revision of this comment justified
// exempting the WHOLE resulting sentence with "it is never model text, and
// it cannot name a real person" -- that was false for the interpolated
// spans specifically: `position.title`/`position.company` are merged from
// EXTERNAL job feeds (lib/supabase/writePosition.js, keyed on
// `external_id`), not authored by this template, and a feed row can carry
// anything, including a string shaped like a real person's name. The
// exemption below is correct only for the template's OWN fixed wording,
// which we author and which can never name anyone -- it must not be
// stretched to cover a feed-supplied value just because that value gets
// interpolated into the same sentence.
//
// This file's exemption mechanism does not itself distinguish "template
// wording" from "interpolated value" -- normalizePack sees one flat string.
// The actual fix lives on the producer side: buildEmbeddedPack screens
// `title`/`company` with this file's own `containsDetectedName` BEFORE
// interpolating, and falls back to generic wording ("this role"/"this
// company") for a value that reads as a detected name, so a name-shaped
// feed value is never interpolated in the first place. The two phrases are
// composed INDEPENDENTLY, so a resolved title beside an unresolved company
// still reads grammatically -- an earlier form substituted a noun phrase
// into a slot that already carried "the ... role", producing "the this
// position role at the company" for most real postings -- see that
// function's own header for the full rationale, including the N16 wave G
// ruling that DELETED `title`'s own job-noun allow-list once it was measured
// to leak uncited real names (e.g. "Director Maria Garcia") past the very
// screen it was meant to pass through. `title` is now screened by
// `containsDetectedName` exactly like `company` always was, with no
// per-field carve-out: an ordinary two-word title like "Software Engineer"
// now falls back to generic wording again, the same as any other value this
// heuristic cannot tell apart from a person's name. K1-PROHIBITION
// (never predict who is in the interview) is NOT exempted by any of this;
// it is a content predicate, not a citation one, and it runs on every path
// without exception, embedded included.
//
// The exemption is keyed on `pack.templateOrigin === EMBEDDED_TEMPLATE_ORIGIN`
// (a plain, jsonb-safe string field) rather than a call-site flag, because
// `normalizePack` is invoked with a single `pack` argument at every call site
// that matters (prepStore.js's writePrepPackResult/readPrepPack run it again,
// unconditionally, at every subsequent write and read) -- a decision that
// lived outside `pack`'s own data would silently un-exempt previously-kept
// content on the very next read, the same "second pass sees only what the
// first pass already dropped" trap F-2 documents below.
//
// UNREACHABLE FROM THE MODEL PATH: `buildEmbeddedPack` is this field's only
// legitimate producer. The model's reply is free-form JSON
// (`parsePrepResponse` just `JSON.parse`s it), so nothing in this file alone
// stops a hostile reply from including the identical key to claim the
// exemption for itself -- the actual enforcement point is route.js's
// generation path, which strips `templateOrigin` off the parsed reply BEFORE
// calling `normalizePack`, so a model-supplied value never reaches this
// function on that path. prepParse.test.js proves the negative directly: a
// pack shaped exactly like an unstripped hostile reply (uncited name,
// `templateOrigin` set) is still refused once the field is cleared, the same
// way route.js clears it.

// N26: the given-name lexicon backing `containsDetectedName` below. A
// static, bundler-resolved import (ac.r5.md WB-4) -- never `fs.readFileSync`/
// `fs.promises.readFile` at request time, and never behind a
// `process.env`/environment-conditional branch. This is the same loading
// pattern `lib/llm/engines/tailor-lite/library/defaults.js:8` already uses
// for `skills_taxonomy.json`, so there is no separate file-tracing
// configuration for a serverless build to get right or wrong (see
// givenNames.generated.js's own header for the full provenance chain: US
// SSA national given-name data, public domain, sha256-pinned source archive,
// and the disclosed, re-runnable generation script at
// scripts/generate-given-names.mjs).
import { GIVEN_NAMES } from "./data/givenNames.generated.js";

// The exact value `pack.templateOrigin` must carry for F-1's K1-SHAPE
// exemption to apply -- see this file's header. Exported so
// lib/interviewPrep/prepPack.js's `buildEmbeddedPack` (the only legitimate
// producer) and route.js's generation-path stripping (the only legitimate
// handling of an untrusted value) both read the identical literal, rather
// than two files agreeing on a magic string by convention alone.
export const EMBEDDED_TEMPLATE_ORIGIN = "embedded-template";

// N26's lexicon-backed detector, replacing the earlier lexicon-free
// heuristic this comment used to disclose as permanently weak-by-design.
// What actually ships (backlog N26; ac.r5.md WB-1/WB-2, ledger R-N26-9
// through R-N26-14):
//
//   - a Title-Case RUN is a maximal sequence of consecutive Title-Case
//     words separated only by whitespace (TITLE_CASE_RUN_RE below);
//   - every CONSECUTIVE pair within a run is examined -- a SLIDING,
//     overlapping scan (WB-2), not a run consumed two words at a time. A
//     3-word run like "Analyst Robert Klein" is checked as (Analyst,
//     Robert) AND (Robert, Klein), not only the first pair;
//   - a pair counts as a detected name iff its FIRST word, lowercased, is a
//     registered given name in the shipped SSA lexicon below AND its
//     second word is not one of the 23 ORG_SUFFIX_WORDS (WB-1,
//     first-word-only -- never either-word, never an unconditioned
//     single-word scan).
//
// GIVEN_NAME_SET is a module-level singleton built once from the shipped,
// full, unfiltered (threshold 0 -- WB-8) GIVEN_NAMES array, matching the
// existing ORG_SUFFIX_WORDS pattern -- never rebuilt inside
// containsDetectedName itself.
//
// DISCLOSED LIMITATIONS, not fixed by this lexicon:
//   - coverage is bounded by SSA's own reporting floor: a name that never
//     reached >=5 occurrences nationally in a single year, 1880-2020, is
//     absent from the lexicon in every culture, by construction (not a
//     tuning choice made here -- see the generated module's own header);
//   - a hyphenated first name is caught only by luck, via whichever half
//     lands next to a real surname in a Title-Case run; a particle-bearing
//     name (van der / de la / von / bin / al, lowercase) breaks the
//     adjacency this pair-scan structurally requires, so the lexicon
//     provides zero help there;
//   - this lexicon addresses roughly the GIVEN-NAME share of the false
//     positives this detector used to produce over ordinary résumé/title
//     prose (~43% of the measured residual, ac.r3.md/R-N26-9's own
//     finding) -- the remaining ~57%, employer-PAIR-shaped prose (two
//     ordinary words that read as a company, not a person), is NOT
//     addressed by a given-name lexicon and remains open;
//   - this is a backstop, not the primary control: the prompt this
//     detector's output feeds is separately instructed never to name a
//     real person (a sibling chunk), so a name this lexicon misses is a
//     backstop failure, not the only line of defense (R-N26-9/R-N26-10).
const TITLE_CASE_RUN_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;

const GIVEN_NAME_SET = new Set(GIVEN_NAMES);

// Common organization-shaped second words in a Title-Case pair, so a
// sentence naming a company ("Acme Robotics") is not mistaken for one
// naming a person. This is a deliberately small, disclosed heuristic, not a
// claim of general-purpose name detection -- see the K1-SHAPE residual
// design-operate.r1.md §1a already discloses (a name form the detector
// fails to recognise passes silently).
const ORG_SUFFIX_WORDS = new Set([
  "Robotics",
  "Solutions",
  "Systems",
  "Technologies",
  "Technology",
  "Industries",
  "Group",
  "Holdings",
  "Networks",
  "Software",
  "Labs",
  "Laboratories",
  "Company",
  "Corporation",
  "Partners",
  "Ventures",
  "Capital",
  "Global",
  "Enterprises",
  "Services",
  "Consulting",
  "Analytics",
  "Studios",
]);

/**
 * Detects a plausible personal name in a line of generated text: a
 * consecutive Title-Case word pair whose FIRST word is a registered given
 * name in the shipped SSA lexicon and whose SECOND word is not a common
 * organization-shaped noun (see the header above for the full mechanism and
 * its disclosed limitations). Every consecutive pair in a Title-Case run is
 * examined, sliding one word at a time -- not merely the even-indexed ones a
 * run consumed two words per match would see. Pure, total -- never throws,
 * always returns a boolean.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function containsDetectedName(text) {
  if (typeof text !== "string" || !text) return false;
  TITLE_CASE_RUN_RE.lastIndex = 0;
  let runMatch = TITLE_CASE_RUN_RE.exec(text);
  while (runMatch) {
    const words = runMatch[0].split(/\s+/);
    for (let i = 0; i < words.length - 1; i += 1) {
      if (GIVEN_NAME_SET.has(words[i].toLowerCase()) && !ORG_SUFFIX_WORDS.has(words[i + 1])) {
        return true;
      }
    }
    runMatch = TITLE_CASE_RUN_RE.exec(text);
  }
  return false;
}

/**
 * N33's additive sibling of `containsDetectedName`, built from the identical
 * scan (same `TITLE_CASE_RUN_RE`, same `GIVEN_NAME_SET`/`ORG_SUFFIX_WORDS`
 * gate) -- collects EVERY qualifying two-word span instead of returning on
 * the first. `containsDetectedName`'s own signature and behaviour are
 * completely unchanged by this export (N26 ledger constraint #1) -- this is
 * a new function, not an edit to the existing one, and the two can never
 * disagree on whether a text contains a detected name at all.
 *
 * @param {unknown} text
 * @returns {string[]} every detected two-word span, in the order found;
 *   duplicates included if the same span appears twice.
 */
export function detectedNameSpans(text) {
  const spans = [];
  if (typeof text !== "string" || !text) return spans;
  TITLE_CASE_RUN_RE.lastIndex = 0;
  let runMatch = TITLE_CASE_RUN_RE.exec(text);
  while (runMatch) {
    const words = runMatch[0].split(/\s+/);
    for (let i = 0; i < words.length - 1; i += 1) {
      if (GIVEN_NAME_SET.has(words[i].toLowerCase()) && !ORG_SUFFIX_WORDS.has(words[i + 1])) {
        spans.push(`${words[i]} ${words[i + 1]}`);
      }
    }
    runMatch = TITLE_CASE_RUN_RE.exec(text);
  }
  return spans;
}

/** AC-N33.4's comparison normalization: Unicode-NFC, trim, then collapse an
 *  internal whitespace run to a single space. No other transform -- never
 *  case-folded (AC-N33.5) and never punctuation-stripped (SEC row #6). A
 *  non-string input normalizes to "", which never equals a real span (every
 *  real span is at least two non-empty words). */
function normalizeNameForComparison(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * The N33 O-15 exemption (ac.r1.md AC-N33.1/1.2/1.3). Pure, total, never
 * throws.
 *
 * True iff EVERY span `detectedNameSpans(text)` returns is, after the
 * normalization above, case-sensitively (AC-N33.5) equal to at least one
 * entry of `storedNames` (after the identical normalization). This is a
 * UNIVERSAL quantifier over spans, never an existential substring check --
 * "text contains a stored value somewhere" is the shape design-security.r1.md
 * SEC-N33.2/SEC-N33.3 demonstrate is a full bypass (a co-occurring unrelated
 * name, or a common-word stored name, both ship unrefused under that shape).
 * A text with zero detected spans is vacuously true, but that is moot in
 * production: the caller (`refusesLine`) only ever consults this after
 * `containsDetectedName(text)` is already true, which guarantees at least
 * one span exists. A missing/degenerate `storedNames` argument fails closed
 * (coerces to `[]`, matching nothing).
 *
 * @param {unknown} text
 * @param {unknown} storedNames  the flattened return of trustedNames.js's
 *   `flattenTrustedNames` -- never `pack`, `parsed`, `body`, or anything
 *   descending from a request body or a model reply.
 * @returns {boolean}
 */
export function isUserSuppliedName(text, storedNames) {
  const spans = detectedNameSpans(text);
  if (spans.length === 0) return true;
  const stored = Array.isArray(storedNames) ? storedNames : [];
  const normalizedStored = new Set(
    stored.map((value) => normalizeNameForComparison(value)).filter((value) => value.length > 0),
  );
  return spans.every((span) => normalizedStored.has(normalizeNameForComparison(span)));
}

/** A vertexaisearch redirect proxy never resolves to the publisher page it
 *  points at, so it does not count as a citation -- see
 *  [[gemini-grounding-redirects]] and contract C-46. */
function isRedirectUrl(url) {
  return /vertexaisearch\.cloud\.google\.com/i.test(url);
}

/** K1-SHAPE: does `support` resolve, through `claims`, to a genuine,
 *  non-redirect citation? `claims` is the array `normalizePack` guarantees
 *  (`interview_prep_packs_claims_is_array`), resolved by id rather than by
 *  index -- an absent `support.claimId` is refused before the lookup runs
 *  so it can never coincide with a claims entry that also carries no `id`. */
function isCitedClaim(support, claims) {
  if (!support || support.kind !== "claim" || !support.claimId) return false;
  const claim = claims.find((entry) => entry && entry.id === support.claimId);
  if (!claim || typeof claim.sourceUrl !== "string") return false;
  const sourceUrl = claim.sourceUrl.trim();
  if (!sourceUrl) return false;
  return !isRedirectUrl(sourceUrl);
}

/** F-1's exemption test, gated on `pack`'s OWN property (`Object.hasOwn`),
 *  never merely `pack.templateOrigin`'s resolved value. A plain `===`
 *  comparison reads through the prototype chain: if anything elsewhere in
 *  the process ever polluted `Object.prototype.templateOrigin` to
 *  `EMBEDDED_TEMPLATE_ORIGIN`, every model-authored pack -- which has no OWN
 *  `templateOrigin` of its own once route.js's generation path strips it --
 *  would still read that value through inheritance and be wrongly exempted.
 *  `Object.hasOwn` cannot be fooled by the prototype chain, so this is a
 *  fact about `pack`'s own data, exactly as the exemption's own design
 *  (this file's header) already requires. */
function isEmbeddedTemplateOrigin(pack) {
  return Object.hasOwn(pack, "templateOrigin") && pack.templateOrigin === EMBEDDED_TEMPLATE_ORIGIN;
}

/**
 * Normalizes `pack.claims` into the array shape
 * `interview_prep_packs_claims_is_array` requires whenever `status` is
 * `'ready'`/`'partial'` (supabase/migrations/20260914000000_interview_prep.sql):
 * `jsonb_typeof(pack -> 'claims') = 'array'`. An already-array input is
 * returned unchanged. A legacy or model-supplied object map
 * (`{ [claimId]: { text, sourceUrl } }`) is CONVERTED, not dropped -- each
 * entry becomes `{ ...value, id }`, carrying the map's own key forward as
 * `id` so `isCitedClaim`'s `.find` can still resolve it; dropping the map
 * instead would silently un-ground every citation it held. An entry whose
 * value is not a plain object is skipped rather than emitted malformed.
 * Any other input (`undefined`, `null`, a string, a number) defaults to `[]`.
 *
 * @param {*} rawClaims
 * @returns {Array<{id: string, [key: string]: *}>}
 */
function normalizeClaims(rawClaims) {
  if (Array.isArray(rawClaims)) return rawClaims;
  if (!rawClaims || typeof rawClaims !== "object") return [];
  return Object.entries(rawClaims)
    .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value))
    .map(([id, value]) => ({ ...value, id }));
}

// K1-PROHIBITION's predicate, copied verbatim from design-operate.r1.md §1b:
// "panel", "interview(er)?s?", "will (most likely |probably )?(include|meet|
// speak (with|to))", "your interviewer", "likely to (interview|meet|speak)",
// "hiring manager will". Any ONE term refuses the line on its own -- this is
// the structural predicate, not an enumeration of example sentences.
const PREDICTION_PREDICATE = new RegExp(
  [
    "panel",
    "interview(er)?s?",
    "will (most likely |probably )?(include|meet|speak (with|to))",
    "your interviewer",
    "likely to (interview|meet|speak)",
    "hiring manager will",
  ].join("|"),
  "i",
);

/**
 * The single O-15 predicate, applied identically by every surface that can
 * carry a name -- aboutYou/whyRole (AnswerLine), askThem (Question), and a
 * Stage's `name`/`questions[]`/`recommendedAnswer` (askThem is the
 * highest-risk of these, because the candidate reads it aloud to a
 * recruiter, but the rule itself does not vary by surface). `claims[].text`
 * is NOT one of these surfaces -- see the header above and
 * `refusesClaimText` below for why that field gets K1-PROHIBITION only,
 * never this function. Applies K1-SHAPE, then K1-PROHIBITION: a line naming
 * nobody never reaches either check.
 *
 * `exemptCitation` (F-1) skips K1-SHAPE ONLY when true. N33's `storedNames`
 * (ac.r1.md AC-N33.1-9) is the SAME kind of skip, reached independently: a
 * detected span that is entirely made up of the candidate's own stored
 * names (`isUserSuppliedName`, above) also does not need a citation, because
 * the candidate supplied the name themselves rather than the model
 * asserting it as a researched fact. Either skip -- citation or
 * user-supplied -- only ever excuses K1-SHAPE. K1-PROHIBITION always runs,
 * unconditionally, regardless of either flag -- a citation or a
 * correctly-exempted name can never license a prediction about who is in
 * the interview (AC-N33.9).
 *
 * @param {unknown} text
 * @param {*} support
 * @param {Array<{id: string, sourceUrl?: string}>} claims
 * @param {boolean} [exemptCitation]
 * @param {string[]} [storedNames]
 * @returns {boolean} true if the line must be refused.
 */
function refusesLine(text, support, claims, exemptCitation = false, storedNames = []) {
  if (typeof text !== "string" || !containsDetectedName(text)) return false;
  const allDetectedNamesAreUserSupplied = isUserSuppliedName(text, storedNames);
  if (!exemptCitation && !allDetectedNamesAreUserSupplied && !isCitedClaim(support, claims)) {
    return true; // K1-SHAPE
  }
  return PREDICTION_PREDICATE.test(text); // K1-PROHIBITION, unconditional -- AC-N33.9
}

/**
 * K1-PROHIBITION only, never K1-SHAPE -- a claim IS the cited material, so
 * requiring it to itself resolve a citation is circular and category-wrong
 * in exactly the way the embedded-template exemption above is (this file's
 * header). But K1-PROHIBITION is a content predicate, not a citation one,
 * and nothing stops a claim's own `text` from asserting an interviewer
 * prediction outright (F-4: `claims[].text` was never scanned at all before
 * this). `normalizePack` filters the claims array with this BEFORE any
 * section is normalized, so dropping a claim also correctly un-cites every
 * line whose `support.claimId` pointed at it -- that line then fails
 * K1-SHAPE through the ordinary citation-resolution path on the same pass,
 * not a special case.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
function refusesClaimText(text) {
  return typeof text === "string" && containsDetectedName(text) && PREDICTION_PREDICATE.test(text);
}

/** Plain-object guard used throughout normalizePack's shape repair: an
 *  array, `null`, or a primitive all coerce to `{}` rather than being read
 *  as a keyed container. */
function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Reads `sections.<name>.answer.lines` defensively; any malformed or
 *  missing intermediate container coerces to the empty list rather than
 *  throwing -- part of normalizePack's single shape-repair choke point. */
function extractAnswerLines(sectionValue) {
  const answer = asPlainObject(asPlainObject(sectionValue).answer);
  return Array.isArray(answer.lines) ? answer.lines : [];
}

/** Reads `sections.askThem.questions` defensively. */
function extractQuestions(sectionValue) {
  const section = asPlainObject(sectionValue);
  return Array.isArray(section.questions) ? section.questions : [];
}

/** Reads `sections.stages.stages` defensively -- the section itself is one
 *  level deeper than the other three surfaces; see the header above.
 *
 *  F-5: a back-compat limb for the FLAT shape (`sections.stages` itself an
 *  array, one level shallower) that the shipped embedded engine actually
 *  wrote before this wave's fix landed. Without it, a row already stored in
 *  that shape reads back as `[]` on every subsequent `normalizePack` call --
 *  `asPlainObject` coerces an array to `{}`, so `section.stages` was always
 *  `undefined` for exactly the rows this limb exists to recover. This is a
 *  read-time migration for rows written before this chunk, not a shape this
 *  file ever WRITES going forward -- `normalizePack`'s own output always
 *  nests under `{ stages: [...] }`. */
function extractStageList(sectionValue) {
  if (Array.isArray(sectionValue)) return sectionValue;
  const section = asPlainObject(sectionValue);
  return Array.isArray(section.stages) ? section.stages : [];
}

/** D: is `entry` a genuine `AnswerLine`/`Question` -- a plain object carrying
 *  a non-empty string `text`? A bare string/number/boolean/null the model
 *  returned where a line belongs is NOT content: keeping it let
 *  `packStatus`'s own `array.length > 0` test (and the identical database
 *  CHECK) read "ready" for a section with nothing a candidate could
 *  actually read. This is shape/emptiness validation, never a K1 refusal --
 *  it is checked BEFORE `refusesLine` runs, and never increments the
 *  `refused` count `countRefusedLines` reports, which counts O-15 content
 *  moderation only. */
function isUsableTextEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof entry.text === "string" &&
    entry.text.trim().length > 0
  );
}

/**
 * Applies `refusesLine` to a list of `AnswerLine`/`Question` entries.
 * F-3: a refused entry is DROPPED, never nulled in place -- nulling would
 * leave `jsonb_array_length` unchanged (still > 0), so the CHECK would pass
 * for a section whose every line is blank. Dropping shrinks the array, so a
 * gutted section reads as empty and the pack becomes honestly `partial`.
 * D: an entry that is not a genuine AnswerLine/Question at all (see
 * `isUsableTextEntry`) is dropped the same way, before `refusesLine` ever
 * runs on it.
 *
 * Also nulls a KEPT entry's own `support` whenever it does not actually
 * resolve to a citation (an absent `support`, a `claimId` that matches
 * nothing in `claims` because the claim it named was itself dropped by
 * `refusesClaimText`, or any other non-resolving shape) -- a dangling
 * `support.claimId` would otherwise persist and re-serve on a line that
 * never named anyone (so `refusesLine` never dropped it), letting a
 * renderer that draws a "cited" indicator purely from `support.claimId`'s
 * presence show a source link with nothing behind it.
 *
 * @param {Array<*>} rawList
 * @param {Array<{id: string, sourceUrl?: string}>} claims
 * @param {boolean} [exemptCitation]
 * @param {string[]} [storedNames]
 * @returns {{list: Array<*>, refused: number}}
 */
function normalizeDroppingList(rawList, claims, exemptCitation, storedNames) {
  let refused = 0;
  const list = [];
  for (const entry of rawList) {
    if (!isUsableTextEntry(entry)) continue;
    const { text, support } = entry;
    if (refusesLine(text, support, claims, exemptCitation, storedNames)) {
      refused += 1;
      continue;
    }
    if (support != null && !isCitedClaim(support, claims)) {
      list.push({ ...entry, support: null });
    } else {
      list.push(entry);
    }
  }
  return { list, refused };
}

/**
 * Scans one Stage's `name`, each `questions[]` entry, and `recommendedAnswer`
 * against the same O-15 predicate (F-4) -- the prompt asks the model for
 * `"questions": string[]` per stage, and `name` is free text the model
 * composes, so either can carry an uncited or predictive name exactly like
 * `recommendedAnswer` already could. All three are resolved through the
 * stage's own single `support` field -- the Pack contract gives a Stage
 * exactly one `support`, shared by everything on it.
 *
 * `name` and `recommendedAnswer` are nulled in place, matching this
 * function's own established "keep the stage, blank the field" discipline --
 * a stage is worth keeping even with its heading or answer withheld.
 * `questions[]` entries are DROPPED from their array instead: they are
 * candidate-facing interview-question text, the same kind of content
 * askThem's own Question[] holds, and this is exactly where an interviewer
 * prediction lands (the candidate reads it aloud to a recruiter).
 *
 * Also nulls the stage's own shared `support` (independent of the refusal
 * count below) whenever it does not actually resolve to a citation, the
 * same dangling-reference cleanup `normalizeDroppingList` performs for an
 * AnswerLine/Question -- applied here separately because a Stage's
 * `support` is ONE field shared by name/questions/recommendedAnswer, not
 * one per entry.
 *
 * F: returns the COUNT of individual pieces refused on this stage -- `name`
 * (0 or 1), each dropped `questions[]` entry (0..N), and `recommendedAnswer`
 * (0 or 1) -- never a boolean. A stage with a refused name, two refused
 * questions, and a refused recommendedAnswer refuses FOUR things and must
 * report 4: a per-stage boolean collapsed every one of those onto the same
 * "1", undercounting `countRefusedLines`' own total.
 *
 * @param {*} stageEntry
 * @param {Array<{id: string, sourceUrl?: string}>} claims
 * @param {boolean} [exemptCitation]
 * @param {string[]} [storedNames]
 * @returns {{stage: *, refused: number}}
 */
function normalizeStage(stageEntry, claims, exemptCitation, storedNames) {
  if (!stageEntry || typeof stageEntry !== "object") {
    return { stage: stageEntry, refused: 0 };
  }
  const support = stageEntry.support;
  let refused = 0;
  const next = { ...stageEntry };

  if (
    typeof stageEntry.name === "string" &&
    refusesLine(stageEntry.name, support, claims, exemptCitation, storedNames)
  ) {
    next.name = null;
    refused += 1;
  }

  if (Array.isArray(stageEntry.questions)) {
    next.questions = stageEntry.questions.filter((question) => {
      if (refusesLine(question, support, claims, exemptCitation, storedNames)) {
        refused += 1;
        return false;
      }
      return true;
    });
  }

  if (
    typeof stageEntry.recommendedAnswer === "string" &&
    refusesLine(stageEntry.recommendedAnswer, support, claims, exemptCitation, storedNames)
  ) {
    next.recommendedAnswer = null;
    refused += 1;
  }

  const supportDangling = support != null && !isCitedClaim(support, claims);
  if (supportDangling) next.support = null;

  return { stage: refused > 0 || supportDangling ? next : stageEntry, refused };
}

/**
 * Applies `normalizeStage` across `sections.stages.stages`.
 *
 * D: a raw stage entry that is not a plain object at all (a bare string,
 * number, boolean, or array the model returned where a Stage belongs) is
 * dropped from the list entirely, before `normalizeStage` ever runs on it --
 * `normalizeStage`'s own defensive `typeof stageEntry !== "object"` guard
 * used to pass such a value through UNCHANGED, so a single stray string
 * (e.g. `"nope"`) read as one non-empty array entry for `packStatus`'s
 * `stages.stages.length > 0` test without carrying anything a candidate
 * could read. Never counted as `refused` -- this is shape validation, not
 * O-15 content moderation, matching `normalizeDroppingList`'s identical
 * `isUsableTextEntry` discipline for the other three surfaces.
 *
 * @param {Array<*>} rawStages
 * @param {Array<{id: string, sourceUrl?: string}>} claims
 * @param {boolean} [exemptCitation]
 * @param {string[]} [storedNames]
 * @returns {{list: Array<*>, refused: number}}
 */
function normalizeStageList(rawStages, claims, exemptCitation, storedNames) {
  let refused = 0;
  const list = [];
  for (const stageEntry of rawStages) {
    if (!stageEntry || typeof stageEntry !== "object" || Array.isArray(stageEntry)) continue;
    const result = normalizeStage(stageEntry, claims, exemptCitation, storedNames);
    refused += result.refused;
    list.push(result.stage);
  }
  return { list, refused };
}

/**
 * The O-15 write/read choke point. Runs at write time (before a generated
 * pack is stored) and at read time (before any pack reaches a candidate's
 * screen) -- the same function, so there is only ever one place this rule
 * can be bypassed, not two independently-maintained copies.
 *
 * Pure and total: never throws. Normalizes all four `interview_prep_packs_
 * ready_is_complete` surfaces (aboutYou/whyRole/askThem/stages), applying
 * `refusesLine` identically to each via `normalizeDroppingList` (drop) or
 * `normalizeStageList` (which drops a Stage's own `questions[]` entries and
 * nulls its `name`/`recommendedAnswer` in place -- see that function's own
 * header for why the two disciplines coexist on one Stage). Also the sole
 * place `pack.claims` is coerced into the array shape the database requires
 * AND filtered for a claim whose own text asserts a K1-PROHIBITION violation
 * (`normalizeClaims`/`refusesClaimText`), and the sole place a missing or
 * malformed section is coerced into its empty skeleton
 * (`extractAnswerLines`/`extractQuestions`/`extractStageList`, all routed
 * through `asPlainObject`) -- this is O-15's single choke point for shape
 * repair; no other module in this feature repairs pack shape.
 *
 * F-2: this function does NOT report how many lines it refused. An earlier
 * revision returned `refusedLines` on its own output, but this same function
 * runs again, unconditionally, on ITS OWN prior output at both the next
 * write and every subsequent read (prepStore.js) -- a second pass sees only
 * the survivors of the first and has nothing left to refuse, so a counter
 * carried this way reads 1 on the first call and 0 on every call after,
 * silently. Running `normalizePack` twice IS safe (idempotent) precisely
 * because there is no longer an accumulating field like that on its return
 * value to double-count; `countRefusedLines` below is the correct, decoupled
 * way to get an honest count, computed once, off to the side.
 *
 * N33: `storedNames` (default `[]`, so every existing 1-argument call site
 * keeps behaving exactly as it does today -- no exemption applied) is
 * resolved by the CALLER, always from `trustedNames.js`'s
 * `readTrustedNames`/`flattenTrustedNames` scoped by the request's own
 * `applicationId`/`userId` -- never from `pack` itself. This function never
 * reads a `storedNames`/`candidateName`/`interviewerNames` field off `pack`
 * (a hostile model reply could plant one to try to launder its own
 * exemption); only the explicit second argument is ever consulted.
 * `refusesClaimText` (claims filtering, just above) takes NO `storedNames`
 * parameter -- it is K1-PROHIBITION-only with no citation branch to exempt
 * (RD-N33.5), so claims filtering is identical with or without it.
 *
 * @param {*} pack
 * @param {string[]} [storedNames]
 * @returns {*} the same pack, with all four sections normalized into their
 *   canonical shape and `claims` guaranteed to be an array.
 */
export function normalizePack(pack, storedNames = []) {
  if (!pack || typeof pack !== "object") return pack;
  const sections = asPlainObject(pack.sections);
  const claims = normalizeClaims(pack.claims).filter((claim) => !refusesClaimText(claim?.text));
  const exemptCitation = isEmbeddedTemplateOrigin(pack);

  const aboutYou = normalizeDroppingList(extractAnswerLines(sections.aboutYou), claims, exemptCitation, storedNames);
  const whyRole = normalizeDroppingList(extractAnswerLines(sections.whyRole), claims, exemptCitation, storedNames);
  const askThem = normalizeDroppingList(extractQuestions(sections.askThem), claims, exemptCitation, storedNames);
  const stages = normalizeStageList(extractStageList(sections.stages), claims, exemptCitation, storedNames);

  return {
    ...pack,
    sections: {
      ...sections,
      // F-6: spread the EXISTING wrapper first, then override only the
      // canonical field -- a prior revision rebuilt each wrapper from
      // scratch, silently discarding any non-canonical field it carried
      // (the Pack contract at the top of this file names no other field on
      // any of the four wrappers today, but a caller-added one should
      // survive a normalize pass rather than being destroyed by it).
      aboutYou: { ...asPlainObject(sections.aboutYou), answer: { lines: aboutYou.list } },
      whyRole: { ...asPlainObject(sections.whyRole), answer: { lines: whyRole.list } },
      askThem: { ...asPlainObject(sections.askThem), questions: askThem.list },
      stages: { ...asPlainObject(sections.stages), stages: stages.list },
    },
    claims,
  };
}

/**
 * Counts how many lines/questions/stage-fields `normalizePack` would refuse
 * for `pack`, without mutating or normalizing `pack` itself (F-2). See
 * `normalizePack`'s own header just above for why this is a SEPARATE, pure
 * function rather than a field on that function's return value: the route
 * calls this ONCE, on the model's raw reply, alongside the claims array
 * `normalizePack` already produced from that same reply (claims filtering is
 * a shape-repair/K1-PROHIBITION step, not itself a refusal count, so reusing
 * it here does not change what this function counts).
 *
 * N33: `storedNames` (default `[]`, backward compatible with every existing
 * 2-argument call) is forwarded identically to `normalizePack`'s own
 * threading -- see that function's own header for the source discipline
 * (never read off `pack` itself). `refusesClaimText`'s own count, just
 * below, is unaffected by it (RD-N33.5).
 *
 * @param {*} pack
 * @param {Array<{id: string, sourceUrl?: string}>} claims
 * @param {string[]} [storedNames]
 * @returns {number}
 */
export function countRefusedLines(pack, claims, storedNames = []) {
  if (!pack || typeof pack !== "object") return 0;
  const sections = asPlainObject(pack.sections);
  const resolvedClaims = Array.isArray(claims) ? claims : [];
  const exemptCitation = isEmbeddedTemplateOrigin(pack);

  // F: a claim `normalizePack` itself would drop via `refusesClaimText` is a
  // refusal too -- computed here off the RAW `pack.claims` (never the
  // already-filtered `claims` argument, which is what survived that same
  // drop) so it is not silently omitted the way it used to be.
  const claimsRefused = normalizeClaims(pack.claims).filter((claim) => refusesClaimText(claim?.text)).length;

  const aboutYou = normalizeDroppingList(extractAnswerLines(sections.aboutYou), resolvedClaims, exemptCitation, storedNames);
  const whyRole = normalizeDroppingList(extractAnswerLines(sections.whyRole), resolvedClaims, exemptCitation, storedNames);
  const askThem = normalizeDroppingList(extractQuestions(sections.askThem), resolvedClaims, exemptCitation, storedNames);
  const stages = normalizeStageList(extractStageList(sections.stages), resolvedClaims, exemptCitation, storedNames);

  return aboutYou.refused + whyRole.refused + askThem.refused + stages.refused + claimsRefused;
}
