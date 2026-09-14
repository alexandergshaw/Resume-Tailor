// Deterministic ordering for backlog item ids. Namespaced ids (B3: N1..N12, D1..D2, V1) are a
// letter prefix plus a decimal number — sort by prefix, then by the NUMBER, never lexically, or
// "N10" sorts before "N2".

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
