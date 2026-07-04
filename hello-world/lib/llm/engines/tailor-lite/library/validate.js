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

// A persisted "template" edit rule: a case-sensitive { before -> after } text
// replacement (after "" = a deletion). Bounds mirror the deriver/sanitizer in
// lib/tailor/editRules.js so what promotes here is what the client tracks.
const EDIT_RULE_MIN_BEFORE = 4;
const EDIT_RULE_MAX_CHARS = 160;

export function validateEditRule(input = {}) {
  const errors = [];
  const before = str(input.before);
  const after = typeof input.after === "string" ? input.after.trim() : "";
  if (!before) errors.push("before is required.");
  else if (before.length < EDIT_RULE_MIN_BEFORE) errors.push(`before must be at least ${EDIT_RULE_MIN_BEFORE} characters.`);
  else if (before.length > EDIT_RULE_MAX_CHARS) errors.push(`before must be at most ${EDIT_RULE_MAX_CHARS} characters.`);
  if (after.length > EDIT_RULE_MAX_CHARS) errors.push(`after must be at most ${EDIT_RULE_MAX_CHARS} characters.`);
  if (before && before === after) errors.push("before and after must differ.");
  return { ok: errors.length === 0, errors, warnings: [], value: { before, after } };
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

// A saved persona: a named identity that reframes the profile's values, teaching
// subjects, focus area, and cover letter variant without changing the base profile.
// `values` is a partial override map (any string key → string value); `cover_variant`
// is whitelisted to one of the standard teaching/staff/industry/nontechnical variants.
const PERSONA_VALUE_MAX = 200;
const PERSONA_VALUES_MAX_KEYS = 40;
const PERSONA_NAME_MAX = 120;
const PERSONA_FOCUS_MAX = 120;

export function validatePersona(input = {}) {
  const errors = [];

  const name = str(input.name);
  if (!name) errors.push("name is required.");
  else if (name.length > PERSONA_NAME_MAX) errors.push(`name must be at most ${PERSONA_NAME_MAX} characters.`);

  const values = {};
  if (input.values && typeof input.values === "object") {
    let keyCount = 0;
    for (const [k, v] of Object.entries(input.values)) {
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (trimmed.length > 0 && trimmed.length <= PERSONA_VALUE_MAX) {
          values[k] = trimmed;
          keyCount += 1;
          if (keyCount >= PERSONA_VALUES_MAX_KEYS) break;
        }
      }
    }
  }

  const default_teaching_subjects = strArray(input.default_teaching_subjects);

  const focus_area = str(input.focus_area);
  if (focus_area.length > PERSONA_FOCUS_MAX) {
    errors.push(`focus_area must be at most ${PERSONA_FOCUS_MAX} characters.`);
  }

  const rawVariant = str(input.cover_variant).toLowerCase();
  const cover_variant = ["teaching", "staff", "industry", "nontechnical"].includes(rawVariant) ? rawVariant : "";

  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    value: { name, values, default_teaching_subjects, focus_area, cover_variant },
  };
}
