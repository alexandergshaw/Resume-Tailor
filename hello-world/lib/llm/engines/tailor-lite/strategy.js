// Map each scanned placeholder (from the user-authored template) to a value.
// First match wins; everything is deterministic. Families:
//   PROFILE        -> static facts/labels from profile.json
//   SKILLS         -> the repeated skills row, one taxonomy category per row,
//                     candidate skills posting-ranked (+ aggressiveness gap swap)
//   KEYWORD_JOIN   -> posting keywords of a category (padded with the candidate's
//                     own skills so the line is never empty)
//   COURSE_TOPICS  -> N tech/people keywords
//   FRAGMENT/PHRASE-> accomplishment + project phrasing drawn from deterministic
//                     pools (cursor-advanced for variety), some posting-aware
// Anything left over -> MANUAL (empty). The pools cover every fragment name in
// the bundled template, so a filled résumé never shows raw braces.

import { canonicalize } from "./keywords.js";
import { candidateUniverse, candidateSkillsByCategory } from "./universe.js";

const GAP_BUDGET = { 1: 0, 2: 1, 3: 3, 4: 6, 5: 10 };

function clampAggressiveness(value) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return 3;
  return Math.min(5, Math.max(1, n));
}

// Posting score by canonical + the set of posting canonicals (for ranking, gap
// detection, and library-fragment tag matching).
function buildContext(keywords) {
  const postingScore = new Map();
  const jobCanonical = new Set();
  for (const category of Object.keys(keywords)) {
    for (const { canonical, score } of keywords[category]) {
      postingScore.set(canonical.toLowerCase(), score);
      jobCanonical.add(canonical.toLowerCase());
    }
  }
  return { postingScore, jobCanonical };
}

// --- KEYWORD_JOIN ----------------------------------------------------------

const KEYWORD_JOIN = {
  JOB_RELEVANT_TECHNOLOGIES: { cats: ["technology"], k: 6 },
  TECHNICAL_CAPABILITIES: { cats: ["tool_platform"], k: 5 },
  DELIVERY_PRACTICES: { cats: ["methodology"], k: 4 },
  DOMAIN_CAPABILITIES: { cats: ["domain"], k: 4 },
  // The summary already reads "leading cross-functional teams through
  // {{LEADERSHIP_CAPABILITIES}}", so suppress capabilities that merely echo those
  // words (Leadership, Cross-Functional Collaboration) — otherwise the sentence
  // repeats itself ("leading … Leadership", "cross-functional … Cross-Functional").
  LEADERSHIP_CAPABILITIES: {
    cats: ["soft_skill"],
    k: 4,
    avoid: ["lead", "leading", "leadership", "cross", "functional", "team", "teams"],
  },
  JOB_RELEVANT_SOLUTIONS: { cats: ["domain"], k: 4 },
};

// Words too generic to make two phrases "the same concept" on their own.
const JOIN_STOPWORDS = new Set(["and", "or", "of", "the", "a", "an", "to", "for", "with", "in", "on"]);

// The significant lowercase words of a phrase (for redundancy detection).
function significantWords(phrase) {
  return new Set(
    String(phrase)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !JOIN_STOPWORDS.has(w)),
  );
}

// The most posting-relevant capabilities of the given categories, posting-matched
// first then padded with the candidate's own skills (so a line is never empty),
// as an ordered, de-duplicated pool. When `allowGaps` is false (low
// aggressiveness) only candidate-matched posting keywords are surfaced, so the
// line stays truthful. Items whose every word is already covered by an earlier
// item are dropped (no "Cross-Functional Collaboration, …, Collaboration"), and
// any item sharing a word with `avoid` is skipped (echoes the surrounding prose).
const CAPABILITY_POOL_MAX = 24;

function capabilityPool(keywords, byCat, cats, universe, allowGaps, avoid) {
  const out = [];
  const seen = new Set();
  const concepts = []; // word-set of each already-added item
  const avoidWords = avoid && avoid.length ? significantWords(avoid.join(" ")) : null;
  const push = (canon) => {
    if (out.length >= CAPABILITY_POOL_MAX) return;
    const low = canon.toLowerCase();
    if (seen.has(low)) return;
    const words = [...significantWords(canon)];
    if (words.length) {
      if (avoidWords && words.some((w) => avoidWords.has(w))) return;
      if (concepts.some((set) => words.every((w) => set.has(w)))) return;
    }
    seen.add(low);
    concepts.push(new Set(words));
    out.push(canon);
  };
  const merged = [];
  for (const c of cats) for (const item of keywords[c] || []) merged.push(item);
  merged.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
  for (const item of merged) {
    if (!allowGaps && !universe.has(item.canonical.toLowerCase())) continue;
    push(item.canonical);
  }
  for (const c of cats) for (const s of byCat[c] || []) push(s);
  return out;
}

// A k-item capability line drawn from the pool at a sliding `offset`. With
// offset 0 this is the top-k (so a slot's first occurrence is unchanged);
// repeated slots pass their occurrence index so each repeat surfaces a distinct,
// still-relevant slice instead of the same list every time.
function capabilityJoin(keywords, byCat, cats, k, universe, allowGaps, avoid, offset = 0) {
  const pool = capabilityPool(keywords, byCat, cats, universe, allowGaps, avoid);
  return emphasisSlice(pool, k, offset);
}

// --- Areas of emphasis (per-role) ------------------------------------------
// Each role's parenthetical should be in the same domain as the posting but not
// identical to the other roles'. We draw a generous domain pool once, then give
// each occurrence a window of `EMPHASIS_WINDOW` that slides by one — consecutive
// roles overlap (related) without repeating (not identical), as long as the pool
// is larger than the window.
const EMPHASIS_WINDOW = 3;
const EMPHASIS_POOL = 8;

function emphasisSlice(pool, size, offset) {
  if (pool.length === 0) return "";
  const n = Math.min(size, pool.length);
  const start = offset % pool.length;
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(pool[(start + i) % pool.length]);
  return out.join(", ");
}

// --- SKILLS rows (one taxonomy category per row) ---------------------------

const SKILL_ROW_CATEGORIES = ["domain", "technology", "tool_platform", "soft_skill", "methodology"];
const SKILL_ROW_MAX = 16;

// Build the 5 skills rows: candidate skills for each category, posting-matched
// first, then (per aggressiveness) swap trailing low-relevance ones for posting
// gap keywords, keeping each row's item count fixed.
function buildSkillRows(keywords, byCat, ctx, universe, budget) {
  const rows = SKILL_ROW_CATEGORIES.map((cat) => {
    const matched = [];
    const rest = [];
    for (const s of byCat[cat] || []) {
      const canon = (canonicalize(s) || s).toLowerCase();
      (ctx.postingScore.has(canon) ? matched : rest).push(s);
    }
    return { cat, items: [...matched, ...rest] };
  });

  if (budget > 0) {
    const gaps = [];
    for (const category of Object.keys(keywords)) {
      for (const k of keywords[category]) {
        if (!universe.has(k.canonical.toLowerCase())) {
          gaps.push({ canonical: k.canonical, category, score: k.score });
        }
      }
    }
    gaps.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
    const perRow = new Map();
    let count = 0;
    for (const gap of gaps) {
      if (count >= budget) break;
      const row = rows.find((r) => r.cat === gap.category);
      if (!row) continue;
      const taken = perRow.get(row) || [];
      const present = new Set([...row.items, ...taken].map((s) => s.toLowerCase()));
      if (present.has(gap.canonical.toLowerCase())) continue;
      taken.push(gap.canonical);
      perRow.set(row, taken);
      count += 1;
    }
    for (const [row, gapList] of perRow) {
      const keep = Math.max(0, row.items.length - gapList.length);
      row.items = [...row.items.slice(0, keep), ...gapList];
    }
  }
  return rows.map((r) => r.items.slice(0, SKILL_ROW_MAX).join(", "));
}

// --- Accomplishment + project phrasing pools -------------------------------
// Deterministic phrase banks; each slot advances a per-name cursor for variety.

const FRAGMENT_POOLS = {
  SOLUTION_TYPES: ["web applications, APIs, and enterprise platforms", "scalable applications and integrations", "data platforms and services"],
  ACTION: ["Designed", "Built", "Led", "Architected", "Modernized", "Delivered", "Engineered", "Implemented"],
  ACTION_OR_IMPLEMENTATION: ["re-architecting core services", "automating manual workflows", "introducing modern tooling"],
  ACTION_RESULT: ["accelerate delivery", "improve reliability", "reduce operational overhead", "increase throughput"],
  SOLUTION_OR_INITIATIVE: ["a scalable platform", "an enterprise integration layer", "a modern web application", "a reusable component system"],
  SOLUTION_OR_CAPABILITY: ["a scalable service", "an automated workflow", "a data-driven platform"],
  SOLUTION_OR_PROCESS: ["the deployment process", "the reporting workflow", "the integration pipeline"],
  TECHNICAL_OR_BUSINESS_RESULT: ["streamlined operations", "improved system reliability", "reduced manual effort", "increased delivery speed"],
  BUSINESS_OR_TECHNICAL_OUTCOME: ["operational efficiency", "system reliability", "delivery velocity"],
  MEASURABLE_IMPACT: ["measurable efficiency gains", "improved reliability and performance", "stronger operational outcomes"],
  PERFORMANCE_OR_BUSINESS_METRIC: ["throughput", "reliability", "delivery speed", "operational cost"],
  INITIATIVE_TYPE: ["enterprise modernization", "platform engineering", "integration"],
  INITIATIVE_OR_RESPONSIBILITY: ["a cross-team modernization initiative", "an enterprise integration program"],
  STRATEGIC_OUTCOMES: ["enterprise modernization", "operational excellence"],
  RESULTING_CAPABILITY: ["faster, more reliable delivery", "seamless data exchange", "self-service workflows"],
  SCOPE_OR_STAKEHOLDERS: ["multiple business units", "engineering and operations teams", "the organization"],
  SCOPE_OR_TEAM: ["a cross-functional team", "multiple engineering teams"],
  USERS_OR_STAKEHOLDERS: ["internal users and operational teams", "business stakeholders"],
  PROBLEM_OR_REQUIREMENT: ["complex integration requirements", "scalability and reliability needs", "evolving business requirements"],
  PROJECT_SCOPE: ["Enterprise", "Strategic", "Large-Scale"],
  PROJECT_TYPE: ["Platform Modernization", "Integration Initiative", "Application Modernization"],
  PRIMARY_CAPABILITY: ["Scalable Architecture", "Seamless Integration", "Automated Delivery"],
  STRATEGIC_OUTCOME: ["Faster, Safer Releases", "Operational Excellence", "Improved Reliability"],
  PROJECT_SOLUTION: ["a modern integration platform", "a scalable web application", "an automated data pipeline"],
  NEW_CAPABILITY: ["real-time data exchange", "self-service reporting", "automated deployments"],
  EXISTING_SYSTEM_OR_PROCESS: ["legacy systems and manual workflows", "a monolithic application", "fragmented reporting processes"],
  TECHNICAL_APPROACH: ["modern web technologies", "API-driven integration", "automated pipelines"],
};

function fragmentValue(name, cursors) {
  const pool = FRAGMENT_POOLS[name];
  if (!pool) return null;
  const i = cursors.get(name) || 0;
  cursors.set(name, i + 1);
  return pool[i % pool.length];
}

// --- LIBRARY_MATCH (real, tagged accomplishment/project fragments) ----------

// Relevance of a library fragment to the posting = how many of its tags the
// posting asks for.
function fragmentScore(entry, ctx) {
  let score = 0;
  for (const tag of entry.tags || []) {
    if (ctx.jobCanonical.has((canonicalize(tag) || tag).toLowerCase())) score += 1;
  }
  return score;
}

// Best-matching unused content_library fragment for a slot. Real fragments are
// always eligible; fabricated ones (invented metrics/spin) only when
// allowFabricated (high aggressiveness). Each fragment is used at most once.
// Returns the fragment text, or null to fall back to the neutral phrase pool.
function libraryMatch(name, library, ctx, used, allowFabricated) {
  const eligible = (library?.entries || []).filter(
    (e) => (e.slots || []).includes(name) && (allowFabricated || !e.fabricated) && !used.has(e.id),
  );
  if (eligible.length === 0) return null;
  eligible.sort(
    (a, b) => fragmentScore(b, ctx) - fragmentScore(a, ctx) || String(a.id).localeCompare(String(b.id)),
  );
  used.add(eligible[0].id);
  return eligible[0].text;
}

const COURSE_RE = /COURSE_TOPICS/;
const COURSE_COUNT_RE = /(\d+)/;

// Map one slot (name + occurrence) to { strategy, value, note, candidates }.
function mapOne(slot, keywords, data, state) {
  const { name, occurrence } = slot;
  const make = (strategy, value, note = "") => ({ strategy, value: String(value ?? ""), note, candidates: [] });

  // 1) PROFILE — static facts + skills headings
  if (data.profile.values && Object.prototype.hasOwnProperty.call(data.profile.values, name)) {
    return make("profile", data.profile.values[name], "From profile");
  }

  // 2) SKILLS rows (repeated) — one category per row
  if (name === "2_LINES_OF_COMMA_SEPARATED_SKILLS") {
    return make("skills", state.skillRows[occurrence % state.skillRows.length] || "", "Skill row");
  }

  // 3) Areas of emphasis — each role gets a related-but-distinct slice of the
  // posting's domain keywords (sliding window by occurrence). AREA_OF_EMPHASIS is
  // the singular form (one domain per slot); AREAS_OF_EMPHASIS lists a few.
  if (name === "AREAS_OF_EMPHASIS" || name === "AREA_OF_EMPHASIS") {
    const pool = capabilityPool(keywords, state.byCat, ["domain"], state.universe, state.allowGaps).slice(0, EMPHASIS_POOL);
    const size = name === "AREA_OF_EMPHASIS" ? 1 : EMPHASIS_WINDOW;
    return make("keywords", emphasisSlice(pool, size, occurrence) || "enterprise systems", "Areas of emphasis (per-role)");
  }

  // 4) KEYWORD_JOIN (capability lines) — repeated slots slide by occurrence so
  // each repeat shows a distinct slice instead of the same list every time.
  if (KEYWORD_JOIN[name]) {
    const { cats, k, avoid } = KEYWORD_JOIN[name];
    return make("keywords", capabilityJoin(keywords, state.byCat, cats, k, state.universe, state.allowGaps, avoid, occurrence), `Top ${cats.join("+")} keywords`);
  }

  // 5) COURSE_TOPICS — N tech/people keywords
  if (COURSE_RE.test(name)) {
    const n = Number.parseInt((name.match(COURSE_COUNT_RE) || [])[1], 10) || 3;
    return make("keywords", capabilityJoin(keywords, state.byCat, ["technology", "soft_skill"], n, state.universe, state.allowGaps), `${n} course topics`);
  }

  // 6) LIBRARY_MATCH — real accomplishment / project fragments
  const lib = libraryMatch(name, data.library, state.ctx, state.used, state.allowFabricated);
  if (lib != null) return make("library", lib, "From content library");

  // 7) FRAGMENT / PROJECT phrasing pools (neutral fallback)
  const fragment = fragmentValue(name, state.cursors);
  if (fragment != null) return make("phrase", fragment, "Composed phrase");

  // 8) MANUAL
  return make("manual", "", "Needs your input");
}

// Enrich every scanned slot with a value. Processed in document order so the
// skill-row categories, area-of-emphasis indexing, and phrase cursors are
// deterministic.
export function mapSlots(slots, keywords, data, options = {}) {
  const ctx = buildContext(keywords);
  const aggressiveness = clampAggressiveness(options.aggressiveness);
  const universe = options.universe || candidateUniverse();
  const byCat = candidateSkillsByCategory();
  const skillRows = buildSkillRows(keywords, byCat, ctx, universe, GAP_BUDGET[aggressiveness] || 0);
  const allowGaps = aggressiveness >= 3;
  const state = {
    ctx,
    byCat,
    skillRows,
    cursors: new Map(),
    universe,
    allowGaps,
    used: new Set(),
    allowFabricated: allowGaps,
  };
  return slots.map((slot) => ({ ...slot, ...mapOne(slot, keywords, data, state) }));
}
