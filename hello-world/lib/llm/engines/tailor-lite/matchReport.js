// Posting↔document match scoring — how well a generated résumé / cover letter
// actually covers the posting it was tailored to. Fully deterministic: both
// sides run through the SAME taxonomy extraction the engine tailors with, so
// coverage is alias-aware ("k8s" in the posting is covered by "Kubernetes" in
// the document).
//
// The score is weighted keyword coverage: each posting canonical carries the
// extractKeywords score (frequency + heading-position weighted), and the match
// is the covered share of that total weight. Two gap lists ride along:
//   - missing      — canonicals the taxonomy KNOWS but the document lacks
//                    (the engine saw them and still didn't surface them).
//   - unrecognized — RAKE topic phrases the taxonomy does NOT know. The engine
//                    is blind to these; they're what a buzzword scrape adds.
// A low score plus a fat `unrecognized` list is the signal that the library —
// not the engine — is the bottleneck for this posting.

import { extractKeywords } from "./keywords.js";

// Below this weighted coverage the mismatch is noticeable enough to offer a
// library update. Calibrated against the posting fixtures: in-vocabulary
// postings score well above it; off-domain postings fall well below.
export const MATCH_THRESHOLD = 0.6;

const MAX_TERMS = 12;

function canonicalEntries(grouped) {
  const out = [];
  for (const [category, items] of Object.entries(grouped || {})) {
    if (category === "topic") continue;
    for (const it of items) out.push({ canonical: it.canonical, category, score: it.score });
  }
  return out;
}

// Compute the match between a posting and a generated document's text.
// Returns { score, threshold, belowThreshold, covered, missing, unrecognized }.
export function computeMatch(posting, documentText, taxonomy) {
  const postingKw = extractKeywords(String(posting || ""), taxonomy);
  const docKw = extractKeywords(String(documentText || ""), taxonomy);

  const docCanonicals = new Set(canonicalEntries(docKw).map((e) => e.canonical.toLowerCase()));
  const demand = canonicalEntries(postingKw);

  let totalWeight = 0;
  let coveredWeight = 0;
  const covered = [];
  const missing = [];
  for (const e of demand) {
    totalWeight += e.score;
    if (docCanonicals.has(e.canonical.toLowerCase())) {
      coveredWeight += e.score;
      covered.push({ canonical: e.canonical, category: e.category });
    } else {
      missing.push({ canonical: e.canonical, category: e.category });
    }
  }
  missing.sort((a, b) => a.canonical.localeCompare(b.canonical));
  covered.sort((a, b) => a.canonical.localeCompare(b.canonical));

  // RAKE topics the taxonomy has no entry for — invisible to the engine. Not
  // part of the coverage denominator (the engine can't cover what it can't
  // see), but reported so the caller can grow the library.
  const docText = String(documentText || "").toLowerCase();
  const unrecognized = (postingKw.topic || [])
    .filter((t) => !docText.includes(String(t.canonical).toLowerCase()))
    .map((t) => ({ term: t.canonical, score: t.score }))
    .slice(0, MAX_TERMS);

  // No taxonomy terms at all: an empty posting is vacuously matched; a posting
  // that is ALL unknown vocabulary is a 0 — the engine had nothing to work with.
  const score =
    totalWeight > 0
      ? Math.round((coveredWeight / totalWeight) * 100) / 100
      : unrecognized.length > 0
        ? 0
        : 1;

  return {
    score,
    threshold: MATCH_THRESHOLD,
    belowThreshold: score < MATCH_THRESHOLD,
    covered: covered.slice(0, MAX_TERMS * 2),
    missing: missing.slice(0, MAX_TERMS),
    unrecognized,
  };
}

// Merge per-document matches (résumé + cover letter) into the response-level
// summary: the weakest document drives the score/threshold decision, and the
// gap lists are unioned so the library prompt sees everything at once.
export function combineMatches(matches) {
  const list = (matches || []).filter(Boolean);
  if (list.length === 0) return null;
  const worst = list.reduce((a, b) => (b.score < a.score ? b : a));
  const seenMissing = new Set();
  const seenUnrecognized = new Set();
  const missing = [];
  const unrecognized = [];
  for (const m of list) {
    for (const t of m.missing || []) {
      const key = t.canonical.toLowerCase();
      if (seenMissing.has(key)) continue;
      seenMissing.add(key);
      missing.push(t);
    }
    for (const t of m.unrecognized || []) {
      const key = t.term.toLowerCase();
      if (seenUnrecognized.has(key)) continue;
      seenUnrecognized.add(key);
      unrecognized.push(t);
    }
  }
  return {
    score: worst.score,
    threshold: MATCH_THRESHOLD,
    belowThreshold: worst.score < MATCH_THRESHOLD,
    missing: missing.slice(0, MAX_TERMS),
    unrecognized: unrecognized.slice(0, MAX_TERMS),
  };
}
