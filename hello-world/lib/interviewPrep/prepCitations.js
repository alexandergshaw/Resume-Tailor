// N43: pure citation-resolution logic shared by every citable surface in
// PrepPackPanel.js (facts, questions, stages) -- one implementation of the
// five-state model, not three. See <scratchpad>/chunks/N43/
// design-experience.r1.md ss0 for the full contract this assumes.
//
// AC-N43.9: this file imports NEITHER prepParse.js NOR prepStore.js NOR
// prepPack.js, directly or transitively, so the 1.26MB given-name lexicon
// those files carry at module scope never reaches a client bundle through
// this path. Every `support` the GET route returns has already passed
// `isCitedClaim` at read time (a non-empty, non-redirect `sourceUrl`), so
// this file needs only an id lookup in `pack.claims` plus `safeExternalHref`'s
// own, independent well-formedness check -- which is a real, separate gap:
// `isCitedClaim` never calls `new URL()`.

import { safeExternalHref } from "@/lib/url/safeExternalHref";

/**
 * Resolves one `support` against a pack's `claims`. Every citable surface
 * (an aboutYou/whyRole line, an askThem question, a stage) calls this once
 * for its own `support`, so the state model has exactly one implementation.
 *
 * @returns {{state: "none"}|{state: "cited", claim: object, href: string}|{state: "unsafe", claim: object}}
 */
export function resolveSupport(support, claims) {
  if (!support || support.kind !== "claim" || !support.claimId) return { state: "none" };
  const list = Array.isArray(claims) ? claims : [];
  const claim = list.find((entry) => entry && entry.id === support.claimId);
  if (!claim) return { state: "none" };
  const href = safeExternalHref(claim.sourceUrl);
  return href ? { state: "cited", claim, href } : { state: "unsafe", claim };
}

/**
 * Assigns per-section citation numbers to a list of already-resolved
 * supports, in first-appearance order, deduped by claim id (AC-N43.10:
 * numbering restarts at 1 in every section and never leaks across them).
 *
 * @param {Array<{state: string, claim?: object, href?: string}>} resolvedList
 * @returns {{numbers: Array<number|null>, entries: Array<{n: number, claim: object, href: string|null}>}}
 */
export function numberResolved(resolvedList) {
  const numberByClaimId = new Map();
  const entries = [];
  const numbers = resolvedList.map((resolved) => {
    if (resolved.state === "none") return null;
    const claimId = resolved.claim.id;
    let n = numberByClaimId.get(claimId);
    if (n === undefined) {
      n = numberByClaimId.size + 1;
      numberByClaimId.set(claimId, n);
      entries.push({ n, claim: resolved.claim, href: resolved.state === "cited" ? resolved.href : null });
    }
    return n;
  });
  return { numbers, entries };
}

/** A claim counts as "arrived" (AC-N43.5) only if it carries a non-empty
 *  `sourceUrl` -- a claim with none could never have become a citation, so
 *  there is nothing about it to disclose. Pinned against
 *  PrepPackPanel.sectionHeaders.test.js's landed byte-identity fixture,
 *  which carries a claim with no `sourceUrl` and must not move the panel. */
function hasSourceUrl(claim) {
  return !!claim && typeof claim.sourceUrl === "string" && claim.sourceUrl.trim() !== "";
}

/**
 * AC-N43.5: the pack-wide "arrived, not placed" disclosure. `supports` is
 * every `support` field found anywhere in the pack's four sections, in any
 * order -- this only needs which claim ids were referenced, never where.
 * "Referenced" counts a cited-but-unsafe-URL support too (design-
 * experience.r1.md ss2a): that claim's link doesn't work, which is its own,
 * separately-disclosed problem, but it was still structurally placed.
 *
 * @returns {null|"empty"|"partial"} null when nothing needs disclosing.
 */
export function sourcedOrphanVariant(claims, supports) {
  const sourced = (Array.isArray(claims) ? claims : []).filter(hasSourceUrl);
  if (sourced.length === 0) return null;
  const referenced = new Set();
  for (const support of Array.isArray(supports) ? supports : []) {
    if (support && support.kind === "claim" && support.claimId) referenced.add(support.claimId);
  }
  const resolvedCount = sourced.filter((claim) => referenced.has(claim.id)).length;
  if (resolvedCount >= sourced.length) return null;
  return resolvedCount === 0 ? "empty" : "partial";
}
