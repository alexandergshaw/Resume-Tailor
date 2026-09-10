### R-187 | area: experience-tree | parallel-safe: yes | automatable: yes

**Summary:** The Professional Experience page tree orders siblings deterministically, never loses a page to a broken parent link, and produces minimal move updates.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/tree.test.js`.

**Expected:** 27 tests pass. Six of them exist because a peer audit mutated a reference implementation 29 ways against an earlier draft of this file and those six defects survived; they are marked `[S1]`..`[S6]` in the source and must not be weakened:

- `[S1]` a tree node carries the WHOLE row, not `{id, children}`. The tab and the editor render `title` and `body` straight off these nodes, and an implementation that dropped them passed every other assertion.
- `[S2]` a tied `position` falls through to `created_at` BEFORE `id`. The fixture's ids sort opposite to its timestamps, so skipping `created_at` gives the wrong answer rather than accidentally the right one.
- `[S3]` `collectDescendantIds` is depth-first. The fixture's deep branch is deliberately not the last branch, so breadth-first returns a different sequence.
- `[S4]` `moveNode` is minimal on the DESTINATION side as well as the vacated side. Applying the update set makes a redundant update indistinguishable from no update, so this is asserted on the raw set and cannot be checked through the apply helper.
- `[S5]` `canMove`'s reason codes have a precedence order (`unknown-page`, `self-parent`, `unknown-parent`, `cycle`); the route puts the code in front of the user in a 400.
- `[S6]` no page ever disappears. A row whose parent is absent, is itself, or sits in a loop is promoted to a root. The ids in the tree are exactly the ids in the input, each once.

Also pinned: a row with no `created_at` still sorts deterministically. `Date.parse(undefined)` is `NaN`, `NaN !== NaN` is true, and the resulting `NaN` comparator result is coerced to `0` by the sort spec, silently skipping the `id` tiebreaker. The column is `not null` in the database, so this only arises for a page created optimistically on the client before its insert returns, which is exactly when the user is watching it appear.

