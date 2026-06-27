// In-house parser. The "parsing" stage runs entirely in this app — no external
// service, no network. It is the local taxonomy/RAKE keyword extraction
// (keywords.js), plus the dominant domain emphases used to focus the in-house
// researcher. Deterministic: same posting -> same result.

import { extractKeywords } from "./keywords.js";

const MAX_EMPHASES = 3;

export function parsePosting(posting) {
  const keywords = extractKeywords(posting);
  const emphases = (keywords.domain || []).slice(0, MAX_EMPHASES).map((k) => k.canonical);
  return { keywords, emphases };
}
