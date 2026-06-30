// The candidate's canonical skill "universe" — every taxonomy term they can
// truthfully claim — built by running the SAME extraction over all of their
// materials (skill rows + library bullet text/tags), so terms nested inside a
// skill string are recognized too (e.g. "Healthcare Interoperability (HL7, FHIR,
// CCD/C-CDA)" contributes HL7, FHIR, C-CDA). Shared by the strategy mapper
// (gap insertion) and the researcher (matched/gaps advisory).

import { extractKeywords } from "./keywords.js";
import { defaultLibraryData } from "./library/defaults.js";

const defaultSkillGroups = defaultLibraryData.skillGroups;

// Caches keyed on the skillGroups object, so the bundled default is cached exactly
// as before and each per-user skillGroups gets its own entry. (Each library pairs
// one skillGroups with one taxonomy, so keying on skillGroups alone is sufficient.)
const universeCache = new WeakMap();
const byCategoryCache = new WeakMap();
const conditionalCache = new WeakMap();

function extractCandidateKeywords(skillGroups, taxonomy) {
  const blob = [];
  for (const group of skillGroups.groups || []) {
    blob.push(group.heading);
    for (const kw of group.keywords || []) blob.push(kw);
  }
  return extractKeywords(blob.join(". "), taxonomy);
}

// Canonical (lowercased) skills that belong to a `conditional` skill group: real
// skills that should only surface in the résumé when the posting actually asks for
// them, never as padding. The strategy keeps them out of the unmatched "rest" of a
// skills row / capability line.
export function conditionalSkillSet(skillGroups = defaultSkillGroups, taxonomy) {
  const cached = conditionalCache.get(skillGroups);
  if (cached) return cached;
  const set = new Set();
  for (const group of skillGroups.groups || []) {
    if (!group.conditional) continue;
    // Extract each keyword on its own so adjacency never merges two (e.g. joined
    // "PHP. Composer" would match the "php composer" Composer alias and lose PHP).
    for (const kw of group.keywords || []) {
      const grouped = extractKeywords(kw, taxonomy);
      for (const category of Object.keys(grouped)) {
        if (category === "topic") continue;
        for (const k of grouped[category]) set.add(k.canonical.toLowerCase());
      }
    }
  }
  conditionalCache.set(skillGroups, set);
  return set;
}

export function candidateUniverse(skillGroups = defaultSkillGroups, taxonomy) {
  const cached = universeCache.get(skillGroups);
  if (cached) return cached;
  const grouped = extractCandidateKeywords(skillGroups, taxonomy);
  const set = new Set();
  for (const category of Object.keys(grouped)) {
    for (const k of grouped[category]) set.add(k.canonical.toLowerCase());
  }
  universeCache.set(skillGroups, set);
  return set;
}

// The candidate's real skills grouped by taxonomy category, e.g.
// { technology: ["JavaScript", ...], domain: [...], ... }. Used to fill the
// skills-section rows (one category per row).
export function candidateSkillsByCategory(skillGroups = defaultSkillGroups, taxonomy) {
  const cached = byCategoryCache.get(skillGroups);
  if (cached) return cached;
  const grouped = extractCandidateKeywords(skillGroups, taxonomy);
  const byCat = {};
  for (const category of Object.keys(grouped)) {
    byCat[category] = grouped[category].map((k) => k.canonical);
  }
  byCategoryCache.set(skillGroups, byCat);
  return byCat;
}
