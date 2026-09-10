### R-196 | area: experience-bulk | parallel-safe: yes | automatable: yes

**Summary:** Selecting several project pages counts their blast radius once, and a bulk action acts on selection roots rather than every ticked row.

**Steps:**
1. From `hello-world`, run `npx vitest run lib/experience/bulkSelection.test.js app/components/experience/BulkActionsBar.test.js app/components/experience/ExperienceTab.test.js`.

**Expected:** All pass, including:

- Selecting a page AND one of its children reports the deduplicated total. A naive sum says six pages will be deleted from a tree that loses four; over-stating trains the user to ignore the number, under-stating loses their work. A disjoint pair is asserted separately so the dedup cannot hide as a blanket under-count.
- Execution filters to selection ROOTS, so a selected parent and child fire ONE request. Otherwise the second DELETE 404s after the cascade, or a move flattens a child out from under a parent that is still moving.
- `bulkMoveTargets` is the intersection across every selected page - a destination legal for one and illegal for another is excluded - and legitimately returns empty, which disables the action WITH an explanation rather than hiding it.
- Selecting a parent never implicitly selects its children.

