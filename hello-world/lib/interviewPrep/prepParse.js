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
//                     sourceUrl behind it. Uncited -> dropped.
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
// SCOPE, STATED HONESTLY. design-structure.r1.md §9 names
// `AnswerLine`/`Question.text`/`Stage.recommendedAnswer` as the scanned
// surfaces; no binding document gives a concrete shape for `AnswerLine` or
// `Question`, and no fixture in this file's own test suite constructs one.
// This module therefore only normalizes `pack.sections.stages[]`
// (`recommendedAnswer`) -- the one shape every binding document fully
// specifies. A real `Pack` may carry additional section kinds this file
// never touches; extending coverage to them needs their own shape and their
// own failing test first, not a guess encoded here.

const NAME_PAIR_RE = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g;

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
 * consecutive Title-Case word pair whose second word is not a common
 * organization-shaped noun. Pure, total -- never throws, always returns a
 * boolean.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function containsDetectedName(text) {
  if (typeof text !== "string" || !text) return false;
  NAME_PAIR_RE.lastIndex = 0;
  let match = NAME_PAIR_RE.exec(text);
  while (match) {
    if (!ORG_SUFFIX_WORDS.has(match[2])) return true;
    match = NAME_PAIR_RE.exec(text);
  }
  return false;
}

/** A vertexaisearch redirect proxy never resolves to the publisher page it
 *  points at, so it does not count as a citation -- see
 *  [[gemini-grounding-redirects]] and contract C-46. */
function isRedirectUrl(url) {
  return /vertexaisearch\.cloud\.google\.com/i.test(url);
}

/** K1-SHAPE: does `support` resolve, through `claims`, to a genuine,
 *  non-redirect citation? */
function isCitedClaim(support, claims) {
  if (!support || support.kind !== "claim") return false;
  const claim = claims[support.claimId];
  if (!claim || typeof claim.sourceUrl !== "string") return false;
  const sourceUrl = claim.sourceUrl.trim();
  if (!sourceUrl) return false;
  return !isRedirectUrl(sourceUrl);
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

/** Applies K1-SHAPE then K1-PROHIBITION to one stage. A line that fails
 *  either check is dropped -- its `recommendedAnswer` becomes `null` rather
 *  than the stage entry being removed, so any other field the stage carries
 *  survives. A line naming nobody is returned unchanged. */
function normalizeStage(stageEntry, claims) {
  if (!stageEntry || typeof stageEntry.recommendedAnswer !== "string") return stageEntry;
  const text = stageEntry.recommendedAnswer;
  if (!containsDetectedName(text)) return stageEntry;

  if (!isCitedClaim(stageEntry.support, claims)) {
    return { ...stageEntry, recommendedAnswer: null };
  }
  if (PREDICTION_PREDICATE.test(text)) {
    return { ...stageEntry, recommendedAnswer: null };
  }
  return stageEntry;
}

/**
 * The O-15 write/read choke point. Runs at write time (before a generated
 * pack is stored) and at read time (before any pack reaches a candidate's
 * screen) -- the same function, so there is only ever one place this rule
 * can be bypassed, not two independently-maintained copies.
 *
 * Pure and total: never throws, and a pack with no stages normalizes to an
 * empty stage list rather than an error.
 *
 * @param {*} pack
 * @returns {*} the same pack, with any stage failing K1-SHAPE or
 *   K1-PROHIBITION carrying `recommendedAnswer: null` in place of the
 *   generated text.
 */
export function normalizePack(pack) {
  if (!pack || typeof pack !== "object") return pack;
  const sections = pack.sections && typeof pack.sections === "object" ? pack.sections : {};
  const stages = Array.isArray(sections.stages) ? sections.stages : [];
  const claims = pack.claims && typeof pack.claims === "object" ? pack.claims : {};

  const normalizedStages = stages.map((stageEntry) => normalizeStage(stageEntry, claims));

  return { ...pack, sections: { ...sections, stages: normalizedStages }, claims };
}
