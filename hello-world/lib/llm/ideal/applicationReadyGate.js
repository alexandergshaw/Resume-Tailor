// N105 Step 3a - the truthfulness gate for the application-ready resume
// (AC-4), PURE and engine-agnostic. It runs DOWNSTREAM of whatever an engine
// produced and sorts each candidate span into kept / flagged / dropped.
//
//   SUPPORT     a claim is supported by exactly ONE span of the user's own real
//               material iff every FACTUAL TOKEN in it traces to that one span:
//               each quantity or metric, each named entity, and each authority,
//               seniority or leadership assertion. Rewording that introduces no
//               new factual token is allowed (the step-5 aggressive-but-truthful
//               reframe). Never a union of spans, never a whole document.
//   MEMBERSHIP  that span must belong to the context the claim appears in. A
//               real metric under employer A cannot support a bullet under B.
//   LIVENESS    nothing here drops a supported claim, and a claim that repeats
//               a real in-context line is always kept, so the gate cannot
//               degrade into drop-everything.
//
// Fail closed: in doubt, the claim is not kept. A claim that is anchored to
// something real but adds an unverifiable token is FLAGGED (the user can verify
// and add it back); one with no anchor is DROPPED. Neither is ever returned as
// kept. The caller recomposes the document from `kept` only.
//
// Whether a claim paraphrases the real line is decided by a deterministic
// proxy: light stemming and a minimum share of the claim's content stems found
// in the span (MIN_CONTENT_OVERLAP). That is what lets "Cut support-ticket
// volume" stand on "Reduced support tickets" while "Reduced support tickets at
// Beta LLC" cannot stand on a span about a budget at Beta LLC.

// The ONE unverified-claim flag string (AC-4). Imported, never retyped.
export const UNVERIFIED_FLAG = "unverified — confirm before use";

// Why a span did not pass. Closed set; the removed/left-out presentation table
// is keyed by these codes.
export const GATE_REASON = Object.freeze({
  PARTIAL_MATCH: "partial-match", // flagged: anchored in real material, adds an unverified token
  NO_MATCH: "no-match", // dropped: nothing in the user's material supports it
  MEMBERSHIP: "membership", // dropped: real material exists, but under a different employer
});

const MIN_CONTENT_OVERLAP = 0.5;

const NUMBER_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

// Leadership / ownership / seniority assertions, grouped so a synonym of the
// same strength traces ("managed" <-> "led") but a stronger claim does not.
const AUTHORITY_CLASSES = {
  lead: [
    "led", "lead", "leads", "leading", "leader", "leadership", "headed", "head", "heading",
    "directed", "directs", "directing", "director", "managed", "manage", "manages",
    "managing", "manager", "management", "supervised", "supervise", "supervises",
    "supervising", "supervisor", "oversaw", "oversee", "oversees", "overseeing",
    "spearheaded", "spearhead", "spearheads", "spearheading",
  ],
  mentor: ["mentored", "mentor", "mentors", "mentoring", "coached", "coach", "coaches", "coaching"],
  own: ["owned", "own", "owns", "owner", "ownership"],
  found: ["founded", "founder", "cofounded", "cofounder", "founding"],
  senior: [
    "senior", "sr", "principal", "staff", "chief", "executive", "vp", "svp", "evp",
    "president", "cto", "ceo", "cfo", "coo", "cio", "cmo",
  ],
};
const AUTHORITY_OF = new Map();
for (const [cls, words] of Object.entries(AUTHORITY_CLASSES)) {
  for (const w of words) AUTHORITY_OF.set(w, `auth:${cls}`);
}

// Scope nouns: "led a team" needs a team in the real line; "global" needs a
// global scope. Plurals fold to one token.
const SCOPE_OF = new Map([
  ["team", "scope:team"], ["teams", "scope:team"],
  ["org", "scope:org"], ["orgs", "scope:org"], ["organization", "scope:org"],
  ["organizations", "scope:org"], ["organisation", "scope:org"], ["organisations", "scope:org"],
  ["department", "scope:department"], ["departments", "scope:department"],
  ["division", "scope:division"], ["divisions", "scope:division"],
  ["enterprise", "scope:enterprise"], ["global", "scope:global"], ["globally", "scope:global"],
  ["worldwide", "scope:global"], ["international", "scope:global"], ["nationwide", "scope:national"],
]);

const QUANTITY_OF = new Map([
  ["hundreds", "qty:hundreds"], ["thousands", "qty:thousands"], ["millions", "qty:millions"],
  ["billions", "qty:billions"], ["dozens", "qty:dozens"], ["dozen", "qty:dozens"],
  ["double", "qty:double"], ["doubled", "qty:double"], ["doubling", "qty:double"],
  ["triple", "qty:triple"], ["tripled", "qty:triple"], ["tripling", "qty:triple"],
  ["quadrupled", "qty:quadruple"], ["tenfold", "qty:tenfold"], ["twofold", "qty:twofold"],
]);

const PHRASE_TOKENS = [
  [/\bcompany[-\s]?wide\b/, "scope:company-wide"],
  [/\bcross[-\s]?functional\b/, "scope:cross-functional"],
  [/\b(?:org|organi[sz]ation)[-\s]?wide\b/, "scope:org-wide"],
  [/\bmulti[-\s]?(?:team|department)\b/, "scope:multi-team"],
  [/\bdirect reports?\b/, "scope:direct-reports"],
  [/\bvice president\b/, "auth:senior"],
  [/\bhead of\b/, "auth:lead"],
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "via", "per", "that", "this", "these",
  "those", "which", "while", "was", "were", "been", "being", "are", "its", "their", "our",
  "his", "her", "than", "more", "most", "less", "all", "each", "both", "such", "also",
  "within", "between", "about", "after", "before", "during", "when", "where", "who",
  "whom", "other", "etc", "not", "any", "over", "under", "through", "across", "using",
  "use", "uses", "onto", "upon", "out", "off", "one", "ones", "has", "had", "have",
]);

// Words that decorate a claim without asserting a fact of their own.
const NEUTRAL_WORDS = new Set([
  "volume", "level", "levels", "rate", "rates", "amount", "number", "overall", "total",
  "key", "major", "various", "several", "multiple", "new", "significant", "significantly",
  "successfully", "effectively", "efficiently", "directly", "highly", "strong", "strategic",
]);

// Capitalised function words that are not named entities when they appear
// mid-sentence in a Title Case line.
const ENTITY_STOP = new Set([
  "i", "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by",
  "from", "as", "vs", "via", "per", "into", "across", "over", "under", "my", "our", "we",
  "it", "its",
]);

// Past-tense lead verbs that do not end in -ed / -ing.
const IRREGULAR_LEAD_VERBS = new Set([
  "led", "built", "cut", "ran", "grew", "drove", "wrote", "made", "won", "took", "set",
  "put", "sold", "taught", "began", "chose", "found", "gave", "got", "held", "kept",
  "lost", "met", "paid", "read", "rose", "saw", "sent", "spent", "wove",
]);

const NUMBER_RE =
  /(?<![A-Za-z0-9])(\$)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:(%)|([kmbx])(?![A-Za-z0-9])|\s?(thousand|million|billion|percent)\b)?/gi;
const WORD_RE = /[A-Za-z][A-Za-z0-9]*(?:\+\+|#)?/g;
const MULTIPLIER = { k: 1e3, m: 1e6, b: 1e9, thousand: 1e3, million: 1e6, billion: 1e9 };

function canonicalNumber(dollar, intPart, frac, pct, suffix, word) {
  const unit = (suffix || word || "").toLowerCase();
  const value = Number(`${intPart.replace(/,/g, "")}${frac || ""}`) * (MULTIPLIER[unit] || 1);
  const sign = pct || unit === "percent" ? "%" : unit === "x" ? "x" : "";
  return `${dollar ? "$" : ""}${Number(value.toFixed(4))}${sign}`;
}

function stem(word) {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function normalizeKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
}

// Everything the gate compares about one line of text.
//   numbers    canonical quantities ("$200000", "40%", "10000000")
//   entities   mid-sentence proper nouns / acronyms, lowercase
//   marks      authority, scope and quantity-word tokens
//   words      every alphabetic word, lowercase (what an entity must trace to)
//   stems      content stems excluding the lead verb (the claim's own topic)
//   allStems   content stems including it (what a real line offers)
function analyze(text) {
  const raw = String(text ?? "");
  const numbers = new Set();
  const rest = raw.replace(NUMBER_RE, (_m, dollar, intPart, frac, pct, suffix, word) => {
    numbers.add(canonicalNumber(dollar, intPart, frac, pct, suffix, word));
    return " ";
  });

  const marks = new Set();
  const lowered = rest.toLowerCase();
  for (const [re, token] of PHRASE_TOKENS) if (re.test(lowered)) marks.add(token);

  const entities = new Set();
  const words = new Set();
  const stems = new Set();
  const allStems = new Set();

  for (const m of rest.matchAll(WORD_RE)) {
    const word = m[0];
    const lower = word.toLowerCase();
    words.add(lower);

    if (NUMBER_WORDS[lower] !== undefined) {
      numbers.add(String(NUMBER_WORDS[lower]));
      continue;
    }
    const mark = AUTHORITY_OF.get(lower) || SCOPE_OF.get(lower) || QUANTITY_OF.get(lower);
    if (mark) marks.add(mark);

    const before = rest.slice(0, m.index).trimEnd();
    const sentenceStart = before === "" || /[.!?]$/.test(before);
    const loudShape = /^[A-Z][A-Z0-9]+$/.test(word) || /^[a-z]+[A-Z]/.test(word) || /^[A-Z][a-z]+[A-Z]/.test(word);
    const isEntity = sentenceStart ? loudShape : /^[A-Z]/.test(word) && !ENTITY_STOP.has(lower);
    if (isEntity) {
      entities.add(lower);
      continue;
    }

    if (mark || lower.length < 3 || STOPWORDS.has(lower) || NEUTRAL_WORDS.has(lower)) continue;
    const s = stem(lower);
    allStems.add(s);
    const isLeadVerb = before === "" && (IRREGULAR_LEAD_VERBS.has(lower) || /(?:ed|ing)$/.test(lower));
    if (!isLeadVerb) stems.add(s);
  }

  return { numbers, entities, marks, words, stems, allStems, norm: normalizeKey(raw) };
}

function contextWords(contextKey) {
  return new Set(normalizeKey(contextKey).split(" ").filter(Boolean));
}

// Does `real` (an analyzed real span) support `claim` (an analyzed candidate)?
// Entity tokens that merely name the claim's own context are exempt: the
// MEMBERSHIP check owns that relation.
function supports(claim, real, ctxWords) {
  if (claim.norm !== "" && claim.norm === real.norm) return true;
  for (const n of claim.numbers) if (!real.numbers.has(n)) return false;
  for (const mark of claim.marks) if (!real.marks.has(mark)) return false;
  let ownTokens = claim.numbers.size + claim.marks.size;
  for (const e of claim.entities) {
    if (ctxWords.has(e)) continue;
    ownTokens += 1;
    if (!real.words.has(e)) return false;
  }
  if (claim.stems.size === 0) return ownTokens > 0;
  return overlap(claim, real) >= MIN_CONTENT_OVERLAP && sharedStems(claim, real) >= 1;
}

function sharedStems(claim, real) {
  let shared = 0;
  for (const s of claim.stems) if (real.allStems.has(s)) shared += 1;
  return shared;
}

function overlap(claim, real) {
  return claim.stems.size === 0 ? 0 : sharedStems(claim, real) / claim.stems.size;
}

// Anchored without being fully supported: the claim talks about something in
// this real span (a shared topic stem, or a named entity it really has).
function anchoredIn(claim, real, ctxWords) {
  if (sharedStems(claim, real) >= 1) return true;
  for (const e of claim.entities) if (!ctxWords.has(e) && real.words.has(e)) return true;
  return false;
}

// applicationReadyGate({ candidateSpans, realMaterial })
//   candidateSpans  [{ id, text, section?, contextKey? }]   from decomposeToSpans
//   realMaterial    { spans: [{ id, text, contextKey? }], chronology? }
// => { kept: [{ id, text }],
//      flagged: [{ id, text, reason, flag }],
//      dropped: [{ id, text, reason }] }
//
// The real chronology (employers, dates, degrees) is not consulted here: those
// lines are layout, not content spans, and the orchestrator checks them against
// the chronology (AC-10).
export function applicationReadyGate({ candidateSpans, realMaterial } = {}) {
  const candidates = Array.isArray(candidateSpans) ? candidateSpans : [];
  const real = (Array.isArray(realMaterial?.spans) ? realMaterial.spans : [])
    .filter((r) => r && typeof r.text === "string")
    .map((r) => ({ key: normalizeKey(r.contextKey), info: analyze(r.text) }));

  const kept = [];
  const flagged = [];
  const dropped = [];

  for (const span of candidates) {
    const text = typeof span?.text === "string" ? span.text : "";
    const id = span?.id;
    if (text.trim() === "") {
      dropped.push({ id, text, reason: GATE_REASON.NO_MATCH });
      continue;
    }

    const claim = analyze(text);
    const key = normalizeKey(span.contextKey);
    const ctxWords = contextWords(span.contextKey);
    // An unscoped claim (summary, skills) has no employer to be a member of.
    const inContext = key === "" ? real : real.filter((r) => r.key === key);

    if (inContext.some((r) => supports(claim, r.info, ctxWords))) {
      kept.push({ id, text });
    } else if (key !== "" && real.some((r) => r.key !== key && supports(claim, r.info, ctxWords))) {
      dropped.push({ id, text, reason: GATE_REASON.MEMBERSHIP });
    } else if (inContext.some((r) => anchoredIn(claim, r.info, ctxWords))) {
      flagged.push({ id, text, reason: GATE_REASON.PARTIAL_MATCH, flag: UNVERIFIED_FLAG });
    } else {
      dropped.push({ id, text, reason: GATE_REASON.NO_MATCH });
    }
  }

  return { kept, flagged, dropped };
}
