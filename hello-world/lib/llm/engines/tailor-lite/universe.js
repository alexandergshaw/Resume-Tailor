// The candidate's canonical skill "universe" — every taxonomy term they can
// truthfully claim — built by running the SAME extraction over all of their
// materials (skill rows + library bullet text/tags), so terms nested inside a
// skill string are recognized too (e.g. "Healthcare Interoperability (HL7, FHIR,
// CCD/C-CDA)" contributes HL7, FHIR, C-CDA). Shared by the strategy mapper
// (gap insertion) and the researcher (matched/gaps advisory).

import { extractKeywords } from "./keywords.js";
import skillGroups from "./data/skill_groups.json";
import library from "./data/content_library.json";

let cache = null;

export function candidateUniverse() {
  if (cache) return cache;
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
  cache = set;
  return set;
}
