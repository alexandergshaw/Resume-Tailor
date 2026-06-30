// In-house researcher. Derives advisory context + cover-letter facts from the
// posting itself (and the company name) — NO external sources, no network, fully
// deterministic. The quarantine still applies:
//   - RÉSUMÉS: advisory only — returned for the report, never inserted into the
//     .docx, so the document is byte-identical with the advisory present or not.
//   - COVER LETTERS: only the structured facts ORGANIZATION_CONTEXT / ROLE_FOCUS
//     become rendered content, via the same occurrence-indexed fill.

import { extractKeywords } from "./keywords.js";
import { candidateUniverse } from "./universe.js";

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
export function research({ posting, company = "", taxonomy, skillGroups } = {}) {
  const keywords = extractKeywords(String(posting || ""), taxonomy);
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
  const universe = candidateUniverse(skillGroups, taxonomy);
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
