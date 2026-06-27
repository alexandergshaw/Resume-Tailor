// In-house researcher. Derives advisory context + cover-letter facts from the
// posting itself (and the company name) — NO external sources, no network, fully
// deterministic. The quarantine still applies:
//   - RÉSUMÉS: advisory only — returned for the report, never inserted into the
//     .docx, so the document is byte-identical with the advisory present or not.
//   - COVER LETTERS: only the structured facts ORGANIZATION_CONTEXT / ROLE_FOCUS
//     become rendered content, via the same occurrence-indexed fill.

import { extractKeywords } from "./keywords.js";
import skillGroups from "./data/skill_groups.json";
import library from "./data/content_library.json";

// The candidate's canonical skill universe — everything they can truthfully
// claim. Built by running the SAME taxonomy extraction over all of their
// materials (skill rows, library bullet text + tags), so terms nested inside a
// skill string are recognized too (e.g. "Healthcare Interoperability (HL7, FHIR,
// CCD/C-CDA)" contributes HL7, FHIR and C-CDA). Used to split the posting's
// keywords into "matched" (already in the résumé, surfaced by the reorder
// strategies) vs "gaps" (the posting wants them but the candidate doesn't have
// them — advisory only, never auto-inserted).
let universeCache = null;
function candidateUniverse() {
  if (universeCache) return universeCache;
  const blob = [];
  for (const group of skillGroups.groups || []) {
    blob.push(group.heading);
    for (const kw of group.keywords || []) blob.push(kw);
  }
  for (const entry of library.entries || []) {
    blob.push(entry.text);
    for (const tag of entry.tags || []) blob.push(tag);
  }
  const grouped = extractKeywords(blob.join(". "));
  const set = new Set();
  for (const category of Object.keys(grouped)) {
    for (const k of grouped[category]) set.add(k.canonical.toLowerCase());
  }
  universeCache = set;
  return set;
}

// Top-N distinct canonicals across the given categories, by (-score, canonical).
function topCanonicals(keywords, categories, n) {
  const merged = [];
  for (const cat of categories) {
    for (const item of keywords[cat] || []) merged.push(item);
  }
  merged.sort((a, b) => b.score - a.score || a.canonical.localeCompare(b.canonical));
  const seen = new Set();
  const out = [];
  for (const item of merged) {
    const low = item.canonical.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(item.canonical);
    if (out.length >= n) break;
  }
  return out;
}

const ROLE_FOCUS_CATEGORIES = ["technology", "tool_platform", "methodology", "soft_skill"];

// Returns { advisory, facts }. `facts` may be empty (slots then fall back).
export function research({ posting, company = "" } = {}) {
  const keywords = extractKeywords(String(posting || ""));
  const domain = (keywords.domain || [])[0]?.canonical || "";
  const org = String(company || "").trim();
  const roleFocus = topCanonicals(keywords, ROLE_FOCUS_CATEGORIES, 6);

  let organizationContext = "";
  if (org && domain) organizationContext = `your work at ${org} in ${domain}`;
  else if (org) organizationContext = `your work at ${org}`;
  else if (domain) organizationContext = `your work in ${domain}`;

  const facts = {};
  if (organizationContext) facts.ORGANIZATION_CONTEXT = organizationContext;
  if (roleFocus.length) facts.ROLE_FOCUS = roleFocus.join(", ");

  // Split the posting's keywords (ranked) into ones the candidate already has
  // (surfaced/led in the résumé by the reorder strategies) vs gaps to consider.
  const universe = candidateUniverse();
  const ranked = topCanonicals(keywords, [...ROLE_FOCUS_CATEGORIES, "domain"], 100);
  const matched = ranked.filter((c) => universe.has(c.toLowerCase()));
  const gaps = ranked.filter((c) => !universe.has(c.toLowerCase()));

  const advisory = {
    source: "in-app analysis of the job posting",
    emphases: (keywords.domain || []).slice(0, 3).map((k) => k.canonical),
    matched: matched.slice(0, 15),
    gaps: gaps.slice(0, 15),
  };

  return { advisory, facts };
}
