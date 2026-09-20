// Deterministic ordering for backlog item ids. Namespaced ids (B3: N1..N12, D1..D2, V1) are a
// letter prefix plus a decimal number — sort by prefix, then by the NUMBER, never lexically, or
// "N10" sorts before "N2".
//
// AS OF R-BL-1 (backlog N31): this comparator has NO production caller. `pick.mjs`,
// `renderMarkdown.mjs` and `lib/wave.mjs` used to sort backlog items by id via this function at 8
// call sites, discarding the owner's hand-set priority order in docs/backlog.yml — that defect is
// what R-BL-1 fixed, by making every one of those consumers preserve the file's own array order
// instead. This module is kept, not deleted: `pick.test.js` and `renderMarkdown.test.js` still use
// it as a deterministic, id-agnostic way to select "some existing item" from the real
// docs/backlog.yml when building a mutation target, and a correct numeric-vs-lexical id comparator
// is a small, independently useful, already-tested primitive (e.g. for a future monotonic-id-mint
// check) that this chunk deliberately does not speculatively remove. See
// <scratchpad>/chunks/BL-ORDER/ledger.md for the ruling this comment records.

const NAMESPACED = /^([A-Za-z]+)(\d+)$/;

/** Comparator for Array.prototype.sort — ascending id order. */
export function compareIds(a, b) {
  const ma = a.match(NAMESPACED);
  const mb = b.match(NAMESPACED);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
    return Number(ma[2]) - Number(mb[2]);
  }
  // Not both namespaced (an id this repo has not seen yet) — fall back to plain string order
  // rather than throwing, so an unexpected id is still handled deterministically.
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
