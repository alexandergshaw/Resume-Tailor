// Pure validators for the library editor. Each returns
//   { ok, errors: string[], warnings: string[], value }
// where `value` is the normalized row fields (no user_id / id / sort_order). Bad
// data breaks tailoring, so these are the guardrails the AI used to apply by hand;
// `warnings` are non-blocking (e.g. an alias likely to cause false matches).

export const TAXONOMY_CATEGORIES = [
  "technology", "tool_platform", "methodology", "soft_skill", "certification", "domain", "subject",
];

// Common words / very short tokens that, used as a standalone alias, tend to match
// unrelated prose (the "next" -> "next level" class of bug we hit before).
const GENERIC_ALIASES = new Set([
  "next", "data", "web", "app", "api", "team", "lead", "cloud", "ai", "ml", "go", "code", "test", "design",
]);

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}
function strArray(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (const item of v) {
    const s = str(item);
    const key = s.toLowerCase();
    if (s && !seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function aliasWarnings(aliases) {
  const warnings = [];
  for (const a of aliases) {
    const low = a.toLowerCase();
    const single = !/\s/.test(a);
    if (single && GENERIC_ALIASES.has(low)) {
      warnings.push(`Alias "${a}" is a common word and may cause false matches in unrelated postings.`);
    } else if (single && /^[a-z]+$/i.test(a) && a.length <= 2) {
      warnings.push(`Alias "${a}" is very short and may match unrelated text.`);
    }
  }
  return warnings;
}

export function validateTaxonomy(input = {}) {
  const errors = [];
  const canonical = str(input.canonical);
  if (!canonical) errors.push("canonical is required.");
  const category = str(input.category);
  if (!TAXONOMY_CATEGORIES.includes(category)) {
    errors.push(`category must be one of: ${TAXONOMY_CATEGORIES.join(", ")}.`);
  }
  const aliases = strArray(input.aliases);
  const match_canonical = input.match_canonical !== false;
  if (match_canonical === false && aliases.length === 0) {
    errors.push("With match_canonical off, at least one alias is required (else nothing matches).");
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: aliasWarnings(aliases),
    value: { canonical, category, aliases, match_canonical },
  };
}

const FOCUS_LIST_FIELDS = ["match", "subjects", "job_emphases", "technical_capabilities", "domain_capabilities"];

export function validateFocusArea(input = {}) {
  const errors = [];
  const name = str(input.name);
  if (!name) errors.push("name is required.");
  const value = { name };
  for (const f of FOCUS_LIST_FIELDS) value[f] = strArray(input[f]);
  const warnings = [];
  if (value.match.length === 0) warnings.push("No match terms — this focus area will never activate.");
  if (value.subjects.length === 0 && value.domain_capabilities.length === 0) {
    warnings.push("No subjects or domain capabilities — the area will surface little when active.");
  }
  return { ok: errors.length === 0, errors, warnings, value };
}

export function validateSkillGroup(input = {}) {
  const errors = [];
  const heading = str(input.heading);
  if (!heading) errors.push("heading is required.");
  const keywords = strArray(input.keywords);
  if (keywords.length === 0) errors.push("at least one keyword is required.");
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    value: { heading, categories: strArray(input.categories), keywords, conditional: !!input.conditional },
  };
}

export function validateContentFragment(input = {}) {
  const errors = [];
  const frag_id = str(input.frag_id || input.id);
  if (!frag_id) errors.push("frag_id is required.");
  else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(frag_id)) errors.push("frag_id must be letters/digits/dash/underscore.");
  const slots = strArray(input.slots);
  if (slots.length === 0) errors.push("at least one slot is required.");
  const text = str(input.text);
  if (!text) errors.push("text is required.");
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    value: { frag_id, slots, text, tags: strArray(input.tags), fabricated: !!input.fabricated },
  };
}

const MAX_VALUE_LEN = 1000;

export function validateProfile(input = {}) {
  const values = {};
  if (input.values && typeof input.values === "object") {
    for (const [k, v] of Object.entries(input.values)) {
      if (typeof v === "string") values[k] = v.slice(0, MAX_VALUE_LEN);
    }
  }
  return {
    ok: true,
    errors: [],
    warnings: [],
    value: { values, default_teaching_subjects: strArray(input.default_teaching_subjects) },
  };
}
