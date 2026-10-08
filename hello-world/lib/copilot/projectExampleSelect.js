// Per-question selection from the pre-warmed example-project pool, plus the
// server-side status derivation that turns a pool row and a pick into the
// `projectExample` field the answer route puts on its done-frame. Pure: no
// fetch, no Supabase, no model client -- it imports only the shared term
// primitives and word lists from projectStories.js and the engine predicate, which is
// how "Row 1 selection adds zero model calls" is true by construction rather
// than by a spied route call. It stays free of any server-only import so a
// client bundle can take it without dragging a Gemini client along; the
// generation module (projectExampleGen.js) is the server-only half and imports
// POOL_PENDING_MAX_AGE from here, never the other way round.
//
// WHY SELECTION CAN SAY "NO MATCH". The feature this replaces shipped an
// off-domain example (an operations story for a teaching question) because it
// FORCED a pick: the best-scoring entry was shown whatever its score. So
// selectPoolProject returns an outcome, and `no_match` is a first-class
// result -- never an entry pulled through a floor it did not clear.
//
// WHY FIT IS SCORED OVER competency + domain AND NOT title/bullets. Those two
// fields are the curated tag the generator spreads across the pool; the title
// and bullets are invented prose whose domain words recur in every entry, so
// scoring them would make almost every entry clear any threshold and an
// off-domain pick could never be refused -- the failure above, one layer down.
// The title is used only to break a tie between entries the tag already ranks
// equal, never to make an entry clear the threshold.
//
// WHAT COUNTS AS SHARED. Raw word overlap was wrong in both directions, and the
// threshold of 1 made each error decisive:
//   - FALSE MATCH: a question's scaffolding words ("tell me about a time",
//     "describe", "handle", "project", "problem") overlap generic tags like
//     "project management" or "problem solving", so ANY behavioural question
//     cleared the fit and an unrelated example was shown. The question's terms
//     are therefore filtered to the ones that could distinguish one entry from
//     another -- not ordinary English/resume filler (STOPWORDS) and not interview
//     scaffolding (INTERVIEW_SCAFFOLDING) -- the same filter, from the same two
//     lists, that clearsHonestyGate (projectStories.js) applies before it lets the
//     deterministic engine speak a page as the candidate's own.
//   - FALSE NO_MATCH: "teach" and "teaching", "student" and "students",
//     "assess" and "assessment" share no token, so an on-domain question missed
//     its own entry. Both sides are therefore reduced to a light stem before
//     they are compared (lightStem, below).
// Filtering is question-side only, deliberately: a tag word can score only if it
// is also a question term, so filtering the tag as well would be redundant.

import { significantTerms, STOPWORDS, INTERVIEW_SCAFFOLDING } from "./projectStories.js";
import { wantsEmbedded } from "@/lib/llm/featureEngine";

// The fewest distinctive competency/domain terms an entry must share with the
// question to count as a match. 1 means no_match fires only when the best entry
// shares NOTHING distinctive with the question -- the clear off-domain case. A
// flagged guess, named and exported so it is tuned from the quality probe rather
// than rewritten as a literal somewhere else.
export const POOL_FIT_THRESHOLD = 1;

// How long a 'pending' pool row is believed. A younger one means another
// request is genuinely generating (the answer route reads it as WARMING and the
// prewarm route does not double-fire); an older one means the generation
// crashed mid-run (read as FAILED, and the cost gate retries it). Generous for
// one non-streaming model call plus scheduling slack, and well under the
// prewarm route's maxDuration. A flagged guess, named and exported for the
// same reason as POOL_FIT_THRESHOLD.
export const POOL_PENDING_MAX_AGE = 90_000;

// ---------------------------------------------------------------------------
// Comparing words: a light stem, and which question words are scaffolding
// ---------------------------------------------------------------------------

// [suffix, shortest stem it may leave behind]. First match wins, so within a
// family the longer suffix comes first. The derivational suffixes leave at least
// four letters, so a short word is not chewed into a fragment that collides with
// another ("actor" and "action" must not meet at "act"); the inflectional ones
// may leave three ("maps" and "mapping" must meet at "map").
const DERIVATIONAL = [
  ["ments", 4], ["ment", 4], ["ships", 4], ["ship", 4], ["ness", 4],
  ["ions", 4], ["ion", 4], ["ers", 4], ["er", 4], ["ors", 4], ["or", 4], ["al", 4], ["ly", 4],
];
const INFLECTIONAL = [["ings", 3], ["ing", 3], ["ies", 3], ["ied", 3], ["ed", 3], ["es", 3], ["s", 3]];

function stripOneSuffix(word, table) {
  for (const [suffix, leaves] of table) {
    if (!word.endsWith(suffix) || word.length - suffix.length < leaves) continue;
    // "assess", "focus" and "analysis" end in s without being plurals.
    if (suffix === "s" && /(?:ss|us|is)$/.test(word)) continue;
    const base = word.slice(0, word.length - suffix.length);
    return suffix === "ies" || suffix === "ied" ? `${base}y` : base;
  }
  return word;
}

// Reduces a word to a stem good enough to tell that two words are the same
// subject: "teach", "teaching" and "teacher" meet at "teach"; "student" and
// "students" at "student"; "assess" and "assessment" at "assess"; "manage",
// "managed" and "management" at "manag". It is deliberately not a real stemmer
// (no irregular forms, and "respond"/"response" still miss each other): both
// sides of every comparison go through the same function, so what it gets wrong
// it gets wrong consistently, and a missed pair costs a no_match the owner
// probe will show, where an over-eager one would cost a wrong example.
//
// ONE inflectional strip at most, and only FIRST: a second inflectional strip
// would peel the plural off what was left of a word that never had one
// ("nursing" -> "nurs" -> "nur"), splitting it from "nurse". After that first
// strip only a derivational suffix may follow ("educational" -> "education" ->
// "educat", "families" -> "family" -> "fami").
function lightStem(term) {
  let word = stripOneSuffix(term, [...INFLECTIONAL, ...DERIVATIONAL]);
  if (word !== term) word = stripOneSuffix(word, DERIVATIONAL);
  if (word.length >= 4 && word.endsWith("e")) word = word.slice(0, -1);
  // "planning" -> "plann" -> "plan"; "assess" and "staff" keep their double.
  if (word.length >= 4 && /([^aeioulsfz])\1$/.test(word)) word = word.slice(0, -1);
  return word;
}

// "team" and "teams" are the two words stopwords.json lists that are the SUBJECT
// of a leadership or delegation question and not filler: the list is a classic
// English stoplist plus a job-posting boilerplate tail, written for stripping ATS
// noise out of job descriptions. lib/copilot/answerLocal.js makes the same
// exception for the same reason, measured there (15 winner-changes, all five
// `team` ones regressions). The rest of the tail is left in, as it is there.
const FIT_STOPWORDS = new Set(STOPWORDS);
FIT_STOPWORDS.delete("team");
FIT_STOPWORDS.delete("teams");

// The set of stems standing for the text's DISTINCTIVE words. `skipGeneric` is
// the question side: drop stopwords and interview scaffolding on the RAW word,
// before stemming, so "handled" is scaffolding and "handling" (a real subject:
// "complaint handling") is not, and "learned" is scaffolding while "learning"
// stays available to a tag that says "student learning".
function stemSet(text, { skipGeneric = false } = {}) {
  const stems = new Set();
  for (const term of significantTerms(text)) {
    if (skipGeneric && (FIT_STOPWORDS.has(term) || INTERVIEW_SCAFFOLDING.has(term))) continue;
    stems.add(lightStem(term));
  }
  return stems;
}

function sharedCount(questionStems, otherStems) {
  let shared = 0;
  for (const stem of otherStems) if (questionStems.has(stem)) shared += 1;
  return shared;
}

// Picks the pool entry that best fits `question`, or reports that none does.
// The strictly-highest fit wins; between equal fits the entry whose TITLE shares
// more with the question wins; after that array order does (the same stable
// posture as selectBestStory). `fitScore` is the winning entry's tag score (the
// number of distinctive question words its competency + domain share, by stem),
// kept on a no_match too so the caller can log how close the miss was; it is 0
// only when there was nothing to score.
export function selectPoolProject(projects, { question } = {}) {
  const questionStems = stemSet(question, { skipGeneric: true });
  let best = null;
  let bestScore = 0;
  let bestTitle = 0;
  for (const entry of Array.isArray(projects) ? projects : []) {
    if (!entry || typeof entry !== "object") continue;
    const score = sharedCount(questionStems, stemSet(`${entry.competency ?? ""} ${entry.domain ?? ""}`));
    // The title is consulted only to separate entries the tag ranks equal, and
    // only for an entry that already shares something: it never lifts a tag with
    // no overlap over the threshold.
    const titleScore = score > 0 ? sharedCount(questionStems, stemSet(entry.title)) : 0;
    if (best === null || score > bestScore || (score === bestScore && titleScore > bestTitle)) {
      best = entry;
      bestScore = score;
      bestTitle = titleScore;
    }
  }
  if (best === null || bestScore < POOL_FIT_THRESHOLD) {
    return { outcome: "no_match", entry: null, fitScore: bestScore };
  }
  return { outcome: "match", entry: best, fitScore: bestScore };
}

// True when a pool row is 'pending' and has outlived POOL_PENDING_MAX_AGE, i.e.
// the generation that wrote it is no longer believed to be running. A pending
// row whose timestamp cannot be read is treated as stale: the honest answer to
// "is this still in flight" when there is no evidence it is.
export function isStalePending(pool, now = Date.now()) {
  if (!pool || pool.status !== "pending") return false;
  const written = Date.parse(pool.updated_at);
  if (!Number.isFinite(written)) return true;
  const clock = Number.isFinite(now) ? now : Date.now();
  return clock - written >= POOL_PENDING_MAX_AGE;
}

// A matched entry is shown only if it is shaped like one: a model-written pool
// is validated on the way IN, but this is read back from a database column, and
// rendering a half-built entry as a ready example is worse than saying failed.
function isShownEntry(entry) {
  return (
    !!entry &&
    typeof entry.title === "string" &&
    Array.isArray(entry.bullets) &&
    entry.bullets.length > 0 &&
    entry.bullets.every((b) => typeof b === "string")
  );
}

// The Row 1 field for one question, derived entirely from what the server can
// observe. `undefined` means OMIT the field -- that absence is how a surface
// renders nothing at all, and it is distinct from a sent { status: "failed" }:
//
//   no applicationId, or an embedded engine ........ undefined (omit)
//   the pool read ERRORED (or timed out) ............ { status: "failed" }
//   no pool row, or a young 'pending' row ........... { status: "pending" }
//   'failed', a stale 'pending', or a 'ready' pool
//     with nothing usable in it ..................... { status: "failed" }
//   'ready' and the pick found no close entry ....... { status: "no_match" }
//   'ready' and the pick matched .................... { status: "ready", ...entry }
//
// ERROR VERSUS EMPTY. `poolError` is whatever the caller's read reported (see
// getProjectPool in lib/supabase/applicationProjectPool.js, which returns
// `{ pool: null, error }` for a failed read and `{ pool: null, error: null }`
// for a row that is not there). The two are different facts and must not share
// an answer: a missing row is genuinely "not prepared yet" and self-heals
// (pending, and the client asks for the pool), while a read that FAILED says
// nothing about whether a row exists, and rendering it as pending would show
// "being prepared" for work nobody is doing, on every question, for as long as
// the database stays unreachable.
//
// No-overclaim: ready content (title/bullets) is emitted ONLY under 'ready' +
// match. A pending, failed, empty or no_match pool never carries a benchmark.
// An empty 'ready' pool is `failed` and not `no_match` on purpose -- "no close
// example" would claim a pool was searched, and an empty one was not.
export function buildProjectExample({ pool, pick, applicationId, engine, now, poolError } = {}) {
  if (!applicationId) return undefined;
  if (wantsEmbedded(engine)) return undefined;

  if (poolError) return { status: "failed" };
  if (!pool) return { status: "pending" };
  if (pool.status === "pending") {
    return isStalePending(pool, now) ? { status: "failed" } : { status: "pending" };
  }
  if (pool.status !== "ready") return { status: "failed" };
  if (!Array.isArray(pool.projects) || pool.projects.length === 0) return { status: "failed" };

  if (!pick || pick.outcome !== "match" || !pick.entry) return { status: "no_match" };
  const entry = pick.entry;
  if (!isShownEntry(entry)) return { status: "failed" };
  return {
    status: "ready",
    competency: entry.competency,
    domain: entry.domain,
    title: entry.title,
    bullets: [...entry.bullets],
    hypothetical: true,
    engine: pool.engine ?? null,
  };
}

const MAX_TAG_CHARS = 120;
const tagText = (value) => (typeof value === "string" ? value.slice(0, MAX_TAG_CHARS) : "");

// Adds the owner probe's evidence to a ready or no_match value: the WHOLE pool
// the pick was made from (each entry's competency, domain and title, never its
// bullets) and the winning fit score. The probe (docs/loop/N143.probe.md) cannot
// tell "the pool had a better entry" (selection picked wrong) from "every entry
// clusters on one competency" (the pool is too narrow) from "nothing in the pool
// fits" (the model ignored the role's domain) off the winner alone, and the
// session log is the only record the owner has of a run. The tags ride the
// done-frame so the client can put them in that log; nothing renders them.
//
// Any other status passes through untouched, so no pending, failed or omitted
// value ever gains a field, and a ready entry's own content is not duplicated.
export function withPoolTags(example, { pool, pick } = {}) {
  if (!example || (example.status !== "ready" && example.status !== "no_match")) return example;
  const projects = Array.isArray(pool?.projects) ? pool.projects : [];
  return {
    ...example,
    fitScore: Number.isFinite(pick?.fitScore) ? pick.fitScore : 0,
    poolTags: projects
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({ competency: tagText(entry.competency), domain: tagText(entry.domain), title: tagText(entry.title) })),
  };
}
