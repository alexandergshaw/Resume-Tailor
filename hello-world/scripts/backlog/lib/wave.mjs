import { isBlocked } from "./blocked.mjs";
import { matchOwns } from "./miniglob.mjs";

export const WAVE_CAP = 3;

// Always emitted, in every result this function returns, including a zero- or one-accepted wave —
// asserted directly against the returned VALUE in wave.test.js (never against this file's source
// text: a string that merely exists somewhere in the module proves nothing about what a caller
// actually receives). `backlog:wave` proves exact-path FILE disjointness only; it cannot compute
// whether two items design against the same fact, so it never claims to.
export const DISJOINTNESS_DISCLAIMER =
  "File-disjoint per exact-path intersection. NOT checked: whether any pair establishes a fact " +
  "the other designs against — verify that by hand before dispatching.";

/**
 * Greedy, deterministic wave selection. Walks actionable, scoped (owns+verify non-null), unblocked
 * items in FILE order — docs/backlog.yml's own array order, the owner's hand-set priority (R-BL-1,
 * backlog N31; never re-sorted by id, since the cap below would otherwise silently drop the
 * higher-priority item rather than merely misdisplay it); expands each candidate's `owns` globs
 * against the REAL file list (`allFiles`, from listAllFiles — a filesystem read, not a string
 * guess); accepts a candidate only if its expanded file set does not intersect, BY EXACT PATH, any
 * already-accepted candidate's set. Stops at WAVE_CAP accepted items.
 *
 * Items with `owns == null` (unscoped — see pick.mjs) are never wave candidates: a null `owns` has
 * no files to intersect, and treating it as trivially disjoint would silently parallelize work
 * nobody has scoped yet.
 */
export function computeWave(items, allFiles, { cap = WAVE_CAP } = {}) {
  const candidates = items.filter(
    (it) => it.state === "actionable" && it.owns != null && it.verify != null && !isBlocked(it),
  );

  const accepted = [];
  const skipped = [];
  const acceptedFiles = new Set();

  for (const candidate of candidates) {
    if (accepted.length >= cap) break;
    const expanded = matchOwns(candidate.owns, allFiles);
    const intersects = expanded.some((f) => acceptedFiles.has(f));
    if (intersects) {
      skipped.push({ id: candidate.id, reason: "exact-path intersection with an accepted item" });
      continue;
    }
    accepted.push({ id: candidate.id, files: expanded });
    for (const f of expanded) acceptedFiles.add(f);
  }

  return { accepted, skipped, note: DISJOINTNESS_DISCLAIMER };
}
