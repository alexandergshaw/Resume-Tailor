// Whether an item is blocked from being picked by backlog:next.
//
// The rule is deliberately conservative and deliberately ignores whether a listed blocker id still
// exists in `items`: a NON-EMPTY `blocked_by` always blocks. This repo's own rule for this file is
// "closed items are deleted, not archived" (docs/BACKLOG.md's "No diary" rule) — so once a blocking
// item closes, its id simply vanishes from `items`. A check of the shape "blocked unless the id is
// missing" cannot tell that vanish-because-resolved apart from vanish-because-of-a-typo, and guessing
// wrong in the unblocking direction is a silent false pickable — exactly the failure mode this
// tooling exists to prevent. So resolving a blocker is always an explicit edit that removes its id
// from `blocked_by`; it is never inferred from the id's disappearance.
export function isBlocked(item) {
  return Array.isArray(item.blocked_by) && item.blocked_by.length > 0;
}
