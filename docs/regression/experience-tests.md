### R-242 | area: experience-tests | parallel-safe: yes | automatable: yes

**Summary:** The ExperienceTab suite is split across two files sharing one fixture module, and it still detects exactly what it detected before.

**Steps:**
1. From `hello-world`, run `npx vitest run app/components/experience/ExperienceTab --no-file-parallelism`.
2. Confirm `app/components/experience/ExperienceTab.test.js` (the tab shell), `ExperienceTab.askAi.test.js` (the Ask AI wiring) and `experienceTabTestHarness.js` (shared fixtures, not itself a test file) all exist, and that all three are under 1000 lines.
3. Confirm `npm run build` still succeeds — the harness imports `vitest`, and it must never become reachable from application code.

**Expected:** 28 tests pass across the three ExperienceTab files, and the build is clean.

**`ExperienceTab.test.js` was 1096 lines, over this repo's 1000-line ceiling.** It is now 721 + 300 + 173.

**The fixtures were EXTRACTED, not copied, and that was the whole constraint.** `ATTACHMENTS`, `PAGE_ROOT`, `mockFetchWithAttachments`, `flush`, `click`, `jsonResponse` and the rest are shared through `experienceTabTestHarness.js`. Copying them into a sibling would have created two fixture sets obliged to agree forever — the "two halves tested against different assumptions" failure this repo has already suffered, where a producer's tests asserted the row it produced and the consumer's used a hand-written fixture that had a field the producer omitted.

**`vi.mock` factories and `vi.hoisted` cannot move, so only the mock BODIES did.** The `vi.mock` CALLS stay in each test file (they are hoisted above imports); each one delegates to `pageEditorMockModule()` / `attachmentPanelMockModule()` in the harness, so the mock components have exactly one definition.

**Two helpers close over per-file state and are exported as FACTORIES for it.** `container` and `root` are reassigned in each file's own `beforeEach`, so `domHelpers(getContainer)` and `makeRender(getRoot, Component)` take GETTERS, never the values. Each file binds its own copies, which is what let every call site stay byte-identical:

```js
const { buttons, liveRegion } = domHelpers(() => container);
const render = makeRender(() => root, ExperienceTab);
```

Pass the value instead of a getter and every test silently queries the first render's detached container.

**Only the Ask AI file carries the Supabase mocks.** The hoisted `downloadMock`, the `lib/supabase/client` mock and the `experienceAttachments` spy moved with the tests that need them; no test left in the shell file goes near that path.

**A test-file refactor is exactly the change that can leave a suite green and permanently unable to fail, so this one was gated by a frozen ORACLE rather than by a passing run.** Before any edit, seven deliberate mutations to `ExperienceTab.js` were applied one at a time and the exact set of test NAMES each one killed was recorded to disk. After the split the same mutations were replayed and the same names had to die. Counting tests afterwards proves nothing — the same 22 names can all pass while gating nothing at all, which is what a dropped `vi.mock`, a helper closing over a stale container, or a diverged fixture would produce. The oracle covered both halves: Ask AI (video-bytes forwarded, shared store function bypassed, breadcrumbs blanked) and the shell (bulk actions per-id instead of per-root, delete not picking a next focus row, create and rename announcing nothing).

**A second, independent check proved the tests moved VERBATIM**: every `expect(` line and every `it`/`describe` name was extracted from the pre-split file and from the two post-split files, sorted, and compared as sets — 111 assertions and 35 names, none lost, none added. Relocation is invisible to that comparison; an edit is not.

**The oracle also exposed two PRE-EXISTING coverage gaps, neither caused by the split.** Both are recorded rather than fixed here, because adding tests during a split would have changed the very test set the oracle compares:
- **The bulk move's "expand the destination" is untested.** Disabling `if (destinationId) setExpandedIds(...)` in the BULK move handler kills nothing. The describe named "a move into a collapsed parent expands it and focuses the moved row" covers the SINGLE-page move, which is a different call site.
- **The announcement sequence bump is untested.** Freezing `seq` in `announce` kills nothing, including the test named "re-announces the count even when it repeats non-consecutively (3 -> 2 -> 3)" — because a non-consecutive repeat changes the TEXT between announcements anyway, so a DOM mutation happens regardless. The `seq` mechanism only matters for two CONSECUTIVE IDENTICAL messages ("Selection cleared" twice), and nothing exercises that.

**The harness lives under `app/` and imports `vitest`.** It is unreferenced by application code, so Next never traces it and the build is clean — but an accidental import from a component would break the build, which is why step 3 exists.
