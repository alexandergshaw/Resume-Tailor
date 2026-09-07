// The knowledge-page scope summary's own retrieval-shape module: which pages
// belong to a scope, in what order, whether each one made it into the model's
// context and why, and how a model's claimed citations resolve against the
// exact list it was actually shown.
//
// Pure: no fetch, no Supabase, no React, no DOM. Imports only
// lib/experience/tree.js, lib/experience/knowledgeBase.js,
// lib/experience/tailorSources.js and lib/tracking/stageCounts.js — the plan's
// own import fence for this file (3-plan-knowledge.md, Wave 3a). Every
// exported function treats its input as possibly missing or malformed and
// never throws, EXCEPT `isScopePageEligible`, whose ability to throw on a
// malformed page is load-bearing — see that function's own comment.
//
// WHY THIS DOES NOT RE-IMPLEMENT ELIGIBILITY, USABILITY OR MATERIAL CHECKS.
// `hasUsableId` and `contributesMaterial` are imported from knowledgeBase.js,
// which now exports them for exactly this reason: `classifyScopePages` below
// has to tell a user WHICH of their pages were left out of a summary, and by
// what rule, and the only way to guarantee that answer agrees with what the
// model was actually shown is to classify with the SAME function objects the
// builder filters with, never a restatement of them (knowledgeBase.js:488-506,
// re-read). `isGeneratedPage` is imported from tailorSources.js for the same
// reason, one level down: it already keys on the `generated_kind` COLUMN being
// set, never on a specific value, so a future generator is excluded
// automatically rather than leaking through until someone remembers to update
// a second copy of the rule.

import { collectDescendantIds, buildTree } from "./tree.js";
import { hasUsableId, contributesMaterial } from "./knowledgeBase.js";
import { isGeneratedPage } from "./tailorSources.js";
import { transitionsFor, stageAnomaly, stageViolation } from "@/lib/tracking/stageCounts.js";

// The nil UUID, used as the `scope_key` generated column's value for the
// whole-knowledge-base scope (scope_page_id IS NULL). Cannot collide with a
// real page id: `experience_pages.id` is `default gen_random_uuid()` (v4,
// which always sets the version and variant bits), and the nil UUID is not a
// valid v4 value.
export const SCOPE_SENTINEL = "00000000-0000-0000-0000-000000000000";

// scopeKeyFor(scopePageId) -> string.
//
// The same vocabulary the database's generated column uses, computed
// client-side so a caller can look up a cached row without a round trip.
export function scopeKeyFor(scopePageId) {
  if (typeof scopePageId !== "string") return SCOPE_SENTINEL;
  const trimmed = scopePageId.trim();
  return trimmed === "" ? SCOPE_SENTINEL : trimmed;
}

// Rebuilds `pages` (as returned by buildTree, itself cycle-safe) back into a
// flat pre-order list: each node, then its children recursively, left to
// right. buildTree already resolves sibling order (position, then
// created_at, then id) and promotes an orphaned or cyclic row to a root
// rather than dropping it — see tree.js's own header — so this function does
// no ordering work of its own; it only flattens the shape buildTree already
// computed.
function flattenPreOrder(nodes, out) {
  for (const node of nodes) {
    out.push(node.id);
    if (Array.isArray(node.children) && node.children.length > 0) {
      flattenPreOrder(node.children, out);
    }
  }
}

// orderPagesPreOrder(pages, rootId) -> Page[].
//
// EXISTS BECAUSE AC-4.10 IS REFUTED. `position` is SIBLING rank (0..n-1 per
// parent), never a global ordinal — 20260812000000_experience_pages.sql's own
// definition — so a stable sort that merely preserves whatever order the
// pages arrived in (the empty-query BM25 fallback, or a flat
// `.order("position")` query) is NOT tree order: 1d measured 6 of 9 pages at
// a different index on a 3-level tree, and the criterion's own checkable test
// — "the ranked order equals the INPUT order" — passes anyway, because input
// order is not tree order either. This is the one function that makes "the
// summary takes pages in tree order" actually true, by producing genuine
// depth-first pre-order rather than relying on any caller's row ordering.
//
// `rootId === null` (or undefined) orders the WHOLE forest, root scope.
// Otherwise it is `[self, ...collectDescendantIds(pages, rootId)]`, in
// pre-order — collectDescendantIds (tree.js) already walks depth-first,
// cycle-safe, each id exactly once, so this is a lookup over its result
// rather than a second traversal engine.
export function orderPagesPreOrder(pagesInput, rootId) {
  const pages = Array.isArray(pagesInput) ? pagesInput : [];
  if (pages.length === 0) return [];
  const byId = new Map(pages.map((p) => [p?.id, p]));

  if (rootId === null || rootId === undefined) {
    const tree = buildTree(pages);
    const ids = [];
    flattenPreOrder(tree, ids);
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  if (!byId.has(rootId)) return [];
  const ids = [rootId, ...collectDescendantIds(pages, rootId)];
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// collectScopePages(pages, scopePageId) -> { scopePages, scopeExists }.
//
// scopePageId === null/undefined is the root scope (the whole base), which
// always "exists". A non-null scopePageId that is not present in `pages`
// produces scopeExists: false — the route 404s on that, because "that page is
// gone" must not render as "that page has nothing in it" (1h S-3).
export function collectScopePages(pagesInput, scopePageId) {
  const pages = Array.isArray(pagesInput) ? pagesInput : [];
  if (scopePageId === null || scopePageId === undefined) {
    return { scopePages: orderPagesPreOrder(pages, null), scopeExists: true };
  }
  const exists = pages.some((p) => p && p.id === scopePageId);
  if (!exists) return { scopePages: [], scopeExists: false };
  return { scopePages: orderPagesPreOrder(pages, scopePageId), scopeExists: true };
}

// The closed, frozen reason vocabulary a page in scope can carry. Five of
// these are AC-3.7's own ("included", "budget", "ineligible", "no-material",
// "no-id"); "eligibility-threw" is 1h's measured addition (S-5) — without it,
// a caller-supplied eligibility rule that throws on one malformed row is
// indistinguishable, in the closed vocabulary, from a row that was genuinely
// ineligible, which misreports a wiring bug as a normal exclusion.
export const KNOWLEDGE_REASONS = Object.freeze([
  "included",
  "budget",
  "ineligible",
  "eligibility-threw",
  "no-material",
  "no-id",
]);

// isScopePageEligible(page) -> boolean.
//
// Server-side-enforced eligibility for the scope summary/question pipeline,
// mirroring lib/copilot/projectStories.js's isEligiblePage one level over:
// archived pages and generated pages never contribute to a summary or an
// answer, no matter what a caller passes in.
//
// DELIBERATELY NOT DEFENSIVE ABOUT `page` ITSELF. `!page.archived_at` reads a
// property directly, with no optional chaining, so a hand-built malformed
// entry (null, undefined, or anything else that cannot carry a property)
// THROWS here rather than silently reading as eligible or ineligible.
// classifyScopePages below is the layer that catches that throw and records
// it as "eligibility-threw" — a caller wiring bug is a distinct, reportable
// state, not a normal ineligibility.
export function isScopePageEligible(page) {
  return !page.archived_at && !isGeneratedPage(page);
}

function isEligibleSafe(page) {
  try {
    return { threw: false, eligible: !!isScopePageEligible(page) };
  } catch {
    return { threw: true, eligible: false };
  }
}

function baseSourceFields(page) {
  return {
    id: page?.id ?? null,
    title: typeof page?.title === "string" ? page.title : "",
    updated_at: page?.updated_at ?? null,
    parent_id: page?.parent_id ?? null,
    position: typeof page?.position === "number" ? page.position : null,
  };
}

// classifyScopePages({ scopePages, includedPages }) -> { sourcePages, counts }.
//
// Walks `scopePages` ONCE, in order, deciding each page's reason with the
// SAME precedence buildKnowledgeBaseBlock uses internally (eligibility, then
// hasUsableId, then contributesMaterial, then whether the page actually
// landed in `includedPages`) — never a restatement of that order. A page that
// reaches ranking (eligible + usable id + material) gets a `rank`, the index
// among such pages IN SCOPE ORDER; every other page gets `rank: null`. This
// is exactly right for the summary path, whose query is empty and whose
// scopePages arrive pre-ordered (orderPagesPreOrder) — with no query, BM25
// scores every page 0 and its stable sort leaves that order untouched
// (knowledgeBase.js's own AC-1.4 comment), so `rank` here matches the real
// packing loop's own ranked order for that call.
//
// COUNT-FIRST: every page is classified even after a hand-built row throws —
// the loop never short-circuits, so `counts` always describes the WHOLE
// scope, not a truncated prefix of it.
export function classifyScopePages({ scopePages: scopePagesInput, includedPages: includedPagesInput }) {
  const scopePages = Array.isArray(scopePagesInput) ? scopePagesInput : [];
  const includedPages = Array.isArray(includedPagesInput) ? includedPagesInput : [];
  const includedById = new Map(includedPages.filter((p) => p && typeof p.id === "string").map((p) => [p.id, p]));

  const sourcePages = [];
  let pagesEligible = 0;
  let pagesWithMaterial = 0;
  let rankCounter = 0;

  for (const page of scopePages) {
    const base = baseSourceFields(page);
    const { threw, eligible } = isEligibleSafe(page);

    if (threw) {
      sourcePages.push({ ...base, included: false, reason: "eligibility-threw", rank: null, excerpted: false });
      continue;
    }
    if (!eligible) {
      sourcePages.push({ ...base, included: false, reason: "ineligible", rank: null, excerpted: false });
      continue;
    }
    pagesEligible += 1;

    if (!hasUsableId(page)) {
      sourcePages.push({ ...base, included: false, reason: "no-id", rank: null, excerpted: false });
      continue;
    }
    if (!contributesMaterial(page)) {
      sourcePages.push({ ...base, included: false, reason: "no-material", rank: null, excerpted: false });
      continue;
    }
    pagesWithMaterial += 1;
    const rank = rankCounter;
    rankCounter += 1;

    const includedEntry = includedById.get(page.id);
    if (includedEntry) {
      sourcePages.push({ ...base, included: true, reason: "included", rank, excerpted: !!includedEntry.excerpted });
    } else {
      sourcePages.push({ ...base, included: false, reason: "budget", rank, excerpted: false });
    }
  }

  const pagesIncluded = sourcePages.reduce((sum, p) => sum + (p.included ? 1 : 0), 0);

  return {
    sourcePages,
    counts: {
      pagesInScope: scopePages.length,
      pagesEligible,
      // Ranking never DROPS a page — it only reorders the usable set — so
      // pagesRanked is always identical to pagesWithMaterial. It is its own
      // named stage anyway because AC-4.6's chain names it as one, and a
      // future ranking step that DOES filter (an over-budget page count cap,
      // explicitly ruled out for now — plan §6 item 7) would then have
      // somewhere to record the difference without renaming the chain.
      pagesWithMaterial,
      pagesRanked: pagesWithMaterial,
      pagesIncluded,
    },
  };
}

// The two narrowing chains this feature's retrieval_outcome record carries.
// Deliberately TWO, not one (§7 C13): `citationsClaimed <= pagesIncluded` is
// NOT an invariant (a model can claim more ids than it was shown), so
// splicing the citation chain onto the retrieval chain would manufacture a
// countsViolation on exactly the input — a hallucinated citation — the record
// exists to expose. The retrieval chain begins at `pagesFetched`, a count
// this module never itself produces (it is Wave 4's independent head-count
// read), so a truncated read cannot produce an internally consistent record
// that describes the wrong knowledge base.
export const KNOWLEDGE_RETRIEVAL_STAGES = Object.freeze([
  "pagesFetched",
  "pagesInScope",
  "pagesEligible",
  "pagesWithMaterial",
  "pagesRanked",
  "pagesIncluded",
]);
export const KNOWLEDGE_CITATION_STAGES = Object.freeze(["citationsClaimed", "citationsResolved", "citationsRendered"]);

// resolveCitedPageIds(rawIds, includedPageIds) -> { citations, claimed, resolved, refused }.
//
// SEC-K8 / AC-5.9-5.11: a citation resolves ONLY by page id, ONLY against
// `includedPageIds` — the exact list `buildKnowledgeBaseBlock` returned for
// THIS generation's prompt. `source_pages`, the live `pages` array and the
// ranked list are never citation whitelists; they are disclosure and
// staleness inputs. No integer from model output is ever used as an array
// subscript, and the return value carries no title — a resolved citation is
// `{ pageId }` alone (§7 C3), and a refused one is `{ reason, count }` alone,
// NEVER `{ reason, value }`, because the id that failed to resolve is
// model-authored text and must never be stored or echoed back.
//
// An id from another scope, an id for a page excluded by the budget, and an
// id for a page recorded "ineligible" in source_pages (never sent to the
// model at all — the §S-4.2 construction: a page body could forge the
// context block's own page-boundary heading and read out a real, in-scope-
// LOOKING id) are ALL indistinguishable at this layer — none of them is in
// `includedPageIds` — and all three refuse under the same "not-in-scope"
// reason. That is deliberate: this function has no visibility into WHY an id
// is not in the whitelist, only that it is not, which is what "fails closed"
// means here.
export function resolveCitedPageIds(rawIdsInput, includedPageIdsInput) {
  const rawIds = Array.isArray(rawIdsInput) ? rawIdsInput : [];
  const whitelist = new Set(Array.isArray(includedPageIdsInput) ? includedPageIdsInput : []);
  const claimed = rawIds.length;

  const seen = new Set();
  const citations = [];
  const refusedCounts = new Map();
  const refuse = (reason) => refusedCounts.set(reason, (refusedCounts.get(reason) || 0) + 1);

  for (const entry of rawIds) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!id) {
      refuse("not-a-string");
      continue;
    }
    if (seen.has(id)) {
      refuse("duplicate");
      continue;
    }
    if (!whitelist.has(id)) {
      refuse("not-in-scope");
      continue;
    }
    seen.add(id);
    citations.push({ pageId: id });
  }

  const refused = [...refusedCounts.entries()].map(([reason, count]) => ({ reason, count }));
  return { citations, claimed, resolved: citations.length, refused };
}

// buildRetrievalOutcome({ counts, citationCounts, model, refused, truncatedRead })
//   -> the full `retrieval_outcome` jsonb record.
//
// THREE RECORDS, NOT ONE (§7 C13): the retrieval chain's own countsViolation
// and anomaly, the citation chain's own — nested under `citations` — and the
// top-level fields (`model`, `refused`, `truncatedRead`) that belong to
// neither chain. `counts` and `citationCounts` are never merged into one
// object before being checked; each is checked against its OWN stage list, so
// a model over-claiming citations can never manufacture a violation in the
// retrieval chain it had nothing to do with.
export function buildRetrievalOutcome({ counts, citationCounts, model, refused, truncatedRead } = {}) {
  const retrievalCounts = counts && typeof counts === "object" && !Array.isArray(counts) ? counts : {};
  const citCounts =
    citationCounts && typeof citationCounts === "object" && !Array.isArray(citationCounts) ? citationCounts : {};

  return {
    version: 1,
    counts: retrievalCounts,
    countsViolation: stageViolation(retrievalCounts, KNOWLEDGE_RETRIEVAL_STAGES),
    anomaly: stageAnomaly(retrievalCounts, transitionsFor(KNOWLEDGE_RETRIEVAL_STAGES)),
    citations: {
      counts: citCounts,
      countsViolation: stageViolation(citCounts, KNOWLEDGE_CITATION_STAGES),
      anomaly: stageAnomaly(citCounts, transitionsFor(KNOWLEDGE_CITATION_STAGES)),
    },
    model: model && typeof model === "object" && !Array.isArray(model) ? model : {},
    refused: Array.isArray(refused) ? refused : [],
    truncatedRead: !!truncatedRead,
  };
}
