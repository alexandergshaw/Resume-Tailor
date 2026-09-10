### R-190 | area: experience-tree-keyboard | parallel-safe: yes | automatable: yes

**Summary:** The Professional Experience page tree implements the W3C APG tree view keyboard pattern, and the component actually dispatches what the pure model decides.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/treeNav.test.js app/components/experience/PageTree.test.js`.

**Expected:** All tests pass. The decisions live in `lib/experience/treeNav.js` and are asserted without a DOM; `PageTree.test.js` asserts the WIRING, which neither pure test can see - two individually-correct halves joined wrong is a defect this codebase has shipped before.

Load-bearing specifics, each of which was a surviving mutant in an earlier draft:

- `nextFocus` returns all five fields every time (`focusId`, `expand`, `collapse`, `activate`, `handled`). Asserting `focusId` alone let eight defects through, including ArrowDown quietly expanding every collapsed node it passed - a keyboard user unfolding the tree behind themselves.
- `handled: false` for keys the tree does not own. A tree that calls `preventDefault` on Tab is a keyboard trap; `defaultPrevented` is the ONLY way to see the difference in jsdom, and the event must be created with `cancelable: true` or `preventDefault` is a silent no-op and the test passes against anything.
- Space activates and never reaches type-ahead. The fixture deliberately contains a title starting with a space and one starting with "Shift" so the "these keys are not type-ahead" test can actually fail.
- Type-ahead matches a PREFIX of the visible TITLE, searching forward from the current node. The fixture's ids and titles are deliberately different strings; an earlier draft used `title: id.toUpperCase()` and could not tell the two fields apart.
- `aria-expanded` on parents only - never on a leaf, where it would announce a collapsed parent that never opens - and exactly ONE node at `tabindex="0"`.
- All four row actions (add sub-page, rename, delete, move) are in the tab order for the row holding the roving tabindex, and only that row. Re-parenting was pointer-only when first shipped; three more actions were found the same way by the accessibility pass afterwards.

