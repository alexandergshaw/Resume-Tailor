// The relevance rule behind rankPagesByRelevance (lib/experience/
// knowledgeBase.js) — Okapi BM25 over exactly the candidate array a caller
// hands in, with a stopword-filtered, unstemmed query tokenizer.
//
// WHY THIS IS ITS OWN FILE AND NOT PART OF knowledgeBase.js: that file is
// already close to this repo's verification ceiling, and a scorer with its
// reasoning written down (this repo's own comment density) is on the order
// of 150-200 lines on its own. WHY IT IS NOT PART OF
// lib/copilot/projectStories.js: that module's significantTerms/overlapScore
// are pinned byte-for-byte by lib/copilot/significantTerms.shared.test.js's
// frozen oracle, shared with the meeting domain and the embedded engine's
// honesty gate (clearsHonestyGate), and shipped into the browser bundle
// (app/copilot/AnswerAids.js imports PROJECT_PAGE_SOURCE from it). Changing
// that tokenizer to fix ranking would drag a browser-bundled module's
// honesty-gate tokenizer along for a ride it was never asked to take — see
// that file's own header for the reasoning R-257 is recorded against. This
// module is imported by nothing client-side, so it never reaches the bundle.
//
// Pure: no fetch, no Supabase, no React, no DOM, and it never throws — same
// obligation as knowledgeBase.js, whose caller is a live interview draft loop
// that cannot afford a thrown error to become a broken answer.

import stopwords from "@/lib/llm/engines/tailor-lite/data/stopwords.json";

// Term-frequency saturation and length-normalisation strength. Textbook BM25
// defaults, not fitted to these fixtures — a 5x5 sweep of k1 in
// {0.5, 0.9, 1.2, 1.6, 2.0} and b in {0, 0.25, 0.5, 0.75, 1.0} passes every
// case in rankingQuality.test.js at all 25 combinations, so the rule does not
// depend on having picked these two numbers exactly within THIS file's own
// fixtures. That freedom does not extend repo-wide: B = 0 (length
// normalisation off) turns knowledgeBase.test.js's "STOPS at the first page
// it cannot fit" case (a recorded mutation SURVIVOR) red, the same way the
// character-vs-token length comment below names its own constraint. Do not
// read the sweep above as licence to retune B without re-running that case.
const K1 = 1.2;
const B = 0.75;

// A 2-character floor, not the 4-character floor lib/copilot/projectStories.js
// uses. That floor is what makes the ranker blind to the acronyms an
// interview question actually names: "aws", "sql" and "go" are 2-3
// characters, and a 4-character floor deletes all three, symmetrically, from
// both the question and every page — see rankingQuality.test.js's "acronyms"
// case, which is unsatisfiable at floor 4 and barely satisfiable at floor 3
// (margin collapses to a few hundredths at high k1/b). Floor 2 is what a
// two-page corpus needs to separate "target" from "decoy" with a comfortable
// margin at every (k1, b) in the sweep above. This tokenizer is intentionally
// NOT significantTerms — see this file's header — so it is named differently
// on purpose: calling it significantTerms here would satisfy
// significantTerms.shared.test.js's "no local copy" assertion by accident
// while actually being a second, drifted implementation of that name.
const RANKING_TOKEN_RE = /[a-z0-9]{2,}/g;

// The repo's own 169-word stopword list — the SAME one
// lib/copilot/projectStories.js:68 imports for its honesty-gate scaffolding
// and lib/copilot/resumeAnchor.js (:52-53) already filters question terms
// with, for exactly this purpose: distinguishing "words a question is made
// of" from "words a question is ABOUT". Without it, cases in
// rankingQuality.test.js fail at every (k1, b) pair tried — "time", "about",
// "what" and "situation" outweighing the page that actually answers the
// question, and "using" propping up a decoy that shares nothing else with
// the query.
const RANKING_STOPWORDS = new Set(stopwords);

function str(value) {
  return typeof value === "string" ? value : "";
}

function tokens(text) {
  return str(text).toLowerCase().match(RANKING_TOKEN_RE) || [];
}

// rankingQueryTerms(text) -> Set<string>. QUERY SIDE ONLY: a document term
// can only ever score if it is also a query term (see documentStats/score
// below), so filtering the document side too would be redundant, not wrong,
// and is left undone rather than added defensively.
//
// NO STEMMER, and this is load-bearing rather than an omission: three of the
// six cases in rankingQuality.test.js depend on "scaled" not matching
// "scale", "convince" not matching "Convinced", and "sharding" not matching
// "Sharded". The mechanism that actually matters here is narrower than "any
// stemmer" — measured: a naive trailing -ed/-ing/-s strip does NOT hand a
// decoy page back its term, the target still wins every (k1, b) combination
// in that file's sweep. What does is a Porter-class stemmer that also folds a
// silent "e" ("scale" -> "scal", matching "scaled" -> "scal"), which loses the
// case at the shipped settings and in most of that sweep (see that file's
// case 1 comment, which names this exact risk and the corrected mechanism).
export function rankingQueryTerms(text) {
  const terms = new Set();
  for (const token of tokens(text)) {
    if (!RANKING_STOPWORDS.has(token)) terms.add(token);
  }
  return terms;
}

// A page's term counts and length, walking title and body SEPARATELY rather
// than tokenising `${title} ${body}`. That concatenation is the exact defect
// this file's sibling (knowledgeBase.js's now-deleted pageOverlapScore) used
// to record having fixed: it allocates a copy of the whole page corpus per
// page purely to join two strings this loop was about to walk one after the
// other anyway.
//
// LENGTH IS MEASURED IN CHARACTERS, NOT TOKENS, and this is not cosmetic.
// knowledgeBase.test.js's "STOPS at the first page it cannot fit" case (a
// recorded mutation SURVIVOR) has an `unsplittable` fixture whose body is
// `kafka settlement latency ledger` plus an 800-character run of the letter
// "w" — one token, under a token-count length. Under token-count length that
// page looks SHORT and DENSE, outranks a shorter, more relevant page, is
// attempted first, cannot be excerpted (it is one unbroken block bigger than
// any per-page share), and packing stops having included nothing. Under
// character length it is what it actually is: a very long page. Character
// length is also independent of the tokenizer's own floor and stopword list,
// which is the more honest reading of "how much material is on this page" —
// two pages of equal prose should not score as different lengths merely
// because one repeats short words the other spells out in long ones.
function documentStats(page) {
  const counts = new Map();
  let length = 0;
  for (const field of [page?.title, page?.body]) {
    const text = str(field);
    length += text.length;
    for (const token of tokens(text)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return { counts, length };
}

// rankPagesByBm25(pagesInput, queryText) -> Page[]
//
// Okapi BM25, with document frequency (df) and average length (avgdl)
// computed over EXACTLY the array passed in — never a wider corpus of the
// user's other pages, and never cached across calls. rankPagesByRelevance
// (knowledgeBase.js) is called with an already-filtered `usable` list, and
// every fixture's arithmetic in rankingQuality.test.js assumes df is scoped
// to that call's own candidates; computing it over anything wider silently
// changes every case's numbers.
export function rankPagesByBm25(pagesInput, queryText) {
  const pages = Array.isArray(pagesInput) ? pagesInput : [];
  const terms = rankingQueryTerms(queryText);
  const docs = pages.map(documentStats);
  const avgLength = docs.length > 0 ? docs.reduce((sum, d) => sum + d.length, 0) / docs.length : 0;

  // Document-frequency weights, one per query term, computed once per call
  // rather than once per page. A term with df 0 (present in the query but on
  // no candidate page) is left out of `weights` entirely, so a page with none
  // of the query's terms scores exactly 0 and can never be pushed below such
  // a page by a smoothing artefact.
  //
  // THE IDF MUST BE THE SMOOTHED FORM: ln(1 + (N - df + 0.5) / (df + 0.5)),
  // not the classic ln((N - df + 0.5) / (df + 0.5)). The classic form goes
  // NEGATIVE whenever a term appears on more than half the candidate pages —
  // rankingQuality.test.js's "length" case has both pages sharing "ledger"
  // and "sharding" (df 2 of 2), which sends the unsmoothed weight to
  // ln(0.5/2.5) = -1.609 and makes matching the term LOWER a page's score,
  // inverting the expected winner. The "+ 1" guarantees every weight stays
  // strictly positive so containing a query term is never a penalty.
  //
  // DROPPING THIS MAP ENTIRELY (the tempting reading of
  // lib/copilot/projectStories.js's "the document-frequency map that used to
  // be here is gone" comment) is a mistake made about a different function:
  // that comment is about clearsHonestyGate, a yes/no gate deciding whether
  // the app may claim a page as the user's own experience, where "every page
  // mentions Kafka" must not mean "you have nothing to say about Kafka". Here
  // the question is ORDERING, not gating, and rankingQuality.test.js's "rare
  // term" case is unsatisfiable without df weighting: four of five pages say
  // "ledger" and "built", only one says "reconciliation", and only up-
  // weighting the rare term lets the page that actually answers the question
  // win.
  const weights = new Map();
  for (const term of terms) {
    let df = 0;
    for (const doc of docs) {
      if (doc.counts.has(term)) df += 1;
    }
    if (df > 0) {
      weights.set(term, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)));
    }
  }

  function score(doc) {
    if (weights.size === 0) return 0;
    // avgLength === 0 only when every candidate's title and body are both
    // empty (docs.length > 0 but every length is 0, e.g.
    // knowledgeBase.test.js's [null, undefined, {}] fixture) — which also
    // means every doc's term counts are empty, so `weights` above is empty
    // too and the `weights.size === 0` check just above already returns 0
    // before this line ever runs. As shipped, THIS GUARD IS UNREACHABLE ON
    // ITS OWN: deleting it leaves the whole suite green. It is load-bearing
    // only as a PAIR with that early return, not by itself — remove the
    // early return and this guard is what then stops `ratio` from becoming
    // 0/0 = NaN (and every score, then the comparator below, from going NaN,
    // leaving Array.prototype.sort's order engine-defined rather than
    // stable). Do not delete one as "redundant" without checking the other;
    // they must be removed together or not at all.
    const ratio = avgLength > 0 ? doc.length / avgLength : 1;
    const norm = K1 * (1 - B + B * ratio);
    let total = 0;
    for (const [term, weight] of weights) {
      const tf = doc.counts.get(term) || 0;
      if (tf === 0) continue;
      total += (weight * tf * (K1 + 1)) / (tf + norm);
    }
    return total;
  }

  return pages
    .map((page, index) => ({
      page,
      score: score(docs[index]),
      position: typeof page?.position === "number" ? page.position : index,
    }))
    // Score descending, ties broken on `position` ascending — unchanged from
    // the rule this replaces, and load-bearing on its own: an empty query
    // produces an empty term set, `weights` stays empty, every page scores
    // literal 0 before any arithmetic runs, and the comparator collapses to
    // `position - position` — a stable sort by position, which is exactly
    // the byte-identity guarantee every no-query caller depends on
    // (AC-1.4). There is deliberately no early `return pages` for an empty
    // query: that would skip this sort entirely, and a caller whose array
    // isn't already position-ordered would see its pages silently
    // reordered by this change where they weren't before.
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map((entry) => entry.page);
}
