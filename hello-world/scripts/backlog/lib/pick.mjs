import { compareIds } from "./idOrder.mjs";
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
 *   { type: "escalate", item }               - no actionable work is pickable; the oldest owner
 *                                              decision (or, if none, verification-owed item) is
 *                                              surfaced instead
 *   { type: "empty" }                        - truly nothing left in any section
 *
 * `owns`/`verify` are required non-null (B2/B8) at the moment an item is read here — never at the
 * moment it was written to backlog.yml, matching this file's "record at disposal" rule: a finding
 * can sit unscoped for many rounds before anyone designs its fix.
 */
export function pick(items) {
  const actionable = items.filter((it) => it.state === "actionable");

  const scopedEligible = actionable
    .filter((it) => it.owns != null && it.verify != null && !isBlocked(it))
    .sort((a, b) => compareIds(a.id, b.id));

  if (scopedEligible.length > 0) {
    return { type: "actionable", item: scopedEligible[0] };
  }

  const unscoped = actionable
    .filter((it) => it.owns == null || it.verify == null)
    .sort((a, b) => compareIds(a.id, b.id));

  if (unscoped.length > 0) {
    return { type: "unscoped", count: unscoped.length, ids: unscoped.map((it) => it.id) };
  }

  // Nothing actionable at all (every actionable item is either fully scoped-and-blocked, or the
  // section is empty). Owner decisions surface before verification-owed items, matching
  // docs/BACKLOG.md's own section order.
  const owner = items.filter((it) => it.state === "owner").sort((a, b) => compareIds(a.id, b.id));
  const verification = items
    .filter((it) => it.state === "verification")
    .sort((a, b) => compareIds(a.id, b.id));
  const escalatable = [...owner, ...verification];

  if (escalatable.length > 0) {
    return { type: "escalate", item: escalatable[0] };
  }

  return { type: "empty" };
}
