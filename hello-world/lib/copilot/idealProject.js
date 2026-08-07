// The project a recruiter for THIS posting would consider ideal, and the
// metrics they would want to hear about it — a BENCHMARK, never a claim.
//
// AnswerAids already shows "Project to talk about", quoted from the
// candidate's own résumé. This is deliberately a second, different thing:
// what the posting itself is asking for, mined the same structural way
// postingBuzzwords.js mines the posting's vocabulary. By construction it
// describes work the candidate did NOT do — rendered next to a real quote
// from their résumé, a candidate under interview pressure could misread it
// as something to claim, which is exactly the failure R-087 exists to
// prevent. The caller (AnswerAids.js) is responsible for the rest of the
// safety story — a visually distinct treatment (PredictionPanel's look,
// AC-I3.20) and third-person "roles like this look for" wording — but this
// module's own contribution is never phrasing `shape`/`metrics` as
// something spoken in the first person, and never fabricating a number in
// either of them.
//
// AC-M1 narrowed that "never fabricating a number" rule, deliberately, to
// exactly `shape` and `metrics`: `project` (built below via
// idealProjectNarrative.js) is a worked example and the one place a
// fabricated figure is allowed to appear, because it is the one place a
// candidate is explicitly told the numbers are invented (AnswerAids' "A
// worked example, invented" disclosure). See idealProjectNarrative.js's own
// header for why that module can make figures up safely: every figure it
// writes is a hand-authored constant, never something read out of the
// posting.
//
// Same posture as postingBuzzwords.js throughout: deterministic, no network,
// no LLM, degrades to null on any failure, and both engines get the same
// answer for the same posting because neither ever calls this — only
// answerAids() (app/api/copilot/answer/route.js) does, from the SAME
// `postingDescription` buzzwords already reads. The posting description
// still never reaches buildPointsPrompt/buildAnswerPrompt (AC-H7.27) — this
// module only ever sees it via answerAids, exactly like postingBuzzwords.

import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { literallyMentioned } from "./answerLocal.js";
import { buildProject } from "./idealProjectNarrative.js";

// How many of the posting's own domain/methodology/technology terms name the
// "kind of project" — enough to be specific ("Cloud Computing, Distributed
// Systems") without turning into a second buzzword list.
export const MAX_SHAPE_TERMS = 3;
// Metrics are a recruiter's checklist of CATEGORIES, not an exhaustive one —
// capped short so the block stays glanceable.
export const MAX_METRICS = 3;

// The three taxonomy categories that name a KIND OF PROJECT rather than a
// soft skill or a certification — "Agile" and "Distributed Systems" describe
// the shape of the work; "Leadership" and "PMP" do not. Deliberately
// narrower than postingBuzzwords' BUZZWORD_CATEGORIES (which also draws on
// tool_platform, soft_skill, certification): a specific tool name ("AWS")
// is a thing to mention, not a description of the PROJECT'S shape.
const SHAPE_CATEGORIES = ["domain", "methodology", "technology"];

// Category is threaded through onto each item (not just canonical/score/count
// as extractKeywords returns them) because idealProjectNarrative's {D1} slot
// needs to know WHICH shape terms name a domain vs. a methodology — grouped's
// own key is the only place that distinction lives.
function collect(grouped, categories) {
  const items = [];
  for (const category of categories) {
    for (const item of grouped[category] || []) items.push({ ...item, category });
  }
  return items;
}

// Mining the posting's OWN stated numbers into `metrics` was tried and is
// deliberately, permanently gone. Reported failure: a posting stating
// "Salary range: $78,496.00 - $105,974.00" in two formats yielded "Metrics
// to have ready: $78,496, $105,974, $78,496.00, $105,974.00" — the SALARY
// BAND, restated four times because the dedupe key was the exact string and
// the posting gave it twice over. Those four entries then consumed the
// entire MAX_METRICS budget, so the real metric CATEGORIES below were never
// reached at all — the block that was supposed to tell a candidate what to
// have a number READY FOR instead just echoed the posting's pay range back
// at them.
//
// The fix is not a better number filter — there isn't one. A job posting's
// digits are its salary band, its years-of-experience floor and its
// headcount; it essentially never states a metric from a project the
// candidate should describe, and no regex can tell "$78,496" (compensation)
// apart from "40% latency reduction" (a project metric) by shape alone,
// because postings don't write the latter. So this module never reads a
// number OUT of the posting at all: `metrics` is exclusively the
// hand-authored CATEGORY phrases from categoryMetrics() below — a kind of
// number to have ready, never a figure.

// Generic metric CATEGORIES a recruiter touching this bucket's vocabulary
// would want a number for — never a specific figure, only the KIND of
// number to have ready (e.g. "latency reduction %" names a category; "40%
// latency reduction" would be a fabricated figure, which is exactly what
// this must never produce). Buckets are ranked by FIT (see categoryMetrics
// below) and a posting can still trigger more than one if the best-fitting
// bucket doesn't fill MAX_METRICS on its own; GENERIC_METRICS is always
// appended last so a posting whose vocabulary matches nothing named below
// still gets a usable, sensible set instead of an empty one.
//
// Each `test` carries the `g` flag purely so categoryMetrics can COUNT its
// matches instead of only asking yes/no — the set of words each bucket
// recognizes is otherwise unchanged.
// `key` names the archetype in idealProjectNarrative.js that tells the SAME
// story this bucket's metrics are about (AC-M1) — one more place R-137's fix
// has to hold, since the two are now selected by the same ranking and must
// never disagree.
const METRIC_BUCKETS = [
  {
    key: "infra",
    test: /\b(latency|throughput|uptime|reliability|scalab|scaling|infrastructure|distributed|cloud|backend|platform|devops|migrat|performance)\b/gi,
    metrics: ["latency reduction %", "uptime / reliability %", "throughput at scale", "infrastructure cost saved"],
  },
  {
    key: "data",
    test: /\b(data|machine learning|\bml\b|analytics|model|pipeline|etl)\b/gi,
    metrics: ["model accuracy improvement", "data volume processed", "pipeline runtime reduction"],
  },
  {
    key: "product",
    test: /\b(product|ux|user experience|design|frontend|customer)\b/gi,
    metrics: ["adoption rate", "user satisfaction / NPS", "time-to-ship"],
  },
  {
    key: "revenue",
    test: /\b(sales|revenue|growth|marketing|pipeline|quota)\b/gi,
    metrics: ["revenue impact", "conversion rate", "pipeline generated"],
  },
  {
    key: "support",
    test: /\b(support|customer success|service|operations|\bops\b)\b/gi,
    metrics: ["resolution time", "customer satisfaction score", "ticket volume handled"],
  },
  {
    key: "security",
    test: /\b(security|compliance|risk)\b/gi,
    metrics: ["incidents prevented", "audit / compliance pass rate"],
  },
];
const GENERIC_METRICS = ["cost saved", "adoption rate", "time-to-ship", "team size managed"];

// Rank buckets by how well each one actually FITS the posting — the number
// of times its own pattern matches the posting text — rather than trying
// them in declaration order and stopping at the first hit. First-match-wins
// was the bug: run against a real "Senior Product Manager, Education
// Technology" posting, the infrastructure bucket is declared first and its
// pattern matches the single incidental word "platform", so it claimed the
// ENTIRE MAX_METRICS budget before the product bucket — which the posting's
// "product manager", "product experience" and the rest of its vocabulary
// actually fit — was ever consulted. The candidate was told to prepare
// "latency reduction %, uptime / reliability %, throughput at scale" for a
// product interview: declaration order was standing in for fit, and it was
// wrong every time a posting merely brushed past an infra word without
// being an infra posting. Scoring by match COUNT (not match/no-match) fixes
// that: one incidental "platform" scores 1 and loses to a bucket whose
// vocabulary the posting actually uses repeatedly. Ties keep declaration
// order as the tiebreaker, so the result stays fully deterministic.
//
// The `score > 0` filter has to live HERE, inside the shared helper, not in
// either caller: idealProject() also uses this ranking to pick an archetype
// (AC-M1), and if a posting matching nothing were allowed to fall through to
// `ranked[0]` regardless of score, that call site would hand the generic
// fallback posting an `infra` archetype (bucket 0, score 0) instead of
// "generic" — and `categoryMetrics` would start emitting infra metrics for
// it too, breaking the documented GENERIC_METRICS fallback.
function rankBuckets(text) {
  return METRIC_BUCKETS.map((bucket, idx) => ({
    bucket,
    idx,
    score: (text.match(bucket.test) || []).length,
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx);
}

function categoryMetrics(text, limit) {
  if (limit <= 0) return [];
  const seen = new Set();
  const out = [];
  const add = (phrase) => {
    const key = phrase.toLowerCase();
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(phrase);
  };

  for (const { bucket } of rankBuckets(text)) {
    for (const phrase of bucket.metrics) {
      add(phrase);
      if (out.length >= limit) return out;
    }
  }

  for (const phrase of GENERIC_METRICS) {
    add(phrase);
    if (out.length >= limit) break;
  }
  return out;
}

// Joins shape terms into prose ("Education", "Education and Agile",
// "Education, Artificial Intelligence and Agile") — the same list `shape`
// already carries, just readable as the object of a sentence instead of a
// labelled, comma-separated heading. Ordinary "a, b and c" English joining,
// no Oxford comma, because `summary` is meant to read as a sentence a human
// wrote, not as a second rendering of the `shape` list.
function joinShapeTerms(terms) {
  if (terms.length === 1) return terms[0];
  if (terms.length === 2) return `${terms[0]} and ${terms[1]}`;
  return `${terms.slice(0, -1).join(", ")} and ${terms[terms.length - 1]}`;
}

// The kind of project a recruiter for THIS posting would consider ideal, a
// one-sentence description of it, and the metric CATEGORIES they would want
// to hear about it. `question`/`points` rank which of the posting's terms
// are most relevant to what's on screen right now, the same way
// postingBuzzwords' `context` does — the same posting yields a different
// emphasis per question.
//
// Returns null for an empty/blank/non-string description (no posting
// selected -> no block at all, same contract as postingBuzzwords/
// resumeAnchor), and also whenever no shape term survives — without a KIND
// of project to name, a benchmark with a blank headline is worse than no
// benchmark at all.
export function idealProject(description, { question = "", points = [] } = {}) {
  const text = String(description || "").trim();
  if (!text) return null;

  let grouped;
  try {
    grouped = extractKeywords(text, defaultLibraryData.taxonomy);
  } catch {
    // Same posture as postingBuzzwords: a taxonomy failure degrades this
    // block to absent, never breaks the answer around it.
    return null;
  }

  const context = [String(question || ""), ...(Array.isArray(points) ? points : [])]
    .map((p) => String(p || ""))
    .join(" ");

  const ranked = collect(grouped, SHAPE_CATEGORIES)
    // A canonical name is a taxonomy INFERENCE, not necessarily the posting's
    // own words — the recorded "team" -> "Microsoft Teams" hazard
    // postingBuzzwords guards against applies here identically.
    .filter((item) => literallyMentioned(item.canonical, text))
    .map((item, idx) => ({
      canonical: item.canonical,
      category: item.category,
      relevant: literallyMentioned(item.canonical, context) ? 1 : 0,
      score: item.score || 0,
      idx,
    }))
    .sort((a, b) => b.relevant - a.relevant || b.score - a.score || a.idx - b.idx);

  // { canonical, category } per term, not just strings — idealProjectNarrative
  // needs each term's taxonomy category to fill its {D1} slot (AC-M1) and
  // discarding it here (as this used to) would leave that module unable to
  // tell "Education" (a setting) from "Agile" (a delivery method).
  const seen = new Set();
  const shapeTerms = [];
  for (const item of ranked) {
    const key = item.canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    shapeTerms.push({ canonical: item.canonical, category: item.category });
    if (shapeTerms.length >= MAX_SHAPE_TERMS) break;
  }
  if (shapeTerms.length === 0) return null;

  const shapeNames = shapeTerms.map((t) => t.canonical);

  // Third-person advisory voice, never first person: this names a project
  // the candidate did NOT do, rendered next to a real quote from their own
  // résumé (AnswerAids' "Project to talk about"). A candidate under
  // interview pressure could misread a first-person sentence here as
  // something to claim, which is exactly the failure this module's own
  // header comment (R-087) exists to prevent — so `summary` reads as a
  // recruiter's expectation of the role, never as a sentence the candidate
  // could read aloud as a claim about themselves.
  const summary = `They want a project built around ${joinShapeTerms(shapeNames)}, owned end to end, with a measurable outcome.`;

  // The archetype is chosen by the SAME fit ranking that already picks
  // `metrics` (R-137), so a product posting can never be handed product
  // metrics next to an infrastructure story. `rankBuckets` already applies
  // the `score > 0` filter, so "matches nothing" lands on "generic" here
  // exactly the way it lands on GENERIC_METRICS in categoryMetrics.
  const archetypeKey = rankBuckets(text)[0]?.bucket.key || "generic";

  return {
    shape: shapeNames.join(", "),
    summary,
    metrics: categoryMetrics(text, MAX_METRICS),
    project: buildProject(archetypeKey, shapeTerms),
  };
}
