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
let conditionalCache = null;

function extractCandidateKeywords() {
  const blob = [];
  for (const group of skillGroups.groups || []) {
    blob.push(group.heading);
    for (const kw of group.keywords || []) blob.push(kw);
  }
  return extractKeywords(blob.join(". "));
}

// Canonical (lowercased) skills that belong to a `conditional` skill group: real
// skills that should only surface in the résumé when the posting actually asks for
// them, never as padding. The strategy keeps them out of the unmatched "rest" of a
// skills row / capability line.
export function conditionalSkillSet() {
  if (conditionalCache) return conditionalCache;
  const set = new Set();
  for (const group of skillGroups.groups || []) {
    if (!group.conditional) continue;
    // Extract each keyword on its own so adjacency never merges two (e.g. joined
    // "PHP. Composer" would match the "php composer" Composer alias and lose PHP).
    for (const kw of group.keywords || []) {
      const grouped = extractKeywords(kw);
      for (const category of Object.keys(grouped)) {
        if (category === "topic") continue;
        for (const k of grouped[category]) set.add(k.canonical.toLowerCase());
      }
    }
  }
  conditionalCache = set;
  return set;
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
