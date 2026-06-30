// Deterministic keyword extraction from a job posting. No LLM, no network: the
// same posting always yields the same keywords, sorted with explicit
// tiebreakers. Three passes feed one another:
//   1. Tokenize (keeping interior +, #, . so C++, C#, .NET, Node.js survive).
//   2. Taxonomy n-gram match against the bundled skills taxonomy (longest match
//      first, consumed spans excluded), giving canonical casing + a category.
//   3. RAKE-lite for multiword phrases the taxonomy misses -> advisory "topic".
// Section weighting boosts terms in the title area and requirement/skills
// sections so they outrank nice-to-haves.

import { defaultLibraryData } from "./library/defaults.js";

// Taxonomy is injectable (per-user libraries); stopwords stay bundled (not editable).
const defaultTaxonomy = defaultLibraryData.taxonomy;
const STOPWORDS = new Set(defaultLibraryData.stopwords);

// A token is a maximal run of alphanumerics that may carry interior/leading/
// trailing +, #, or . (so c++, c#, .net, node.js survive). A trailing "." is a
// sentence period, not part of the token, so it is stripped.
const TOKEN_RE = /\.?[a-z0-9][a-z0-9+#.]*/g;

export function tokenize(text) {
  const out = [];
  const matches = String(text).toLowerCase().match(TOKEN_RE) || [];
  for (const raw of matches) {
    const token = raw.replace(/\.+$/g, "");
    if (token) out.push(token);
  }
  return out;
}

// Split a line into segments of consecutive tokens, breaking at punctuation so
// n-grams never cross it. Hyphens and slashes become spaces so "machine-learning"
// and "CI/CD" can match the "machine learning" / "ci cd" aliases.
function segmentLine(line) {
  return String(line)
    .toLowerCase()
    .replace(/[-/]/g, " ")
    .split(/[^a-z0-9+#.\s]+/)
    .map((segment) => {
      const tokens = segment.match(TOKEN_RE) || [];
      return tokens.map((t) => t.replace(/\.+$/g, "")).filter(Boolean);
    })
    .filter((tokens) => tokens.length > 0);
}

// Build a lowercase alias -> { canonical, category } map once. Canonical text
// (and each alias) is registered lowercased; the canonical itself is also a
// match key so "JavaScript" resolves to itself.
// Built once per taxonomy object (keyed on the taxonomy reference), so the bundled
// default is cached exactly as before and each per-user taxonomy gets its own entry.
const aliasMapCache = new WeakMap();
function getAliasMap(taxonomy = defaultTaxonomy) {
  const cached = aliasMapCache.get(taxonomy);
  if (cached) return cached;
  const map = new Map();
  for (const entry of taxonomy.entries || []) {
    const meta = { canonical: entry.canonical, category: entry.category };
    // match_canonical:false (default true) means only the aliases match, not the
    // canonical itself — used for short/ambiguous words like "Go", "R", "C".
    const keys = entry.match_canonical === false
      ? [...(entry.aliases || [])]
      : [entry.canonical, ...(entry.aliases || [])];
    for (const key of keys) {
      const lower = String(key).toLowerCase().replace(/[-/]/g, " ").trim();
      if (lower && !map.has(lower)) map.set(lower, meta);
    }
  }
  aliasMapCache.set(taxonomy, map);
  return map;
}

// Resolve a free-text term to its taxonomy canonical (or null if unknown).
// Tokenized the same way as keyword matching so "rest apis" -> "REST", etc.
export function canonicalize(term, taxonomy = defaultTaxonomy) {
  const lower = String(term).toLowerCase().replace(/[-/]/g, " ").trim();
  return getAliasMap(taxonomy).get(lower)?.canonical || null;
}

// The résumé-specific category for a term, or null if unknown. Used by the
// composed (Parser) path to type Parser terms locally — the Parser supplies
// display casing, but the technology/tool/methodology/soft_skill/domain split is
// resume-specific and stays here.
export function categorize(term, taxonomy = defaultTaxonomy) {
  const lower = String(term).toLowerCase().replace(/[-/]/g, " ").trim();
  return getAliasMap(taxonomy).get(lower)?.category || null;
}

const HEADER_RE = /(requirement|qualification|must have|skills)/i;
const BULLET_RE = /^([-*•·]|\d+[.)])\s+/;
const MAX_NGRAM = 4;

// Weight for a line: title area (first 3 non-empty lines) x3; lines in a
// requirement/skills section x2; everything else x1. Bullets can't be headers.
function lineWeights(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const result = [];
  let nonEmpty = 0;
  let sectionWeight = 1;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    nonEmpty += 1;
    const isBullet = BULLET_RE.test(line);
    // A header is a colon-terminated label or a short heading that explicitly
    // names a requirement/skills section. Plain content lines (even one-word
    // ones like "Python") are NOT headers, so they don't reset the section.
    const isHeader =
      !isBullet &&
      line.length <= 60 &&
      (line.endsWith(":") || (HEADER_RE.test(line) && line.split(/\s+/).length <= 5));
    if (isHeader) sectionWeight = HEADER_RE.test(line) ? 2 : 1;
    const weight = Math.max(nonEmpty <= 3 ? 3 : 1, sectionWeight);
    result.push({ line, weight });
  }
  return result;
}

// Greedy longest-match taxonomy tagging of one segment's tokens. Returns the
// matched { canonical, category } entries; consumed token spans are skipped.
function matchSegment(tokens, aliasMap) {
  const matches = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let n = Math.min(MAX_NGRAM, tokens.length - i); n >= 1; n -= 1) {
      const phrase = tokens.slice(i, i + n).join(" ");
      const meta = aliasMap.get(phrase);
      if (meta) {
        matches.push(meta);
        i += n;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1;
  }
  return matches;
}

// --- RAKE-lite (advisory multiword phrases) --------------------------------

function rakePhrases(text, aliasMap) {
  // Candidate phrases: runs of non-stopword tokens between stopwords/punctuation.
  const phrases = [];
  for (const { line } of lineWeights(text)) {
    for (const tokens of segmentLine(line)) {
      let current = [];
      for (const token of tokens) {
        if (STOPWORDS.has(token)) {
          if (current.length) phrases.push(current);
          current = [];
        } else {
          current.push(token);
        }
      }
      if (current.length) phrases.push(current);
    }
  }

  // Word degree / frequency scoring.
  const freq = new Map();
  const degree = new Map();
  for (const phrase of phrases) {
    for (const word of phrase) {
      freq.set(word, (freq.get(word) || 0) + 1);
      degree.set(word, (degree.get(word) || 0) + phrase.length);
    }
  }

  const scored = new Map(); // joined phrase -> { score, count }
  for (const phrase of phrases) {
    if (phrase.length < 2) continue; // multiword only
    const joined = phrase.join(" ");
    if (aliasMap.has(joined)) continue; // already captured by taxonomy
    const score = phrase.reduce((sum, w) => sum + degree.get(w) / freq.get(w), 0);
    const existing = scored.get(joined);
    if (existing) existing.count += 1;
    else scored.set(joined, { score: Math.round(score * 100) / 100, count: 1 });
  }

  return Array.from(scored.entries())
    .map(([canonical, v]) => ({ canonical, score: v.score, count: v.count }))
    .sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical))
    .slice(0, 12);
}

// Extract keywords grouped by category. Returns
//   { technology: [{canonical, score, count}], ..., topic: [...] }
// with each list sorted by (-score, canonical).
export function extractKeywords(posting, taxonomy = defaultTaxonomy) {
  const aliasMap = getAliasMap(taxonomy);
  const acc = new Map(); // canonical -> { category, score, count }

  for (const { line, weight } of lineWeights(posting)) {
    for (const tokens of segmentLine(line)) {
      for (const meta of matchSegment(tokens, aliasMap)) {
        const existing = acc.get(meta.canonical);
        if (existing) {
          existing.score += weight;
          existing.count += 1;
        } else {
          acc.set(meta.canonical, { category: meta.category, score: weight, count: 1 });
        }
      }
    }
  }

  const grouped = {};
  for (const [canonical, v] of acc) {
    if (!grouped[v.category]) grouped[v.category] = [];
    grouped[v.category].push({ canonical, score: v.score, count: v.count });
  }
  for (const category of Object.keys(grouped)) {
    grouped[category].sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
  }

  const topics = rakePhrases(posting, aliasMap);
  if (topics.length) grouped.topic = topics;

  return grouped;
}
