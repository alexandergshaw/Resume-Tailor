// Map each scanned placeholder to a fill strategy and a proposed value, purely
// from the bundled data files + the posting's keywords. First match wins:
//   profile  -> a value keyed by placeholder name in profile.json
//   keywords -> a comma-joined slice of the posting's keywords for a category
//   skills   -> the repeated skills-line slot, one category per occurrence
//   library  -> the best content_library entry whose `slots` includes this name
//   manual   -> anything unrecognized (empty value; the UI lets the user fill it)
// Everything is deterministic: shared keyword pools advance with explicit order,
// library entries are used at most once, and every sort has a tiebreaker.

import { tokenize, canonicalize } from "./keywords.js";
import { candidateUniverse } from "./universe.js";

// aggressiveness (1..5) -> how many "gap" keywords (ones the candidate does NOT
// have) to inject into the skills section. Higher = more tailoring/fabrication;
// 1 is truthful (reorder/surface only).
const GAP_BUDGET = { 1: 0, 2: 1, 3: 3, 4: 6, 5: 10 };

function clampAggressiveness(value) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

// Capability lines: name -> { categories to draw from, how many to join }.
const KEYWORD_JOIN = {
  JOB_RELEVANT_TECHNOLOGIES: { cats: ["technology", "tool_platform"], k: 6 },
  TECHNICAL_CAPABILITIES: { cats: ["technology", "tool_platform"], k: 6 },
  DELIVERY_PRACTICES: { cats: ["methodology"], k: 5 },
  DOMAIN_CAPABILITIES: { cats: ["domain"], k: 5 },
  SOLUTION_TYPES: { cats: ["domain"], k: 5 },
  AREA_OF_EMPHASIS: { cats: ["domain"], k: 4 },
  AREAS_OF_EMPHASIS: { cats: ["domain"], k: 4 },
  LEADERSHIP_CAPABILITIES: { cats: ["soft_skill"], k: 5 },
};

const COURSE_TOPICS_RE = /^COURSE_TOPICS(?:_(\d+))?$/;
// Names that read as accomplishment slots even when no library entry lists them.
const ACCOMPLISHMENT_RE =
  /^(ACTION|SOLUTION|MEASURABLE|SCOPE|PROJECT|ACCOMPLISHMENT|IMPACT|RESULT|OUTCOME|DELIVERABLE)/;

// Build the per-request keyword pools and job vectors used by the mappers.
function buildContext(keywords) {
  // Token-level weights for library cosine scoring.
  const jobWeights = new Map();
  const jobCanonical = new Set();
  // Posting score by canonical (for skill-group ranking) and by category (fallback).
  const postingScore = new Map();
  const categoryScore = new Map();
  for (const category of Object.keys(keywords)) {
    for (const { canonical, score } of keywords[category]) {
      jobCanonical.add(canonical.toLowerCase());
      postingScore.set(canonical.toLowerCase(), score);
      categoryScore.set(category, (categoryScore.get(category) || 0) + score);
      for (const token of tokenize(canonical)) {
        jobWeights.set(token, Math.max(jobWeights.get(token) || 0, score));
      }
    }
  }
  return { jobWeights, jobCanonical, postingScore, categoryScore };
}

// SKILLS_DISTRIBUTE: rank the skill groups by how hard the posting hits each,
// and within each group order its skills so posting-matched ones lead. Returns
// a ranked array of { heading, row } — every skill is kept verbatim (nothing is
// dropped or invented), so each row's text is identical in length to the
// original, just reordered. Deterministic: ties break on original file order.
function rankSkillGroups(groups, ctx) {
  const ranked = groups.map((group, index) => {
    const claimed = new Map();
    const matchedKeywords = new Set();
    for (const keyword of group.keywords || []) {
      const canon = (canonicalize(keyword) || keyword).toLowerCase();
      const score = ctx.postingScore.get(canon) ?? ctx.postingScore.get(keyword.toLowerCase());
      if (score != null) {
        claimed.set(canon, score);
        matchedKeywords.add(keyword);
      }
    }
    let score = [...claimed.values()].reduce((sum, s) => sum + s, 0);
    for (const cat of group.categories || []) score += ctx.categoryScore.get(cat) || 0;

    const matched = (group.keywords || []).filter((k) => matchedKeywords.has(k));
    const rest = (group.keywords || []).filter((k) => !matchedKeywords.has(k));
    return {
      index,
      heading: group.heading,
      categories: group.categories || [],
      row: [...matched, ...rest].join(", "),
      score,
    };
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked;
}

// Inject up to `budget` posting keywords the candidate does NOT have ("gaps")
// into the matching skill-group row (by category), ranked by posting score, by
// SWAPPING OUT the lowest-relevance (trailing) real skills — so each row keeps
// its original item count (fixed length). This is the fabrication lever driven
// by aggressiveness; budget 0 leaves the résumé truthful. Mutates ranked[].row.
function insertGaps(ranked, keywords, universe, budget) {
  if (budget <= 0) return;
  const gaps = [];
  for (const category of Object.keys(keywords)) {
    for (const k of keywords[category]) {
      if (!universe.has(k.canonical.toLowerCase())) {
        gaps.push({ canonical: k.canonical, category, score: k.score });
      }
    }
  }
  gaps.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));

  // Assign each gap (within budget) to the first ranked group that owns its
  // category, de-duping against the row and already-assigned gaps.
  const perGroup = new Map();
  let count = 0;
  for (const gap of gaps) {
    if (count >= budget) break;
    const target = ranked.find((g) => g.categories.includes(gap.category));
    if (!target) continue;
    const taken = perGroup.get(target) || [];
    const present = new Set(
      [...(target.row ? target.row.split(", ") : []), ...taken].map((s) => s.toLowerCase()),
    );
    if (present.has(gap.canonical.toLowerCase())) continue;
    taken.push(gap.canonical);
    perGroup.set(target, taken);
    count += 1;
  }

  // Swap: drop that many trailing (least-relevant) real skills, append the gaps.
  for (const [group, gapList] of perGroup) {
    const real = group.row ? group.row.split(", ") : [];
    const keep = Math.max(0, real.length - gapList.length);
    group.row = [...real.slice(0, keep), ...gapList].join(", ");
  }
}

// Consume up to k keywords from the given categories (merged, ranked), skipping
// any already consumed by an earlier slot so capability lines don't duplicate.
function consumeJoin(keywords, cats, k, consumed) {
  const merged = [];
  for (const cat of cats) {
    for (const item of keywords[cat] || []) merged.push(item);
  }
  merged.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
  const picked = [];
  for (const item of merged) {
    const low = item.canonical.toLowerCase();
    if (consumed.has(low)) continue;
    consumed.add(low);
    picked.push(item.canonical);
    if (picked.length >= k) break;
  }
  return picked.join(", ");
}

// Non-consuming top-N canonicals of a single category (for the skills line).
function topN(keywords, cat, n) {
  return (keywords[cat] || [])
    .slice(0, n)
    .map((item) => item.canonical)
    .join(", ");
}

// cosine(entry tf, job token weights) + 0.5 * tag-overlap.
function scoreEntry(entry, ctx) {
  const tf = new Map();
  for (const token of tokenize(`${entry.text} ${(entry.tags || []).join(" ")}`)) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  let dot = 0;
  let entryNorm = 0;
  for (const [token, count] of tf) {
    entryNorm += count * count;
    dot += count * (ctx.jobWeights.get(token) || 0);
  }
  let jobNorm = 0;
  for (const weight of ctx.jobWeights.values()) jobNorm += weight * weight;
  entryNorm = Math.sqrt(entryNorm);
  jobNorm = Math.sqrt(jobNorm);
  const cosine = entryNorm > 0 && jobNorm > 0 ? dot / (entryNorm * jobNorm) : 0;

  let tagOverlap = 0;
  for (const tag of entry.tags || []) {
    if (ctx.jobCanonical.has(String(tag).toLowerCase())) tagOverlap += 1;
  }
  return cosine + 0.5 * tagOverlap;
}

// Aggressiveness at/above which FABRICATED library entries (made-up bullets,
// spun job titles) join the pool. Below it, only the candidate's real entries
// are eligible, so low aggressiveness stays truthful.
const FABRICATED_THRESHOLD = 3;

// Resolve an accomplishment / title slot to the best unused library entry.
// Fabricated entries are excluded unless aggressiveness >= FABRICATED_THRESHOLD.
function libraryMatch(name, library, ctx, used, aggressiveness) {
  const allowFabricated = aggressiveness >= FABRICATED_THRESHOLD;
  const matches = (library.entries || [])
    .filter((entry) => (entry.slots || []).includes(name) && (allowFabricated || !entry.fabricated))
    .map((entry) => ({ entry, score: scoreEntry(entry, ctx) }))
    .sort((a, b) => b.score - a.score || String(a.entry.id).localeCompare(String(b.entry.id)));

  const available = matches.filter(({ entry }) => !used.has(entry.id));
  if (available.length === 0) {
    if (ACCOMPLISHMENT_RE.test(name)) {
      return {
        strategy: "library",
        value: "",
        note: matches.length
          ? "Library entries exhausted — add your own"
          : "No library match — add your own",
        candidates: [],
      };
    }
    return null;
  }

  const best = available[0];
  used.add(best.entry.id);
  return {
    strategy: "library",
    value: best.entry.text,
    note: `From content library (${best.entry.id})`,
    candidates: available.slice(1).map(({ entry }) => entry.text),
  };
}

// Map one slot (name + occurrence) to { strategy, value, note, candidates }.
function mapOne(slot, keywords, data, state) {
  const { name, occurrence } = slot;

  // 1) PROFILE
  if (data.profile.values && Object.prototype.hasOwnProperty.call(data.profile.values, name)) {
    return {
      strategy: "profile",
      value: String(data.profile.values[name] ?? ""),
      note: "From profile",
      candidates: [],
    };
  }

  // 2) KEYWORD_JOIN (capability lines + course topics)
  if (KEYWORD_JOIN[name]) {
    const { cats, k } = KEYWORD_JOIN[name];
    return {
      strategy: "keywords",
      value: consumeJoin(keywords, cats, k, state.consumed),
      note: `Top ${cats.join(" + ")} keywords`,
      candidates: [],
    };
  }
  const course = COURSE_TOPICS_RE.exec(name);
  if (course) {
    const k = course[1] ? Number.parseInt(course[1], 10) : 3;
    return {
      strategy: "keywords",
      value: consumeJoin(keywords, ["technology", "soft_skill"], k, state.consumed),
      note: `${k} course topics`,
      candidates: [],
    };
  }

  // 3) SKILLS_DISTRIBUTE: the skills section's repeated heading + row slots,
  // filled by the posting-ranked skill groups (occurrence i = rank i).
  if (name === "SKILLS_HEADING") {
    const group = state.skills[occurrence];
    return { strategy: "skills_header", value: group?.heading || "", note: "Skill group heading", candidates: [] };
  }
  if (name === "SKILLS_LINE") {
    const group = state.skills[occurrence];
    return { strategy: "skills", value: group?.row || "", note: "Skill group (posting-ranked)", candidates: [] };
  }

  // 4) LIBRARY_MATCH (accomplishment + job-title slots)
  const lib = libraryMatch(name, data.library, state.ctx, state.used, state.aggressiveness);
  if (lib) return lib;

  // 5) MANUAL
  return { strategy: "manual", value: "", note: "Needs your input", candidates: [] };
}

// Enrich every scanned slot with a strategy + proposed value. Processed in
// document order so shared keyword pools and the library no-repeat behave
// deterministically.
export function mapSlots(slots, keywords, data, options = {}) {
  const ctx = buildContext(keywords);
  const ranked = rankSkillGroups(data.skillGroups?.groups || [], ctx);
  const aggressiveness = clampAggressiveness(options.aggressiveness);
  const universe = options.universe || candidateUniverse();
  insertGaps(ranked, keywords, universe, GAP_BUDGET[aggressiveness] || 0);
  const state = { consumed: new Set(), used: new Set(), ctx, skills: ranked, aggressiveness };
  return slots.map((slot) => ({ ...slot, ...mapOne(slot, keywords, data, state) }));
}
