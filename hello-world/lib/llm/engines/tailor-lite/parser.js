// Composed-workflow Parser client. Replaces ONLY Step 2 (keyword extraction):
// it calls the external Parser, then maps the result BACK INTO the same local
// Keyword model { canonical, category, score } the strategies already consume —
// so the deterministic fill core (and strict adherence) is untouched. If the
// Parser is unconfigured or unreachable, the caller falls back to local
// extraction and flags the result `degraded`.
//
// Response shape (per the framework brief; exact field names are isolated in
// FIELDS so they're a one-line change if the service differs):
//   results.technologies -> [{ display }]            (curated tech, no score)
//   results.keywords     -> [{ display, score 0..1 }] (RAKE/lexicon keyphrases)
//   results.field/sector -> { top, ranked: [{ display, score? }] } (domain emphasis)

import { categorize } from "./keywords.js";

const FIELDS = {
  results: "results",
  technologies: "technologies",
  keywords: "keywords",
  field: "field",
  sector: "sector",
  display: "display",
  score: "score",
  top: "top",
  ranked: "ranked",
};

// Synthetic score bands so curated technologies rank high, domain emphases next,
// and [0,1] keyphrase scores scale into the same integer space. Cross-category
// magnitude matters for skill-group ranking; within-category order is by score.
const TECH_BASE = 100;
const EMPHASIS_BASE = 90;
const KEYWORD_SCALE = 60;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Map a raw Parser result object into { keywords: {category:[{canonical,score,
// count}]}, emphases: [string] }. Pure and deterministic. `categoryFor` is
// injectable for testing; defaults to the local taxonomy.
export function mapParserResults(raw, categoryFor = categorize) {
  const results = raw?.[FIELDS.results] || {};
  const merged = new Map(); // canonicalLower -> { canonical, category, score }

  const add = (display, category, score) => {
    const canonical = String(display || "").trim();
    if (!canonical) return;
    const key = canonical.toLowerCase();
    const existing = merged.get(key);
    if (!existing || score > existing.score) {
      merged.set(key, { canonical, category, score: existing ? Math.max(existing.score, score) : score });
    }
  };

  // Curated technologies (no score) -> descending synthetic scores, high band.
  asArray(results[FIELDS.technologies]).forEach((item, i) => {
    const display = typeof item === "string" ? item : item?.[FIELDS.display];
    add(display, categoryFor(display) || "technology", TECH_BASE - i);
  });

  // Domain emphases from field + sector lenses -> "domain" band.
  const emphases = [];
  for (const lens of [FIELDS.field, FIELDS.sector]) {
    const block = results[lens];
    if (!block) continue;
    if (block[FIELDS.top]) emphases.push(String(block[FIELDS.top]));
    asArray(block[FIELDS.ranked]).forEach((item, i) => {
      const display = typeof item === "string" ? item : item?.[FIELDS.display];
      add(display, categoryFor(display) || "domain", EMPHASIS_BASE - i);
    });
  }

  // RAKE/lexicon keyphrases with [0,1] scores -> scaled into the integer space.
  asArray(results[FIELDS.keywords]).forEach((item) => {
    const display = typeof item === "string" ? item : item?.[FIELDS.display];
    const raw01 = typeof item === "object" ? Number(item?.[FIELDS.score]) : NaN;
    const score = Math.round((Number.isFinite(raw01) ? raw01 : 0) * KEYWORD_SCALE);
    add(display, categoryFor(display) || "domain", score);
  });

  // Group by category, sorted by (-score, canonical) with count defaulted to 1.
  const grouped = {};
  for (const { canonical, category, score } of merged.values()) {
    (grouped[category] ||= []).push({ canonical, score, count: 1 });
  }
  for (const category of Object.keys(grouped)) {
    grouped[category].sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
  }

  return { keywords: grouped, emphases: [...new Set(emphases.filter(Boolean))] };
}

function getConfig() {
  return {
    url: process.env.PARSER_API_URL || null,
    key: process.env.PARSER_API_KEY || null,
  };
}

export function isParserConfigured() {
  return !!getConfig().url;
}

// Call the Parser and return mapped keywords + emphases, or null if it isn't
// configured. Throws on a reachable-but-failing service so the caller can decide
// to fall back (degraded).
export async function fetchParserKeywords(posting) {
  const { url, key } = getConfig();
  if (!url) return null;
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (key) headers["X-API-Key"] = key;
  const res = await fetch(url.replace(/\/+$/, ""), {
    method: "POST",
    headers,
    body: JSON.stringify({ text: posting }),
  });
  if (!res.ok) throw new Error(`Parser API error: HTTP ${res.status}`);
  return mapParserResults(await res.json());
}
