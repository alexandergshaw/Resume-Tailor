// N51: the interviewer-title allow-list. WHY A POSITIVE ALLOW-LIST OVER THE
// WHOLE LABEL, rather than "no name was detected": a detector that misses one
// shape of name is a detector that admits it, and "Onsite with Sarah Chen"
// hands a candidate a named individual the app scraped off the open web and
// attributed to their own interview (the O-15 failure this product has
// already shipped once). So every token in the label must be recognised role
// or stage vocabulary, or the whole label is refused -- never admitted on
// partial, majority or best-effort vocabulary match (the N16 wave-G shape
// this module exists to not repeat).
//
// THE COST IS REAL AND MEASURED, NOT HAND-WAVED. A whole-label rule drops
// real job titles -- "React Engineer", "Barista", "Senior Manager
// Application Development" (the owner's own job) all fail it.
// interviewerRoles.test.js measures the held-out recall floor and the
// must-refuse leak count; this module does not itself decide what the floor
// is. It stays lexicon-free and client-safe: no import here reaches
// data/givenNames.generated.js, directly or transitively.
//
// Every export is pure, total and never throws.

const ROLE_HEADS = [
  "recruiter", "recruiters", "coordinator", "sourcer", "manager", "managers", "director", "directors", "engineer",
  "engineers", "lead", "leads", "head", "partner", "officer", "president", "counsel", "chair", "chairperson",
  "dean", "provost", "principal", "superintendent", "committee", "team", "teams", "panel", "board", "founder",
  "cofounder", "co-founder", "ceo", "cto", "cfo", "coo", "cpo", "cio", "ciso", "cmo", "vp", "svp", "evp", "avp",
  "owner", "supervisor", "specialist", "analyst", "scientist", "designer", "architect", "administrator",
  "representative", "advisor", "adviser", "consultant", "generalist", "member", "members", "staff", "faculty",
  "professor", "teacher", "nurse", "physician", "attorney", "paralegal", "accountant", "controller", "auditor",
  "editor", "producer", "researcher", "developer", "programmer", "technician", "trainer", "instructor",
  "interviewer", "interviewers", "raiser", "peer", "peers", "colleague", "colleagues", "executive", "executives",
  "leadership", "stakeholder", "stakeholders", "department", "office", "group", "org", "organization", "squad",
  "pod", "hr", "ta", "rep", "pm", "tpm", "em", "sre", "swe", "sde", "ic",
  "associate", "associates", "investigator", "pi", "postdoc", "strategist", "copywriter", "writer", "hrbp",
];
const SENIORITY = [
  "senior", "sr", "junior", "jr", "principal", "chief", "associate", "assistant", "deputy", "vice", "general",
  "regional", "global", "interim", "acting", "founding", "managing", "distinguished", "executive", "early", "career",
  "entry-level", "mid-level", "staff", "lead", "first-line", "second-line", "skip-level",
  "tech", "charge", "university", "campus", "district", "store", "unit", "shift", "warehouse", "lab", "portfolio",
];
const FUNCTIONS = [
  "engineering", "software", "hardware", "product", "products", "design", "data", "science", "analytics",
  "marketing", "sales", "finance", "financial", "operations", "people", "human", "resources", "talent",
  "acquisition", "recruiting", "hiring", "legal", "compliance", "security", "infrastructure", "platform", "backend",
  "back-end", "frontend", "front-end", "full-stack", "mobile", "web", "cloud", "devops", "reliability", "site",
  "quality", "qa", "test", "testing", "research", "customer", "success", "support", "account", "accounts",
  "business", "development", "strategy", "growth", "brand", "content", "communications", "community",
  "partnerships", "program", "project", "technical", "technology", "it", "information", "nursing", "clinical",
  "medical", "academic", "student", "students", "admissions", "affairs", "school", "search", "machine",
  "learning", "ai", "ml", "payments", "risk", "supply", "chain", "procurement", "facilities", "education",
  "curriculum", "art", "creative", "editorial", "ux", "ui", "user", "experience", "solutions", "network",
  "systems", "enterprise", "field", "channel", "cross-functional", "functional", "domain",
  "architecture", "governance", "privacy", "trust", "safety", "revenue", "treasury", "tax", "audit", "internal",
  "relations", "public", "policy", "corporate", "bar", "interview", "ranking", "ads", "management",
];
const CONNECTIVES = ["of", "the", "and", "&", "for", "in", "on", "a", "an", "/"];

/** The full closed job-vocabulary set: heads (recruiter, manager, ...),
 *  seniority modifiers, function nouns and connective words. */
export const ROLE_VOCAB = new Set([...ROLE_HEADS, ...SENIORITY, ...FUNCTIONS, ...CONNECTIVES]);

/** Words that are BOTH vocabulary AND common given names, so a one- or
 *  two-token label built entirely from them reads more like a first name
 *  than a title (design.r3.md section 7.1 rules 5/6). Checked against the
 *  shipped given-name lexicon: of every candidate addition to ROLE_VOCAB,
 *  only "master" collides -- this list is what keeps that collision from
 *  ever admitting a bare first name. */
export const NAME_SHAPED_VOCAB = new Set([
  "ai", "an", "art", "bar", "brand", "chain", "channel", "chief", "cloud", "content",
  "dean", "early", "field", "general", "in", "jr", "junior", "peer", "president", "regional", "success", "ta",
  "talent", "the", "trust", "vice",
]);

const HEADS = new Set(ROLE_HEADS);
const HEAD_FOLLOWERS = new Set(["of", "for"]);
const LEVEL_TOKEN_RE = /^(?:i|ii|iii|iv|v|(?:l|e|ic|m|p|t)\d{1,2})$/;

/** The two tokens ambiguous between a surname and a job noun (design.r3.md
 *  section 7.1 rule 7): "Dean Martinez" must refuse and "Associate Dean"
 *  must admit, and the difference is which position "dean"/"head" sits in. */
export const SURNAME_HEADS = new Set(["dean", "head"]);

const LABEL_CHARS_RE = /^[A-Za-z0-9&/\-,. ]+$/;

/** Stage/round vocabulary, unioned with ROLE_VOCAB for `isVocabularyPhrase`/
 *  `isVocabularyWord` only -- admitRoleLabel itself never admits a bare stage
 *  word as a ROLE (a "screen" is not a person, but "Recruiter Screen" must
 *  read as vocabulary wherever a name-span detector needs to subtract it). */
export const STAGE_WORDS = [
  "screen", "screening", "screener", "round", "rounds", "interview", "interviews", "onsite", "on-site", "loop",
  "superday", "assessment", "assessments", "case", "study", "presentation", "exercise", "review", "chat", "call",
  "test", "final", "phone", "virtual", "video", "take-home", "portfolio", "writing", "written", "behavioral",
  "behavioural", "coding", "system", "design", "whiteboard", "pairing", "debrief", "offer", "reference", "check",
  "culture", "fit", "values", "background", "work", "sample", "trial", "day", "first", "second", "third", "initial",
  "follow-up", "online", "in-person", "conversation", "discussion", "session", "stage", "step", "deep-dive", "live",
  "technical", "of",
];
const PHRASE_VOCAB = new Set([...ROLE_VOCAB, ...STAGE_WORDS]);

function roleTokens(segment) {
  return segment.replace(/\./g, " ").split(/\s+|(?=\/)|(?<=\/)/).filter(Boolean).map((t) => t.toLowerCase());
}

/** True when some token in `tokens` is a HEAD followed only by level tokens
 *  and then either the segment's end or "of"/"for" -- "Manager", "Manager
 *  II", "Manager of Engineering" all qualify; "Engineering Manager" too, via
 *  its own "manager" token at the end. */
function segmentHeaded(tokens) {
  return tokens.some((t, i) => {
    if (!HEADS.has(t)) return false;
    let j = i + 1;
    while (j < tokens.length && LEVEL_TOKEN_RE.test(tokens[j])) j += 1;
    return j === tokens.length || HEAD_FOLLOWERS.has(tokens[j]);
  });
}

/**
 * Returns the NFC, whitespace-collapsed, trimmed label with any trailing run
 * of "." and whitespace removed, or null. See this module's own header for
 * the shape of the rule and design.r3.md section 7.1 for its numbered form.
 *
 * FIXPOINT (R2-M3): admitRoleLabel(a) === a for every non-null
 * a = admitRoleLabel(x), and admitRoleLabel(stripTerminal(a)) === a -- the
 * trailing-punctuation strip below is applied unconditionally, before any
 * other check, so a label that passes never has more to strip on a second
 * pass.
 *
 * @param {unknown} label
 * @returns {string | null}
 */
export function admitRoleLabel(label) {
  if (typeof label !== "string") return null;
  const trimmed = label.normalize("NFC").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (!trimmed || trimmed.length > 80) return null;
  if (!LABEL_CHARS_RE.test(trimmed)) return null;
  const segments = trimmed.split(",").map((s) => roleTokens(s)).filter((s) => s.length > 0);
  if (segments.length === 0 || segments.length > 3) return null;
  const all = segments.flat();
  if (all.length > 8) return null;
  for (const t of all) if (!ROLE_VOCAB.has(t) && !LEVEL_TOKEN_RE.test(t)) return null;
  if (!segments.some(segmentHeaded)) return null;
  if (all.length === 2 && SURNAME_HEADS.has(all[1]) && NAME_SHAPED_VOCAB.has(all[0])) return null;
  if (all.length === 1 && NAME_SHAPED_VOCAB.has(all[0])) return null;
  if (all.some((t, i) => t === "dean" && i + 1 < all.length && HEADS.has(all[i + 1]))) return null;
  if (all.every((t) => LEVEL_TOKEN_RE.test(t))) return null;
  return trimmed;
}

/** True iff the single word is role/stage vocabulary and not a
 *  surname-shaped head ("dean"/"head") on its own. */
export function isVocabularyWord(word) {
  if (typeof word !== "string") return false;
  const t = word.normalize("NFC").trim().toLowerCase();
  return PHRASE_VOCAB.has(t) && !SURNAME_HEADS.has(t);
}

/** True iff every token in `phrase` is role/stage vocabulary, refusing the
 *  two-token "<word> dean"/"<word> head" shape that is ambiguous with a
 *  surname (the same rule `admitRoleLabel` applies at rule 5). */
export function isVocabularyPhrase(phrase) {
  if (typeof phrase !== "string") return false;
  const tokens = phrase.normalize("NFC").trim().split(/\s+/).map((t) => t.toLowerCase());
  if (tokens.length < 1 || tokens.some((t) => !PHRASE_VOCAB.has(t))) return false;
  if (tokens.length === 2 && SURNAME_HEADS.has(tokens[1])) return false;
  return true;
}
