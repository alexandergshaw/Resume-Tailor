# N68 latency — L4 acceptance tests (seat 4b/TDD, round r1)

Seat: TDD (4b). Scope: **L4 only** — the preview opens without awaiting post-generation
persistence, plus the version-history reload that keeps. Inputs: AC-L4 (binds),
DS-4/DS-5/DS-6 (design), plan step 2 + risk rows. No production code written; no git writes.

Test file: `hello-world/app/hooks/useManualTailor.previewBeforePersist.test.js` (551 lines).
Reference implementation + mutation run in an isolated scratchpad copy
(`…/scratchpad/ref`, node_modules junctioned), never the working tree.

## Verdict

8 tests. **4 RED on HEAD** (the L4 behaviour), 4 GREEN guards/controls (disclosed below).
The reds are satisfiable — a reference implementation turns all 8 green and leaves 9
neighbouring suites green (133/133). One cross-suite collision found and reported (§4).

## The tests and their RED status (verbatim working-tree run)

```
 × reaches resumePreview.open=true only AFTER generation and BEFORE the persistence round-trips resolve
 × shows a persist failure on the preview's error channel while keeping the modal open
 × still shows the generated document in the preview when persistence fails
 × populates version history via onGenerationPersisted -> reloadVersionsForPosition(knownPositionId)
 Test Files  1 failed (1)
      Tests  4 failed | 4 passed (8)
```

| # | Test | Property | HEAD status | Why |
|---|------|----------|-------------|-----|
| A | preview opens before persistence resolves | AC-L4 initiation order | **RED** | HEAD awaits `upsertPosition→upsertApplication→persistGeneratedDocuments` (useManualTailor.js:271-303) *before* `finishByOpeningPreview` (:307); with persistence held pending the modal never opens. |
| B | persist failure surfaced on the preview error channel | DS-5 (dominant risk) | **RED** | a throwing `upsertApplication` (applicationStatusWriter.js:272) propagates to tailorPosting's catch (:320) → status "error", `{ok:false}`; modal never opens, nothing reaches the error channel. |
| C | generated document still reaches the preview on persist failure | no paid-generation loss | **RED** | same root: the throw aborts before `finishByOpeningPreview`, discarding the paid-for document. |
| D | version history reloads after background persist | DS-6 | **RED** | HEAD has no `reloadVersionsForPosition`/`onGenerationPersisted`; the open-time external_id lookup is stubbed to find no row (the design's regression condition), so history stays empty. |
| B2 | CONTROL: successful persist raises no error alarm | over-fire control for B | GUARD (green HEAD) | success path opens with a clear error channel; RED against a build that always alarms. |
| D2 | CONTROL: no completed persist ⇒ history stays empty | over-fire control for D | GUARD (green HEAD) | RED against a build that populates history regardless of persistence. |
| E | queued path (openPreview:false) keeps persistence inline; opens no modal | DS-4 scope guard | GUARD (green HEAD) | HEAD already awaits inline; RED against the over-correction that backgrounds the queued path. |
| F | download works from the opened preview after a good run | last hop | GUARD (green HEAD) | non-regression: the reorder must not break download; RED against a wrong-job open. |

**jsdom / N74 discipline.** Every timing claim is initiation-order: a mock is held as an
unresolved deferred and state is asserted before/after it resolves. No timer, no elapsed
duration, no true mid-flight race is asserted. Each test's comment says so.

**Reachability.** Tests A/B/C/D/F drive the real `tailorPosting` by dispatching a click on a
rendered `<button>` (the repo's established `dispatchEvent(new MouseEvent("click"))` pattern),
composing the real `useManualTailor` + the real `useDocumentPreview.finishByOpeningPreview`
(the AC-L4 instrument). The harness stands in for page.js's Generate wiring (page.js is a held
god-component, out of this seat's scope — the true button lives there). The queued path (E) is
driven the way its real caller (`useManualPostings`) drives it: `tailorPosting` called directly.

## Instruments discriminate (mutants watched against the reference; no-op survives)

Faithful, compiling mutants; failures were assertion failures (valid instruments, rule #4).

| Mutant | Change | Result (target in bold) |
|--------|--------|-------------------------|
| MUT-noop | benign comment line | **survives** — 8 passed (rule #7 control) |
| MUT-A | await persistence BEFORE opening (HEAD order) | kills **A** (+B,C,B2 via double-persist artifact) — msg "the preview did not open while persistence was still pending" |
| MUT-B | drop the catch's `onGenerationPersistError` (bare swallow) | kills **B** only (1 failed) |
| MUT-D | never fire `onGenerationPersisted` | kills **D** only (1 failed) |
| MUT-E | background persistence on the queued path too | kills **E** only (1 failed) |
| MUT-F | `finishByOpeningPreview` opens the wrong jobId | kills **F** (+A,B,C) — download reads empty entry (`templateDocxB64` "") |

**Rebuilt (rule #4, not counted until valid):** MUT-E's first multi-line anchor FAILED TO APPLY
(em-dash encoding mismatch → an instrument that proved nothing). Rebuilt with a single-line
anchor (`await persistGeneration();` → `void persistGeneration();`); it then killed E.

## Satisfiability (reference implementation, isolated scratchpad)

Reference L4 build: `useManualTailor` reorders so `finishByOpeningPreview` runs first on the
interactive path, then a wrapped `void (async …)` background persist that calls
`onGenerationPersisted({jobId,positionId})` on success and `onGenerationPersistError({jobId,error})`
in the catch; the `openPreview===false` branch keeps `await persistGeneration()` inline.
`useDocumentPreview` gains `reloadVersionsForPosition(jobId, positionId)` (fresh requestId →
`refreshDocumentVersions` over the `knownPositionId` seam) and `notePersistFailure(jobId, message)`
(sets `resumePreview.error` for the open job). Result: **8/8 green**, and neighbours green —
`useManualTailor.test.js`, `useManualTailor.research.test.js`, `useManualPostings.test.js`,
`useDocumentPreview.{wiring,download,warnings,duplicateCheck,spacing,lateWarm}.test.js` → **133/133**.

## §4 — CROSS-SUITE FINDING the plan/design missed (hand-off, blocking)

`app/hooks/useDocumentPreview.wiring.test.js:148-150` pins `useDocumentPreview.js` split-lines
`< 935` ("Do not raise the constant… extract instead."). The working-tree file is **927** lines
(8 lines of headroom). L4's two required additions (`reloadVersionsForPosition` +
`notePersistFailure` + 2 return entries) need ~9-23 lines. A clean, commented implementation
breaches (my first reference: 950 → wiring test fails "expected 950 to be less than 935"; even a
lean one-comment form: 936). I could only get the whole suite green (932) by cramming both methods
to one-liners — which the guard's own comment discourages. **The L4 implementer must extract to
make room (the guard's prescribed remedy) OR the structure/wiring seat must re-judge the 935
ceiling.** This is not a test defect; it is an implementation-packaging collision. The file is
held/actively edited (undo chunk), so the count is a moving target — the implementer must measure
at land time. Recommend: extract the version-history cluster (or the persist-failure surfacing)
into a small module, sized so the wiring guard's shrink assertion still bites.

## The L4 contract this seat pins (for the checker to ratify)

Design named `reloadVersionsForPosition` and "surface via the preview notice/error channel" but
left the exact failure seam unspecified. This seat pins it:
- `useManualTailor` new props: `onGenerationPersisted({jobId, positionId})` (success),
  `onGenerationPersistError({jobId, error})` (background catch — the non-swallow).
- `useDocumentPreview` new return methods: `reloadVersionsForPosition(jobId, positionId)`,
  `notePersistFailure(jobId, message)`.
- None are module exports (hook props / return properties), so the ORPHAN=70 / TEST_REFERENCED=368
  census is untouched. The test imports only already-exported symbols; no test-only export added.

## What I could not verify / limits (stated plainly)

- **No wall-clock / true concurrency** (N74) — every timing claim is initiation-order only.
- **D's regression condition is stubbed**: the open-time external_id lookup returns null so version
  history can only come from the known-positionId reload. This faithfully models the design's
  stated regression (the row is not written when the preview opens after the reorder); D's primary
  discriminator is also the MUT-D mutant (open early, never reload).
- **The exact persist-failure copy** is N84's (this seat only asserts the *error channel is
  non-empty* and, in the success control, *stays empty* — not specific words).
- **Held-file drift**: `useDocumentPreview.js` in the working tree already differs from the design's
  line citations (design ~926 → now 927 split-lines; the file is being edited in parallel). My test
  anchors on symbols, not lines; the reference edits applied cleanly, confirming the structures L4
  depends on still exist. Rebase expected; §4 headroom must be re-measured at land time.
- **F is a non-regression guard** (green on HEAD for download), not a red; disclosed.

## Proposed ledger lines

| ID | Requirement (checkable) | Instrument | HEAD | Evidence |
|----|-------------------------|------------|------|----------|
| T-L4-A | Interactive preview reaches `open:true` after generation and before persistence resolves | initiation-order (fetch + upsertPosition deferreds); real hooks; click | **RED** | MUT-A kills; MUT-noop survives |
| T-L4-B | A background persist failure sets the preview error channel; modal stays open (never swallowed) | throwing `upsertApplication`; assert open + error non-empty; success control asserts error empty | **RED** | MUT-B kills B only |
| T-L4-C | The generated document still reaches the preview when persistence fails (no paid-generation loss) | throwing persist; assert open + entry content present | **RED** | MUT-A/F kill |
| T-L4-D | Version history reloads via `onGenerationPersisted`→`reloadVersionsForPosition(knownPositionId)`; empty without a completed persist | open-time lookup stubbed null; assert `fetchDocumentVersions` called with known positionId + history non-empty; control asserts empty | **RED** | MUT-D kills D only |
| T-L4-E | Queued path (`openPreview:false`) keeps persistence inline (return waits) and opens no modal | deferred persist; assert return unresolved while pending + no modal; resolves after | GUARD | MUT-E kills E only |
| T-L4-F | Download works from the opened preview after a good run (reads the open job's bytes) | real `downloadDocumentPreview`; assert docx builder called with the open job's `templateDocxB64` | GUARD | MUT-F kills F |
| T-L4-CEIL | L4's `useDocumentPreview.js` additions collide with the wiring test `<935` ceiling (927 now, ~9 needed) — extract or re-judge | `useDocumentPreview.wiring.test.js:148` | finding | reference: 950/936 breach; 932 only via cram |
