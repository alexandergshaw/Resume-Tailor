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
import { candidateUniverse, candidateSkillsByCategory, conditionalSkillSet } from "./universe.js";

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

// Rank a list of taught subjects so the one(s) the posting names outright lead,
// then the authored order (stable). Used for the adjunct teaching emphasis and
// course topics within a single resolved teaching area.
function rankTaughtSubjects(subjects, ctx, taxonomy) {
  const named = (s) => {
    const canon = canonicalize(s, taxonomy);
    return canon && ctx.jobCanonical.has(canon.toLowerCase());
  };
  return subjects
    .map((s, i) => ({ s, i, named: named(s) ? 1 : 0 }))
    .sort((a, b) => b.named - a.named || a.i - b.i)
    .map((x) => x.s);
}

// The subjects shown in the adjunct teaching emphasis / course topics: the resolved
// teaching area's subjects, or the default teaching subjects for a non-teaching
// (e.g. software) posting.
function teachingSubjects(data, state) {
  const fromArea = state.focusArea && Array.isArray(state.focusArea.subjects) ? state.focusArea.subjects : null;
  const list = fromArea || data.profile.default_teaching_subjects || [];
  return list.filter((s) => typeof s === "string" && s.trim());
}

// --- Focus-area resolution -------------------------------------------------
// ANY posting that shows it needs experience in one of the candidate's focus
// areas activates that area (no teaching context required), which then retargets
// the résumé/cover letter to that area: the full-time job emphasis (job_emphases),
// the skills first row + summary focus + adjunct emphasis (subjects), and the
// capability lines (technical_capabilities, domain_capabilities). The strongest-
// signalled area wins, and only if its signal clears a threshold — so an
// incidental one-off mention in an otherwise-software posting does not retarget it.
const AREA_SIGNAL_THRESHOLD = 2;

// How strongly a posting calls for an area's `match` term: the extracted-keyword
// score (section-weighted: title x3, requirements x2, body x1) if it's a known
// canonical, else the number of raw-text mentions (so role/discipline phrases like
// "Technical Writer" or "Business Administration" that aren't in the taxonomy count).
function matchStrength(term, ctx, postingLower, taxonomy) {
  const canon = canonicalize(term, taxonomy);
  if (canon && ctx.postingScore.has(canon.toLowerCase())) return ctx.postingScore.get(canon.toLowerCase());
  const needle = term.toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let i = postingLower.indexOf(needle);
  while (i !== -1) {
    count += 1;
    i = postingLower.indexOf(needle, i + needle.length);
  }
  return count;
}

function resolveFocusArea(areas, ctx, posting, taxonomy, overrideName) {
  // A user-pinned focus (the previewer's "wrong focus" flag) wins outright —
  // no scoring, no threshold. Unknown names fall through to auto-detection so
  // a stale override degrades instead of failing.
  const wanted = String(overrideName || "").trim().toLowerCase();
  if (wanted) {
    const hit = (areas || []).find((a) => String(a.name || "").toLowerCase() === wanted);
    if (hit) return hit;
  }
  const postingLower = String(posting || "").toLowerCase();
  if (!postingLower) return null;
  let best = null;
  let bestScore = 0;
  for (const area of areas || []) {
    let score = 0;
    for (const term of area.match || []) score += matchStrength(term, ctx, postingLower, taxonomy);
    if (score > bestScore) {
      best = area;
      bestScore = score;
    }
  }
  return bestScore >= AREA_SIGNAL_THRESHOLD ? best : null;
}

// --- KEYWORD_JOIN ----------------------------------------------------------

// "Education" is the candidate's teaching context (surfaced separately via
// teaching_subjects -> the adjunct-professor AREA_OF_EMPHASIS and the teaching
// paragraph), never a domain his engineering roles owned. Keep it out of every
// job-scoped domain list — the per-role "(Areas of Emphasis)" parenthetical and
// the "…responsible for {{JOB_RELEVANT_SOLUTIONS}}…" bullet — so an
// education-sector posting can't make the software jobs read as education jobs.
const JOB_DOMAIN_AVOID = ["education"];

const KEYWORD_JOIN = {
  JOB_RELEVANT_TECHNOLOGIES: { cats: ["technology"], k: 6 },
  // The opening paragraph's "hands-on work with {{TECHNICAL_CAPABILITIES}}"
  // should showcase the most impressive APPLICABLE tech (languages, frameworks,
  // databases) — posting-matched first, then the candidate's strongest stack —
  // not just collaboration tools. Falls back to tool_platform so it's never empty.
  TECHNICAL_CAPABILITIES: { cats: ["technology", "tool_platform"], k: 5, areaField: "technical_capabilities" },
  DELIVERY_PRACTICES: { cats: ["methodology"], k: 4 },
  DOMAIN_CAPABILITIES: { cats: ["domain"], k: 4, areaField: "domain_capabilities" },
  // The summary already reads "leading cross-functional teams through
  // {{LEADERSHIP_CAPABILITIES}}", so suppress capabilities that merely echo those
  // words (Leadership, Cross-Functional Collaboration) — otherwise the sentence
  // repeats itself ("leading … Leadership", "cross-functional … Cross-Functional").
  LEADERSHIP_CAPABILITIES: {
    cats: ["soft_skill"],
    k: 4,
    avoid: ["lead", "leading", "leadership", "cross", "functional", "team", "teams"],
  },
  JOB_RELEVANT_SOLUTIONS: { cats: ["domain"], k: 4, avoid: JOB_DOMAIN_AVOID },
  // Résumé summary tail ("Experienced with …, and {{ROLE_RELEVANT_FOCUS}}"). Same
  // as DOMAIN_CAPABILITIES for software postings, but on a resolved teaching posting
  // it leads with the subjects taught (College Algebra, …). Used only in the
  // summary, so the cover letter and job bullets are untouched.
  ROLE_RELEVANT_FOCUS: { cats: ["domain"], k: 4, areaField: "subjects" },
};

// Categories the cover letter's technical-skills line ({{ROLE_RELEVANT_STACK}})
// draws from, and the minimum length it pads to so a non-technical posting still
// yields a short, sensible line instead of raw braces.
const STACK_CATS = ["technology", "tool_platform", "methodology", "domain"];
const STACK_MIN = 6;

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

function capabilityPool(keywords, byCat, cats, universe, allowGaps, avoid, taxonomy, skillGroups) {
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
  // Pad with the candidate's own skills — but never with `conditional` skills,
  // which only belong here when the posting itself asks for them (i.e. when they
  // arrive via `merged` above).
  const conditional = conditionalSkillSet(skillGroups, taxonomy);
  for (const c of cats) for (const s of byCat[c] || []) {
    if (conditional.has((canonicalize(s, taxonomy) || s).toLowerCase())) continue;
    push(s);
  }
  return out;
}

// A k-item capability line drawn from the pool at a sliding `offset`. With
// offset 0 this is the top-k (so a slot's first occurrence is unchanged);
// repeated slots pass their occurrence index so each repeat surfaces a distinct,
// still-relevant slice instead of the same list every time.
function capabilityJoin(keywords, byCat, cats, k, universe, allowGaps, avoid, offset = 0, serialAnd = false, taxonomy, skillGroups) {
  const pool = capabilityPool(keywords, byCat, cats, universe, allowGaps, avoid, taxonomy, skillGroups);
  return emphasisSlice(pool, k, offset, serialAnd);
}

// --- Areas of emphasis (per-role) ------------------------------------------
// Each role's parenthetical should be related to the posting but not identical
// across roles. We draw a generous pool once, then give each occurrence a window
// that slides by one — consecutive roles overlap (related) without repeating.
//
// Jobs and teaching draw from DIFFERENT sources so the distinction is clear:
//   AREAS_OF_EMPHASIS (engineering jobs / the target role) -> the posting's
//     business + solution DOMAINS (e.g. Payments, Web Development, Financial
//     Services), tailored per posting.
//   AREA_OF_EMPHASIS (the candidate's adjunct-professor teaching) -> the ordered
//     list of technical subjects taught (profile.teaching_subjects), so teaching
//     always LEADS with those subjects regardless of posting. In-the-weeds domain
//     jargon (ETL, Distributed Systems) never shows up as a teaching emphasis.
const EMPHASIS_WINDOW = 3;
const EMPHASIS_POOL = 8;
// Fallback category mix when profile.teaching_subjects is empty.
const TEACHING_FALLBACK_CATS = ["technology", "soft_skill"];
const EMPHASIS_FALLBACK = {
  AREAS_OF_EMPHASIS: "enterprise systems",
  AREA_OF_EMPHASIS: "software engineering",
};

// Join list items, optionally with a serial ("Oxford") "and" before the last —
// prose reads "A, B, and C"; comma-only lists (e.g. résumé skill rows) read
// "A, B, C". serialAnd is on for the cover letter's prose lists only.
function joinList(items, serialAnd) {
  if (!serialAnd || items.length < 2) return items.join(", ");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function emphasisSlice(pool, size, offset, serialAnd = false) {
  if (pool.length === 0) return "";
  const n = Math.min(size, pool.length);
  const start = offset % pool.length;
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(pool[(start + i) % pool.length]);
  return joinList(out, serialAnd);
}

// --- SKILLS rows (one taxonomy category per row) ---------------------------

const SKILL_ROW_CATEGORIES = ["domain", "technology", "tool_platform", "soft_skill", "methodology"];
const SKILL_ROW_MAX = 16;

// Build the 5 skills rows: candidate skills for each category, posting-matched
// first, then (per aggressiveness) swap trailing low-relevance ones for posting
// gap keywords, keeping each row's item count fixed. On a resolved teaching posting
// the first row ("Role-Specific Expertise") leads with that area's subjects instead
// of engineering domains; everything else is unchanged, so software postings keep
// the exact default rows.
function buildSkillRows(keywords, byCat, ctx, universe, budget, area, taxonomy, skillGroups) {
  const conditional = conditionalSkillSet(skillGroups, taxonomy);
  const orderByPosting = (items) => {
    const matched = [];
    const rest = [];
    for (const s of items) {
      const canon = (canonicalize(s, taxonomy) || s).toLowerCase();
      if (ctx.postingScore.has(canon)) matched.push(s);
      // A conditional skill only appears when the posting matches it — never as
      // unmatched row padding.
      else if (!conditional.has(canon)) rest.push(s);
    }
    return [...matched, ...rest];
  };
  // The first row is the teaching area's subjects ("__subjects__" never matches a
  // gap category, so it is never gap-swapped), or the candidate's domains.
  const firstRow = area && Array.isArray(area.subjects) && area.subjects.length
    ? { cat: "__subjects__", items: orderByPosting(area.subjects) }
    : { cat: "domain", items: orderByPosting(byCat.domain || []) };
  const rows = [
    firstRow,
    ...SKILL_ROW_CATEGORIES.slice(1).map((cat) => ({ cat, items: orderByPosting(byCat[cat] || []) })),
  ];

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
function fragmentScore(entry, ctx, taxonomy) {
  let score = 0;
  for (const tag of entry.tags || []) {
    if (ctx.jobCanonical.has((canonicalize(tag, taxonomy) || tag).toLowerCase())) score += 1;
  }
  return score;
}

// Best-matching unused content_library fragment for a slot. Real fragments are
// always eligible; fabricated ones (invented metrics/spin) only when
// allowFabricated (high aggressiveness). Each fragment is used at most once.
// Returns the fragment text, or null to fall back to the neutral phrase pool.
function libraryMatch(name, library, ctx, used, allowFabricated, taxonomy) {
  const eligible = (library?.entries || []).filter(
    (e) => (e.slots || []).includes(name) && (allowFabricated || !e.fabricated) && !used.has(e.id),
  );
  if (eligible.length === 0) return null;
  eligible.sort(
    (a, b) => fragmentScore(b, ctx, taxonomy) - fragmentScore(a, ctx, taxonomy) || String(a.id).localeCompare(String(b.id)),
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

  // 3) Areas of emphasis. The adjunct teaching emphasis (AREA_OF_EMPHASIS, one
  // subject per slot) leads with the resolved teaching area's subjects, or the
  // default teaching subjects for a non-teaching posting. The full-time-role
  // AREAS_OF_EMPHASIS leads with that area's job_emphases (the facets of the work
  // relevant to teaching it), or the posting's engineering domains for software.
  if (name === "AREA_OF_EMPHASIS") {
    const subjects = teachingSubjects(data, state);
    const pool = subjects.length
      ? rankTaughtSubjects(subjects, state.ctx, state.taxonomy)
      : capabilityPool(keywords, state.byCat, TEACHING_FALLBACK_CATS, state.universe, state.allowGaps, undefined, state.taxonomy, state.skillGroups).slice(0, EMPHASIS_POOL);
    return make("keywords", emphasisSlice(pool, 1, occurrence, state.serialAnd) || EMPHASIS_FALLBACK.AREA_OF_EMPHASIS, "Teaching emphasis (subjects taught)");
  }
  if (name === "AREAS_OF_EMPHASIS") {
    const bridge = (state.focusArea?.job_emphases || []).filter((s) => typeof s === "string" && s.trim());
    if (bridge.length) {
      return make("keywords", emphasisSlice(bridge, EMPHASIS_WINDOW, occurrence, state.serialAnd), `Areas of emphasis (${state.focusArea.name})`);
    }
    const pool = capabilityPool(keywords, state.byCat, ["domain"], state.universe, state.allowGaps, JOB_DOMAIN_AVOID, state.taxonomy, state.skillGroups).slice(0, EMPHASIS_POOL);
    return make("keywords", emphasisSlice(pool, EMPHASIS_WINDOW, occurrence, state.serialAnd) || EMPHASIS_FALLBACK.AREAS_OF_EMPHASIS, "Areas of emphasis (per-role)");
  }

  // 4) KEYWORD_JOIN (capability lines) — repeated slots slide by occurrence so
  // each repeat shows a distinct slice instead of the same list every time.
  // ROLE_RELEVANT_STACK — the cover letter's technical-skills line. Lists every
  // tool/tech/method/domain THIS posting names (uncapped, so the full relevant
  // stack appears), padded up to a small minimum with the candidate's core skills
  // so a non-technical posting yields a short line rather than a wall or raw braces.
  if (name === "ROLE_RELEVANT_STACK") {
    const avoidWords = significantWords(JOB_DOMAIN_AVOID.join(" "));
    const seen = new Set();
    const out = [];
    const tryPush = (s) => {
      const low = (canonicalize(s, state.taxonomy) || s).toLowerCase();
      if (!low || seen.has(low)) return;
      const words = [...significantWords(s)];
      if (words.length && words.some((w) => avoidWords.has(w))) return;
      seen.add(low);
      out.push(s);
    };
    const merged = [];
    for (const c of STACK_CATS) for (const item of keywords[c] || []) merged.push(item);
    merged.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
    for (const item of merged) {
      if (!state.allowGaps && !state.universe.has(item.canonical.toLowerCase())) continue;
      tryPush(item.canonical);
    }
    if (out.length < STACK_MIN) {
      const conditional = conditionalSkillSet(state.skillGroups, state.taxonomy);
      for (const c of STACK_CATS) for (const s of state.byCat[c] || []) {
        if (out.length >= STACK_MIN) break;
        if (conditional.has((canonicalize(s, state.taxonomy) || s).toLowerCase())) continue;
        tryPush(s);
      }
    }
    return make("keywords", joinList(out, state.serialAnd), "Posting-matched technical stack");
  }

  if (KEYWORD_JOIN[name]) {
    const { cats, k, avoid, areaField } = KEYWORD_JOIN[name];
    const limit = state.maxKeywords ? Math.min(k, state.maxKeywords) : k;
    // On a resolved teaching posting, a slot mapped to an area field is REPLACED by
    // that area's curated list (the subjects taught, or its data/domain capability
    // lines), so the cover letter, summary, and job bullets read for the subject area.
    if (state.focusArea && areaField) {
      const list = (state.focusArea[areaField] || []).filter((s) => typeof s === "string" && s.trim());
      if (list.length) {
        return make("keywords", emphasisSlice(list, limit, occurrence, state.serialAnd), `Focus area (${state.focusArea.name}.${areaField})`);
      }
    }
    return make("keywords", capabilityJoin(keywords, state.byCat, cats, limit, state.universe, state.allowGaps, avoid, occurrence, state.serialAnd, state.taxonomy, state.skillGroups), `Top ${cats.join("+")} keywords`);
  }

  // 5) COURSE_TOPICS — the subjects taught that this posting asks for. For a
  // resolved teaching posting lead with the matching area subjects; otherwise fall
  // back to the candidate's technologies (the default for software postings).
  if (COURSE_RE.test(name)) {
    const n = Number.parseInt((name.match(COURSE_COUNT_RE) || [])[1], 10) || 3;
    const subjectTopics = state.focusArea ? rankTaughtSubjects(teachingSubjects(data, state), state.ctx, state.taxonomy) : [];
    const techPool = capabilityPool(keywords, state.byCat, ["technology"], state.universe, state.allowGaps, undefined, state.taxonomy, state.skillGroups);
    const seen = new Set();
    const pool = [];
    for (const item of [...subjectTopics, ...techPool]) {
      const low = item.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      pool.push(item);
    }
    return make("keywords", emphasisSlice(pool, n, 0, state.serialAnd), `${n} course topics`);
  }

  // 6) LIBRARY_MATCH — real accomplishment / project fragments
  const lib = libraryMatch(name, data.library, state.ctx, state.used, state.allowFabricated, state.taxonomy);
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
// Like mapSlots, but also reports WHICH focus area drove the mapping so the
// engine can surface it (report.meta.focus) and honor a user override
// (`options.focusAreaName`, from the previewer's focus picker).
export function mapSlotsDetailed(slots, keywords, data, options = {}) {
  const ctx = buildContext(keywords);
  const aggressiveness = clampAggressiveness(options.aggressiveness);
  // The library the rest of the mapper reads from. `data.taxonomy`/`data.skillGroups`
  // are supplied by the engine (bundled default, or a per-user library); when absent
  // (e.g. a hand-built `data` in a unit test) the keyword/universe helpers fall back
  // to the bundled defaults, so behavior is unchanged.
  const taxonomy = data.taxonomy;
  const skillGroups = data.skillGroups;
  const universe = options.universe || candidateUniverse(skillGroups, taxonomy);
  const byCat = candidateSkillsByCategory(skillGroups, taxonomy);
  // The posting's resolved focus area (or null) drives every area-specific
  // tailoring decision below; a user override (by name) beats auto-detection.
  const focusArea = resolveFocusArea(
    data.profile?.focus_areas,
    ctx,
    options.posting,
    taxonomy,
    options.focusAreaName,
  );
  const skillRows = buildSkillRows(keywords, byCat, ctx, universe, GAP_BUDGET[aggressiveness] || 0, focusArea, taxonomy, skillGroups);
  const allowGaps = aggressiveness >= 3;
  const maxKeywords = Number.isInteger(options.maxKeywords) ? options.maxKeywords : null;
  const state = {
    ctx,
    byCat,
    skillRows,
    focusArea,
    cursors: new Map(),
    universe,
    allowGaps,
    used: new Set(),
    allowFabricated: allowGaps,
    maxKeywords,
    taxonomy,
    skillGroups,
    // Serial "and" before the last list item (prose lists; cover letter only).
    serialAnd: !!options.serialAnd,
  };
  return {
    slots: slots.map((slot) => ({ ...slot, ...mapOne(slot, keywords, data, state) })),
    focusArea,
  };
}

// Original slots-only interface (tests and older callers).
export function mapSlots(slots, keywords, data, options = {}) {
  return mapSlotsDetailed(slots, keywords, data, options).slots;
}
