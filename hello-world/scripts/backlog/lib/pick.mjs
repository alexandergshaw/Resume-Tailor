import { isBlocked } from "./blocked.mjs";

/**
 * Deterministic single-item selection over parsed backlog.yml items. No model judgement anywhere
 * in this function — every branch is a mechanical predicate over the data.
 *
 * Returns one of:
 *   { type: "actionable", item }            - a fully scoped, unblocked item to work next
 *   { type: "unscoped", count, ids }         - actionable items exist but none are scoped
 *                                              (owns/verify still null) — NOT the same as "empty".
 *                                              This is the fix for a naive selector that would
 *                                              report "nothing owed" over a backlog full of
 *                                              real, undone work: an item without owns/verify is
 *                                              surfaced, never silently dropped.
 *   { type: "escalate", item }               - no actionable work is pickable; the FIRST owner
 *                                              decision in the file's own order (or, if none, the
 *                                              first verification-owed item in file order) is
 *                                              surfaced instead. This is PRIORITY order, the same
 *                                              rule as the two branches above it — never age, and
 *                                              never re-sorted by id (R-BL-1, backlog N31: an
 *                                              earlier round's "oldest owner decision" framing
 *                                              here was itself the stale comment this correction
 *                                              exists to fix — see
 *                                              docs/backlog.yml's ORDERING RULE header note).
 *   { type: "empty" }                        - truly nothing left in any section
 *
 * `owns`/`verify` are required non-null (B2/B8) at the moment an item is read here — never at the
 * moment it was written to backlog.yml, matching this file's "record at disposal" rule: a finding
 * can sit unscoped for many rounds before anyone designs its fix.
 *
 * ORDERING: every selection below is `.filter(...)` ONLY — never `.sort(...)`. The array order
 * `parseBacklogYaml` hands back IS the owner's hand-set priority (docs/backlog.yml's header, and
 * R-BL-1). Re-adding a sort here reproduces backlog N31 with every OTHER test in this file green;
 * see orderClassGuard.test.js for the regression sweep guarding against exactly that.
 */
export function pick(items) {
  const actionable = items.filter((it) => it.state === "actionable");

  const scopedEligible = actionable.filter((it) => it.owns != null && it.verify != null && !isBlocked(it));

  if (scopedEligible.length > 0) {
    return { type: "actionable", item: scopedEligible[0] };
  }

  const unscoped = actionable.filter((it) => it.owns == null || it.verify == null);

  if (unscoped.length > 0) {
    return { type: "unscoped", count: unscoped.length, ids: unscoped.map((it) => it.id) };
  }

  // Nothing actionable at all (every actionable item is either fully scoped-and-blocked, or the
  // section is empty). Owner decisions surface before verification-owed items, matching
  // docs/BACKLOG.md's own section order.
  const owner = items.filter((it) => it.state === "owner");
  const verification = items.filter((it) => it.state === "verification");
  const escalatable = [...owner, ...verification];

  if (escalatable.length > 0) {
    return { type: "escalate", item: escalatable[0] };
  }

  return { type: "empty" };
}
