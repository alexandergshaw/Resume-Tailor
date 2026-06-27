// The candidate's canonical skill "universe" — every taxonomy term they can
// truthfully claim — built by running the SAME extraction over all of their
// materials (skill rows + library bullet text/tags), so terms nested inside a
// skill string are recognized too (e.g. "Healthcare Interoperability (HL7, FHIR,
// CCD/C-CDA)" contributes HL7, FHIR, C-CDA). Shared by the strategy mapper
// (gap insertion) and the researcher (matched/gaps advisory).

import { extractKeywords } from "./keywords.js";
import skillGroups from "./data/skill_groups.json";

let cache = null;
let byCategoryCache = null;

function extractCandidateKeywords() {
  const blob = [];
  for (const group of skillGroups.groups || []) {
    blob.push(group.heading);
    for (const kw of group.keywords || []) blob.push(kw);
  }
  return extractKeywords(blob.join(". "));
}

export function candidateUniverse() {
  if (cache) return cache;
  const grouped = extractCandidateKeywords();
  const set = new Set();
  for (const category of Object.keys(grouped)) {
    for (const k of grouped[category]) set.add(k.canonical.toLowerCase());
  }
  cache = set;
  return set;
}

// The candidate's real skills grouped by taxonomy category, e.g.
// { technology: ["JavaScript", ...], domain: [...], ... }. Used to fill the
// skills-section rows (one category per row).
export function candidateSkillsByCategory() {
  if (byCategoryCache) return byCategoryCache;
  const grouped = extractCandidateKeywords();
  const byCat = {};
  for (const category of Object.keys(grouped)) {
    byCat[category] = grouped[category].map((k) => k.canonical);
  }
  byCategoryCache = byCat;
  return byCat;
}
