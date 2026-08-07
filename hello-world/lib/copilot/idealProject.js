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
// something spoken in the first person, and never fabricating a number.
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

// How many of the posting's own domain/methodology/technology terms name the
// "kind of project" — enough to be specific ("Cloud Computing, Distributed
// Systems") without turning into a second buzzword list.
export const MAX_SHAPE_TERMS = 3;
// Metrics are capped, not just the posting-stated numbers within them — a
// recruiter's checklist, not an exhaustive one.
export const MAX_METRICS = 4;

// The three taxonomy categories that name a KIND OF PROJECT rather than a
// soft skill or a certification — "Agile" and "Distributed Systems" describe
// the shape of the work; "Leadership" and "PMP" do not. Deliberately
// narrower than postingBuzzwords' BUZZWORD_CATEGORIES (which also draws on
// tool_platform, soft_skill, certification): a specific tool name ("AWS")
// is a thing to mention, not a description of the PROJECT'S shape.
const SHAPE_CATEGORIES = ["domain", "methodology", "technology"];

function collect(grouped, categories) {
  const items = [];
  for (const category of categories) {
    for (const item of grouped[category] || []) items.push(item);
  }
  return items;
}

// The posting's OWN stated numbers — real figures the posting text itself
// contains ("5+ years", "2M requests/day", "99.9% uptime"). Each entry is
// the literal matched substring, never reconstructed or reformatted, so it
// trivially satisfies "never emits a number absent from the posting" by
// construction — the same "grounding is structural" discipline
// resumeAnchor.js documents for `project`.
const POSTING_NUMBER_RE =
  /\$\s?\d[\d,.]*\s?[kmb]?\b|\d+(?:\.\d+)?\s?%|\b\d[\d,.]*\+?[kmb]?\s*(?:years?|yrs?|users?|customers?|clients?|requests?(?:\s?\/\s?(?:day|sec|second|s|hour|hr))?|deals?|hires?|people|engineers?|reports?|hours?|days?|weeks?|months?|tb|gb|mb|ms|x)\b/gi;

function postingNumbers(text, limit) {
  const seen = new Set();
  const out = [];
  for (const raw of text.match(POSTING_NUMBER_RE) || []) {
    const cleaned = raw.trim().replace(/\s+/g, " ");
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

// Generic metric CATEGORIES a recruiter touching this bucket's vocabulary
// would want a number for — never a specific figure, only the KIND of
// number to have ready (e.g. "latency reduction %" names a category; "40%
// latency reduction" would be a fabricated figure, which is exactly what
// this must never produce). Buckets are tried in order and a posting can
// trigger more than one; GENERIC_METRICS is always appended last so a
// posting whose vocabulary matches nothing named below still gets a usable,
// sensible set instead of an empty one.
const METRIC_BUCKETS = [
  {
    test: /\b(latency|throughput|uptime|reliability|scalab|scaling|infrastructure|distributed|cloud|backend|platform|devops|migrat|performance)\b/i,
    metrics: ["latency reduction %", "uptime / reliability %", "throughput at scale", "infrastructure cost saved"],
  },
  {
    test: /\b(data|machine learning|\bml\b|analytics|model|pipeline|etl)\b/i,
    metrics: ["model accuracy improvement", "data volume processed", "pipeline runtime reduction"],
  },
  {
    test: /\b(product|ux|user experience|design|frontend|customer)\b/i,
    metrics: ["adoption rate", "user satisfaction / NPS", "time-to-ship"],
  },
  {
    test: /\b(sales|revenue|growth|marketing|pipeline|quota)\b/i,
    metrics: ["revenue impact", "conversion rate", "pipeline generated"],
  },
  {
    test: /\b(support|customer success|service|operations|\bops\b)\b/i,
    metrics: ["resolution time", "customer satisfaction score", "ticket volume handled"],
  },
  {
    test: /\b(security|compliance|risk)\b/i,
    metrics: ["incidents prevented", "audit / compliance pass rate"],
  },
];
const GENERIC_METRICS = ["cost saved", "adoption rate", "time-to-ship", "team size managed"];

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
  for (const bucket of METRIC_BUCKETS) {
    if (!bucket.test.test(text)) continue;
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

// The kind of project a recruiter for THIS posting would consider ideal, and
// the metrics they would want to hear about it. `question`/`points` rank
// which of the posting's terms are most relevant to what's on screen right
// now, the same way postingBuzzwords' `context` does — the same posting
// yields a different emphasis per question.
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
      relevant: literallyMentioned(item.canonical, context) ? 1 : 0,
      score: item.score || 0,
      idx,
    }))
    .sort((a, b) => b.relevant - a.relevant || b.score - a.score || a.idx - b.idx);

  const seen = new Set();
  const shapeTerms = [];
  for (const item of ranked) {
    const key = item.canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    shapeTerms.push(item.canonical);
    if (shapeTerms.length >= MAX_SHAPE_TERMS) break;
  }
  if (shapeTerms.length === 0) return null;

  const numbers = postingNumbers(text, MAX_METRICS);
  const categories = categoryMetrics(text, MAX_METRICS - numbers.length);

  return {
    shape: shapeTerms.join(", "),
    metrics: [...numbers, ...categories].slice(0, MAX_METRICS),
  };
}
