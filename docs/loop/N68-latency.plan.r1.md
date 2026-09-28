# N68 latency — implementation plan (seat 3/plan, round r1)

Seat: PLAN (3). Inputs consumed: `docs/loop/N68-latency.ac.r1.md` (AC-L1..AC-L10, BINDS),
`docs/loop/N68-latency.design-structure.r1.md` (DS-1..DS-12, SPECIFIES). Round: r1.
No source edited, no git writes. All file:line read against the working tree 2026-09-28.

Scope: the four SAFE, no-provider-spend wins the design settled — **L5(ii)** cover ∥ email,
**L4** preview-before-persistence, **L2** login load chain, **L3** tracking sub-fetches.
L6/L9 deferred, L8 owner-gated/unbuilt, L7 owned by N61/N72/N73. No migrations, no schema.

---

## 0. Verdict

Plan is **buildable as designed**, with two re-triage corrections the design/AC did not carry and
one contradiction I resolve here. The design's file:line citations for the two held files
(`app/page.js`, `app/hooks/useDocumentPreview.js`) have **drifted ~+2 to +6 lines** since it was
written; the implementer and TDD seat must anchor on the symbols this plan quotes, not on the
design's line numbers. The route's L5 target (`route.js`, not held) still matches its citations
exactly.

**Migration position: N/A.** No migration, no schema, no column. (For completeness: the tree's
actual latest migration is `supabase/migrations/20260928000000_n59_cover_letter_docx_path.sql`;
were one ever needed here it would have to stamp later than that — it is not needed.)

---

## 1. Re-triage of the consumed artifacts against the CURRENT tree

### 1.1 Line-number drift (stale references — anchor on symbols)

| Artifact citation | Design said | CURRENT tree | Status |
|---|---|---|---|
| `route.js` L5 anchors (tailorResume/pickTailoredResume/cover/email/aggregation) | 409/441/450/517/566-579 | 409/441/450/517/566-579 | **EXACT — not held, unchanged** |
| `useManualTailor.js` persistence + finishByOpeningPreview | :271-303, :307 | upsertPosition :273, upsertApplication :290, persistGeneratedDocuments :292, finishByOpeningPreview :307-317, warm :257 | ~exact (±2) |
| `useDocumentPreview.js` finishByOpeningPreview / refreshDocumentVersions(knownPositionId) / loadVersionsForJob | :886-904 / :161-168 / :202-209 | :889-907 / :167-168 / :204-209 | **DRIFTED +3** |
| `page.js` loadUserData / context+prefs refs / save-back guards | loadUserData :374, refs :279-280, guards :338/:351 | loadUserData :379, refs :284-285, guards :343/:356 | **DRIFTED +5** |
| `page.js` loadApplications / sub-fetches | query :1102, resume :1117, cover :1133, stage :1153 | query :1107, resume :1123, cover :1139, stage :1159 | **DRIFTED +2 to +6** |
| `exportReachability.sweep.test.js` ORPHAN=71 / TEST_REFERENCED=364 | :402 / :688 | `toHaveLength(71)` :402, `toBe(364)` :688 | **EXACT — trust assertions; comments still say 56, stale** |

### 1.2 NEW finding the design missed — the queued path CAN pass `openPreview: true`

The design's prose says "the queued path keeps persistence inline and untouched" and scopes L4 to
`openPreview !== false`. But `useManualPostings.js:262` computes
`const openPreview = autoOpenEntryIdRef.current === id;` and passes it at `:266-270` — so the ONE
auto-open queued entry runs with `openPreview: true` and WILL hit the backgrounded path. This is
**safe** (verified): that caller reads only the RETURN OBJECT (`result.ok`, `result.jobId`,
`result.jobTitle`, `result.company`, `result.warning` — `useManualPostings.js:272-289`), never a
persisted row, and its own comment (`:276-281`) documents that persistence is invisible from the
return. **Consequence for the implementer: gate the L4 branch on `opts.openPreview !== false`, NOT
on `opts.queued`.** The design's pseudo-code already gates on `openPreview`; only its prose was
imprecise. Do not introduce a `queued` gate.

### 1.3 NEW finding — the second interactive return-reader

`page.js` `generateWithReviewedValues` (`:2378-2390`) is an INTERACTIVE caller
(`await manualTailor.tailorPosting(null, {values, overridePosting})`, `openPreview` defaults true)
that reads `result.ok` to fire a B1 research trigger. After L4 the return resolves BEFORE
persistence, but it reads only `result.ok` (not a persisted row), and the B1 trigger already fires
"with no id" as a documented no-op (`:2381-2388`). **SAFE, no behaviour change** — flagged so the
implementer re-reads it when confirming L4 blast radius rather than assuming only the queue calls in.

### 1.4 route.test.js order-dependent assertion — CONFIRMED and it breaks under L5

`app/api/tailor/route.test.js:277-280` ("also grounds the cover letter in the project pages")
reads `generateContent.mock.calls[1][0].contents` with the comment "Second generateContent call is
the cover letter draft" and asserts it `toContain("Payments migration")`. Under L5's `Promise.all`,
cover and email each call `generateContent` after the résumé, so `mock.calls[1]` becomes
**non-deterministic** — it may be the EMAIL prompt, which receives NO `contextDocuments`
(`route.js:503-507`) and therefore does NOT contain "Payments migration". **This assertion FAILS or
flakes after L5.** Resolution in §2.

---

## 2. Contradictions / unresolved items routed to me — resolved

**R-1 (from design §10.5 / AC L5): route.test.js order-dependent assertion.** RESOLVED by
adoption, not deferral. `route.test.js:277-280` is reclassified **ADOPT**: replace the fixed
`mock.calls[1]` index with a content-based lookup that identifies the cover-letter `generateContent`
call by its template signature (the call whose `contents` include a cover-template line, e.g.
`"Sincerely, Jane"` from the test's `coverLetterTemplateLines`), then assert THAT call's contents
contain `"Payments migration"`. The assertion's INTENT (cover letter is grounded in project pages)
is preserved; only the order-coupled mechanism changes. This is a legitimate adopt (the behaviour
under test is unchanged), not a silent edit of a wrong test. The TDD/implementer seat makes this
change in the SAME landable unit as L5 (Step 1). Any other `mock.calls[<n>]` in `route.test.js` that
indexes past call 0 must be audited by the same canary (§6) and adopted the same way.

**R-2 (from design §10.3 / AC-L2 open question): does the L2 change trigger a spurious save-back in
a real render?** RESOLVED by construction of the DS-8 guard, DEFERRING the empirical question to the
TDD seat with an explicit protocol (I did not run a render either). The design established the
*hazard* (refs at `page.js:343`/`:356` gate the save-back effects) and the *contract* (per-leg
`setter → ref=true` adjacency). It did NOT observe whether HEAD's serial `loadUserData` already
emits a save-back. **Protocol handed to TDD (Step 5 test):** first characterize HEAD — mount the
real page (or the extracted apply-logic) and count `PUT /api/user-context` + `/api/user-prefs`
fired after a login load with no user edit. Then pin: **the L2 change must emit NO MORE save-back
POSTs than HEAD.** If HEAD emits zero, the guard asserts zero. If HEAD already emits one (a
pre-existing defect, N84/legibility territory — NOT introduced by this chunk), the guard asserts
"no net-new," and the pre-existing count is filed as a separate finding, not fixed here. The RED
control for this guard is the **naive mutant** (a loader variant that sets both refs `true` after
the aggregate instead of per-leg) — it must emit the extra save-back.

---

## 3. Ordered steps (each independently landable; files named; migration position stated)

**No migration in any step.** page.js is touched LAST and in three localized replacements.

### Step 1 — L5(ii): cover letter ∥ hiring email — `app/api/tailor/route.js` (NOT held)
**Land first** (route.js is uncontended). Files: `app/api/tailor/route.js`,
`app/api/tailor/route.test.js` (adopt R-1).
- After `const tailoredResume = pickTailoredResume(...)` (:441), wrap the cover block body
  (currently :442-493, the six `let` assignments + guards + `tailorCoverLetter` call + try/catch)
  in a local async fn `runCoverLetter()` that RETURNS an object with the fields it currently assigns
  to outer `let`s: `{ resultLines, result, docxB64, match, variantUsed, warnings, error }`. Keep the
  synchronous pre-call guards (`instanceof File` :442, empty-template :444, file-type :446) INSIDE
  the task; only the `tailorCoverLetter` await is the round-trip.
- Wrap the email block body (:508-537: `emailSubject`/`emailResultLines`/`emailWarnings`/`emailError`
  + the `typeof … === "function"` guard + null-draft handling) in `runHiringEmail()` returning
  `{ subject, resultLines, warnings, error }`. Preserve external's `null`-return path
  (empty strings/arrays, no error).
- Replace the two serial blocks with
  `const [coverOutcome, emailOutcome] = await Promise.all([runCoverLetter(), runHiringEmail()]);`
  placed BELOW the `pickTailoredResume` line. Destructure back into the exact variable names the
  aggregator (:544-587) and the response assembler (:629,:632, etc.) read.
- **Invariant (AC-L5 guard i):** `tailorResume`/`pickTailoredResume` stay ABOVE the `Promise.all`;
  `tailorResume` must NEVER appear inside the `Promise.all` array.
- **Invariant (DS-3):** the warning aggregation (:566-579) must still consume
  résumé→cover→email order; feed `coverOutcome.warnings`/`emailOutcome.warnings` into the same
  positions. Neither task may `throw` — each resolves with its `error` string (per-artifact
  isolation → `Promise.all` has allSettled semantics by construction).
- Adopt R-1 in `route.test.js` in this same unit.
- **Verify after:** `npx vitest run app/api/tailor/route.test.js` (PowerShell, cwd hello-world) —
  read the runner's summary line, not the exit code. Rebase risk: **none** (route.js not held).

### Step 2 — L4: preview opens before persistence — `useManualTailor.js` + `useDocumentPreview.js` (BOTH HELD)
Files: `app/hooks/useManualTailor.js`, `app/hooks/useDocumentPreview.js`. **Rebase expected on both**
(N59 implementer holds them). page.js wiring of the new prop is deferred to Step 5.
- **`useDocumentPreview.js`:** add a thin public method
  `reloadVersionsForPosition(jobId, positionId)` that bumps a fresh requestId and calls
  `refreshDocumentVersions(jobId, VERSION_SCOPES, requestId, positionId)` (the `knownPositionId`
  seam at :167-168; `VERSION_SCOPES` at :52). Export it in the hook return (:909-925). Contract:
  `reloadVersionsForPosition(jobId: string, positionId: string) => void` (fire-and-forget,
  synchronous kickoff; internally async).
- **`useManualTailor.js`:** add optional prop `onGenerationPersisted` to the destructure
  (:41-66, alongside `onCheckDuplicate`). Contract:
  `onGenerationPersisted?: ({ jobId: string, positionId: string|null }) => void`. Optional — a
  caller that omits it keeps today's behaviour.
- Refactor the persistence block (:271-303) into a local async fn returning the positionId, e.g.
  `async function persistGeneration() { const supabase = createClient(); const positionId = await
  upsertPosition(...); if (positionId) await upsertApplication(...); await
  persistGeneratedDocuments(...); return positionId; }` (bodies byte-identical to today).
- Reorder so `finishByOpeningPreview` (currently :307-317) is called FIRST, guarded by
  `opts.openPreview !== false`, BEFORE persistence. Then:
  - `if (currentUser)` and `opts.openPreview === false`: `await persistGeneration();` INLINE (queued
    non-auto-open path — return still means "persisted").
  - `if (currentUser)` and `opts.openPreview !== false`: `void (async () => { try { const positionId
    = await persistGeneration(); onGenerationPersisted?.({ jobId: syntheticJobId, positionId }); }
    catch (err) { /* surface via preview notice/error channel — must NOT be a bare swallow, must NOT
    leave a saved-looking blank screen; surfacing FORM owned by N84 */ } })();`
- **Gate on `opts.openPreview !== false`, NOT `opts.queued`** (re-triage §1.2).
- **Invariant (DS-4):** queued/`openPreview===false` path keeps persistence awaited-inline; the
  return resolves only after persistence for that path. Interactive path: `finishByOpeningPreview`
  runs before persistence resolves.
- **Invariant (DS-5):** the background task is wrapped; a thrown `upsertApplication`
  (`applicationStatusWriter.js:272`) no longer aborts the preview, and the failure is surfaced, not
  swallowed silently.
- **Verify after:** the L4 hook test (Step written by TDD) + `useDocumentPreview` tests, run ALONE.
  Rebase risk: **HIGH** (both held). After rebase, re-run both files' tests and re-confirm the
  persistence body was not concurrently changed by N59 (N59 touches `saveGeneratedCoverLetter`/docx
  path — read the persist helpers' current signatures before finalizing).

### Step 3 — L2 module — CREATE `lib/session/loadSignedInUserData.js` (new dir)
File: `lib/session/loadSignedInUserData.js` (NEW; `lib/session/` does not yet exist — create it).
- Pure data function, NO setState, NO ref touch. Signature per DS-7:
  `export async function loadSignedInUserData({ supabase, userId, fetchImpl = fetch }) => Promise<{
  context:{ok,additionalContext}, prefs:{ok,prefs}, applied:{ok,ids,byExternalId},
  resume:{ok,file}, cover:{ok,file} }>`.
- Issue all five round-trips as elements of ONE `Promise.allSettled([...])` (no `await` between two
  starts): `GET /api/user-context`, `GET /api/user-prefs`, `loadAppliedOrLaterExternalIds(supabase,
  userId)`, `supabase.storage.from("resumes").download(\`${userId}/resume\`)`,
  `…/cover-letter`. Never throws; a failed leg yields `ok:false`.
- Export EXACTLY this one function; keep any helpers unexported (ORPHAN/TEST_REFERENCED invariant).
- **This module has NO production importer until Step 5.** Do NOT run the export-reachability sweep
  between Step 3 and Step 5 (see §4 gate-ordering).

### Step 4 — L3 module — CREATE `lib/applications/loadApplicationRelations.js` (existing dir)
File: `lib/applications/loadApplicationRelations.js` (NEW; `lib/applications/` EXISTS).
- Signature per DS-9:
  `export async function loadApplicationRelations({ supabase, appRows }) => Promise<{ resumeMap,
  coverMap, stageMap }>`. Computes `resumeIds`/`coverIds`/`appIds` from `appRows` internally
  (`appIds` = `appRows.map(a=>a.id).filter(Boolean)` — confirmed derivable from appRows, NOT from
  the maps, so all three are independent).
- Fire the three `.in()` batches (`generated_resumes`/`generated_cover_letters`/`interview_stages`,
  same `.select` column lists and the stage `.order("scheduled_at", {ascending:false})` as
  page.js:1123-1162) via ONE `Promise.allSettled([...])` with per-leg isolation. A rejected/errored
  leg yields its empty map (today's non-fatal semantics, page.js:1127/1143/1165). Preserve the
  empty-id short-circuits (a leg with no ids resolves to `{}` without a round-trip). Own the stage
  `reduce` into `stageMap` (page.js:1167-1171). Never throws.
- **Contract clarification (resolves a design ambiguity):** the loader returns the ALREADY-REDUCED
  `stageMap`; page.js keeps ONLY the `merged` map-attach step (it needs `resumeMap`/`coverMap`) and
  assigns `stageMap` directly. page.js does not re-reduce.
- Export exactly the one function. Same no-importer-until-Step-5 note as Step 3.

### Step 5 — page.js LAST and SMALL — `app/page.js` (HELD) — three localized replacements
File: `app/page.js`. **Rebase expected (held, active consolidation).** Keep the edit to three
localized replacements; do not refactor surrounding code.
- **5a (L2):** in `loadUserData` (currently :379-456), replace the five serial awaits (:386→:399→
  :430→:439×2) with `const r = await loadSignedInUserData({ supabase, userId: user.id });` then
  apply each leg preserving the per-leg `setter → ref=true` ADJACENCY:
  set `contextLoadedRef.current = false` and `uiPrefsLoadedRef.current = false` before the call
  (mirroring today's :384/:397 reset); then
  `if (r.context.ok) setAdditionalContext(r.context.additionalContext); contextLoadedRef.current =
  true;` — then the prefs controller writes (:403-417) `if (r.prefs.ok) {…}
  uiPrefsLoadedRef.current = true;` — then applied (:431-432) — then resume/cover
  (`if (r.resume.ok) setResumeFile(r.resume.file); if (r.cover.ok) setCoverLetterFile(r.cover.file)`).
  The signed-out branch (:446-455) is UNCHANGED. Import `loadSignedInUserData`.
- **5b (L3):** in `loadApplications` (:1088-1181), after the applications query (:1107, unchanged
  incl. its `appErr` early return :1109-1116 and the `cancelled` guard), replace the three serial
  sub-fetch blocks (:1119-1173) with `const { resumeMap, coverMap, stageMap } =
  await loadApplicationRelations({ supabase, appRows });` then the `merged` attach (:1149-1153,
  unchanged) then `if (!cancelled) { setApplicationData(merged); setApplicationStages(stageMap); …}`.
  Import `loadApplicationRelations`.
- **5c (L4 wiring):** pass `onGenerationPersisted={({ jobId, positionId }) =>
  <preview>.reloadVersionsForPosition(jobId, positionId)}` into the `useManualTailor(...)` call in
  page.js, wired to the `reloadVersionsForPosition` from the `useDocumentPreview` instance. Re-read
  `handleRegenerateSyntheticJob` and `generateWithReviewedValues` (both call `tailorPosting`
  directly) when wiring — they discard/return-read only, do not depend on persistence completing.
- **Invariant (DS-8):** the `contextLoadedRef.current = true` / `uiPrefsLoadedRef.current = true`
  set-true sites stay ADJACENT-AFTER their respective `setState` application — never both after the
  aggregate.
- **Verify after:** L2 initiation-order test, L3 initiation-order test, the DS-8 save-back guard,
  the L4 hook test, AND `npx vitest run lib/sourceScan/exportReachability.sweep.test.js` (must still
  be 71 / 364 with both new modules now imported by page.js). Then the full suite.

---

## 4. Gate ordering — the ORPHAN/TEST_REFERENCED trap (this bit N59 today)

`exportReachability.sweep.test.js` pins `ORPHAN_EXPORTS` at **71** (:402) and `TEST_REFERENCED` at
**364** (:688) with EXACT-match assertions. A new module imported by its TEST but not yet by
production (page.js) lands in `TEST_REFERENCED` (→365) or as an orphan — either way the sweep FAILS.
Therefore:
- Steps 3, 4 and 5 (module creation + page.js import) MUST land as **one commit / one PR**, and the
  L2/L3 initiation-order tests that import the new modules land in that SAME unit.
- **Do NOT run the export-reachability sweep (or accept a gate) in any intermediate state** where a
  new loader module exists without its page.js importer. End state (page.js importing both): ORPHAN
  stays 71, TEST_REFERENCED stays 364 — a module reachable from shipping code is neither.
- Canary before concluding: run the sweep once at HEAD to confirm 71/364 are the live baseline
  before touching anything (guards against blaming this chunk for a pre-existing drift).

---

## 5. Risk table (per step; instrument that catches it; SILENT-failure rows flagged)

| Step | What could break | Instrument that catches it | SILENT if uncaught? |
|---|---|---|---|
| 1 (L5) | Résumé accidentally parallelized → ungrounded cover/email (quality regression) | AC-L5 guard (i): neither cover nor email invoked before résumé deferred resolves | **SILENT** — output still returns 200; only the CONTENT is wrong. No exception, no failing shape test. The guard test is the only catch. |
| 1 (L5) | `mock.calls[1]` non-determinism breaks route.test.js | `route.test.js` (adopted R-1) run alone; without adoption it FLAKES | Loud (test failure) — but INTERMITTENT; re-run alone before concluding (timeout-flake rule). |
| 1 (L5) | Warning order/dedup changes (email warnings mis-attributed or duplicated) | assert warnings array = résumé→cover→email order (DS-3) | **SILENT** — warnings still render, just wrong text/order; no crash. |
| 1 (L5) | One task throws (isolation lost) → whole request rejects | inject a throwing cover engine; assert email still returns and vice-versa | Loud (500) if it happens; but a task that swallows-and-returns wrongly is **SILENT**. |
| 2 (L4) | Background persist FAILS and is swallowed → "saved" screen, nothing persisted (data-loss illusion) | DS-5: inject throwing `upsertApplication`; assert preview open AND notice/error set | **SILENT — this repo's recurring defect class.** Highest-risk silent row in the chunk. |
| 2 (L4) | Version history renders empty after open-before-persist (regression of working behaviour) | DS-6: assert version dropdown populates after persistence deferred resolves (via `onGenerationPersisted`→`reloadVersionsForPosition`) | **SILENT** — empty dropdown looks like "no prior versions," indistinguishable from correct for a first generation. |
| 2 (L4) | Queued auto-open entry (`openPreview:true`) hits background path unexpectedly | verify gate is `openPreview !== false` not `queued`; queued-inline path test (DS-4) | Loud-ish (queue chip state) — but see §1.2, verified safe. |
| 2 (L4) | Rebase against N59 silently reverts the persist-helper call shape | re-read persist helper signatures post-rebase; re-run L4 test | **SILENT** until runtime — a stale call shape may still typecheck in JS. |
| 3/4 (modules) | New module unimported at a gate → ORPHAN/TR assertion fails | `exportReachability.sweep.test.js` 71/364; §4 co-landing | Loud (sweep failure) — but easy to mis-diagnose as unrelated. |
| 3/4 (modules) | Naive `Promise.all` (not allSettled) loses partial data on one leg failure | initiation test + one-leg-rejection-still-yields-others assertion (DS-9) | **SILENT** — a failed résumé fetch would blank covers+stages too; looks like an empty table, not an error. |
| 5a (L2) | Spurious save-back POST of just-loaded value (ref adjacency broken) | DS-8 guard (R-2 protocol): no net-new `PUT /api/user-context`/`/api/user-prefs` vs HEAD; naive-mutant control | **SILENT** — an extra Redis write, invisible to the user; only a network assertion sees it. |
| 5a (L2) | A leg's failure aborts the others (allSettled not used in loader) | per-leg isolation assertion in the L2 loader test | **SILENT** — a failed prefs fetch would blank context+files too. |
| 5b (L3) | `merged`/`stageMap` shape changes (loader owns reduce now) | assert `applicationData`/`applicationStages` shape byte-identical | **SILENT** — subtle shape drift renders wrong rows without erroring. |
| 5 (page.js) | Rebase collides with active consolidation → localized replacement lands in wrong scope | re-run full suite post-rebase; keep edits to the 3 named replacements | **SILENT** if a moved symbol is referenced by stale line. |

---

## 6. 4b hand-off — units, behaviours, instruments the TDD seat must cover

Every concurrency criterion is proven by **INITIATION ORDER** (all N in flight before any resolves)
at an injectable seam — jsdom does no layout and cannot prove a true race (N74). Stated per unit:

1. **L5 route orchestration** (`route.js`). Seam: the injected engine methods
   (`getEngine(engineName)`). Fake engine whose `tailorResume`/`tailorCoverLetter`/`tailorHiringEmail`
   each return a test-controlled deferred. Assert (i) neither cover nor email invoked until the
   résumé deferred resolves [GUARD, passes on HEAD]; (ii) both cover and email invoked before either
   resolves [**RED on HEAD** — they are serial today]. This seam ALREADY EXISTS and the test already
   controls it (`route.test.js`) — **L5 is genuinely RED-on-HEAD, no mutant needed.** Plus DS-3:
   warning-order assertion, and per-artifact isolation (throwing-cover-leaves-email, and vice-versa).
   Plus R-1 adoption of the existing `mock.calls[1]` assertion.

2. **L4 hook** (`useManualTailor` + real `useDocumentPreview.finishByOpeningPreview`). Seam: the
   synchronous `setResumePreview` (the rendered hop). Mount the real hook via a harness supplying the
   real `finishByOpeningPreview`; mock persistence helpers as an UNRESOLVED deferred; drive
   `tailorPosting`; assert `resumePreview.open === true` BEFORE the persistence deferred resolves
   [**RED on HEAD** — finishByOpeningPreview is textually after the awaited persist]. DS-5: inject a
   throwing `upsertApplication`, assert preview stays open AND a notice/error surfaces. DS-6: assert
   version reload fires after persistence resolves. DS-4: assert `openPreview:false` (queued)
   still awaits persistence inline. **RED-on-HEAD: YES for the reorder.**

3. **L2 loader** (`lib/session/loadSignedInUserData.js`). Seam: injected `fetchImpl` + a supabase
   stub whose `download`/query return deferreds. Assert all five issued before any resolves; plus
   per-leg isolation (one leg rejects → others still resolve `ok:true`). **NO POWER AGAINST HEAD —
   the seam does not exist at HEAD.** RED is demonstrated ONLY by a **serial-mutant control** (a
   reference loader that awaits each leg in turn must FAIL the initiation assertion). Without the
   mutant this test is zero-power. **The mutant is MANDATORY** (design §4, §10.4).

4. **L2 save-back guard** (page.js render). DS-8 / R-2 protocol above: characterize HEAD's save-back
   count, then pin "no net-new." RED control = the naive both-refs-true-after-aggregate mutant.

5. **L3 loader** (`lib/applications/loadApplicationRelations.js`). Seam: supabase stub whose three
   `.in()` queries return deferreds. Assert all three issued before any resolves; plus
   one-leg-rejection-still-yields-other-two-maps. **Same as L2: NO POWER AGAINST HEAD — serial-mutant
   control MANDATORY.** Plus empty-id short-circuit (a leg with no ids does no round-trip).

6. **Export-reachability non-regression**: `exportReachability.sweep.test.js` stays 71/364 with both
   modules imported by page.js (DS-10) — co-land per §4.

**Instruments that do not yet exist:** the two loader modules (Steps 3/4) and
`reloadVersionsForPosition` (Step 2) are created BY this chunk; their tests are new files. The L2/L3
tests require the serial-mutant control mechanism (a second, deliberately-serial implementation the
test can swap in) to have any power — call this out to the TDD seat as the ONLY source of RED for
L2/L3.

**Search canaries the TDD/checker must run (false-absence guards):**
- `grep -rn "tailorPosting" app/ --include=*.js | grep -v test` — MUST return the def
  (`useManualTailor.js:70,330`), the queue (`useManualPostings.js:53,266`), and the page.js sites
  (`:1516,:1735,:2380`). Fewer = wrong root/pattern.
- `grep -n "contextLoadedRef\|uiPrefsLoadedRef" app/page.js` — MUST return declarations (:284-285),
  save-back guards (:343,:356), set-sites (:384,:394,:397,:420,:448,:449). (Nine+ hits.)
- `grep -n "mock.calls\[" app/api/tailor/route.test.js` — audit every index > 0 for order-coupling.
- Emoji scan: Node-based (never `grep -P`), with a canary matching a known emoji, over the two new
  modules and every edited file. No emojis anywhere.

---

## 7. What I am NOT doing, and what must be left OPEN

**NOT doing (out of scope, per AC §5 / design §6):**
- L6 (template-line precompute) — DEFERRED; local CPU, marginal, competes for held-file edits.
- L9 (reuse-not-refetch on `applicationsRefreshKey`) — DEFERRED/gated; interacts with N84 refresh-blank.
- L8 (speculative provider/external prefetch) — OWNER spend decision, unbuilt. **No code toward it.**
- L7 (research at generation-START) — owned by N61/N72/N73.
- Parallelizing the résumé with cover/email — quality regression, forbidden.
- Wall-clock measurement/ranking — not doable in this environment (AC-L10); named gated work.
- The general background-failure LEGIBILITY surface (notice/decision-log copy) — owned by **N84**;
  L4 only guarantees the failure remains OBSERVABLE (DS-5), it does not author the copy.

**Must be left OPEN (foreclosing these is expensive and invisible):**
- `loadSignedInUserData` is a natural place a future round could add a speculative feed/prep warm
  (L8). **Do NOT** add one; keep the loader to the five existing user-owned reads. Any future
  provider/external call added here is an L8 owner decision, not a free extension. (Design §7.)
- `onGenerationPersisted` is intentionally OPAQUE — `useManualTailor` must not learn what a
  "version" is. Keep the callback shape `{jobId, positionId}`; do not widen it to carry version data
  (mirrors the `onCheckDuplicate` pattern). A queued round (N61/N72/N73) may later want the SAME
  callback for research-at-start; leave the prop general.
- Do not widen `tailorPosting`'s RETURN shape to expose persisted `applications.id` (both return-
  readers document they don't need it, `page.js:2381`, `useManualPostings.js:276`); a later chunk
  that DOES need it should add it deliberately.

---

## 8. Verified vs inherited

**Personally verified against HEAD this round (Read/Grep):**
- route.js L5 structure and all cited lines (409/441/450/517/566-579) — EXACT.
- All three engines' `tailorHiringEmail` take no cover input: NOT re-traced this round — **INHERITED
  from DS-1** (design traced all three; I verified the route call site `:517-527` passes no cover
  arg). CITED, NOT independently re-verified: the three engine signatures.
- useManualTailor persistence block + finishByOpeningPreview reorder target — verified (:257-317).
- useDocumentPreview finishByOpeningPreview synchronous, `knownPositionId` seam, `VERSION_SCOPES`,
  `reloadVersionsForPosition` absent — verified (:52,:167-168,:204-209,:889-907,:909-925).
- page.js loadUserData five serial awaits + refs + save-back guards — verified (:343,:356,:379-463).
- page.js loadApplications three serial sub-fetches + `appIds`-from-appRows independence — verified
  (:1088-1184).
- The two return-readers consume only the return object — verified (`useManualPostings.js:266-289`,
  `page.js:2378-2390`).
- route.test.js order-dependent `mock.calls[1]` assertion — verified (:277-280).
- ORPHAN=71 / TEST_REFERENCED=364 assertions live; comments stale at 56 — verified (:402,:688,:340).
- Latest migration `20260928000000` — verified (`supabase/migrations/`).

**Inherited / CITED, NOT VERIFIED this round:**
- The three `tailorHiringEmail` engine bodies (DS-1) — trusted from the design; if the email ever
  consumes the cover letter, L5(ii) is wrong. TDD seat's isolation test is the backstop.
- `writeApplicationStatus` throw-path completeness — design confirmed ONE throw
  (`applicationStatusWriter.js:272`), sufficient to require the L4 wrap; full enumeration not done.
- Whether HEAD already emits a spurious save-back (R-2) — NOT observed by me or the design; handed to
  the DS-8 guard as characterize-then-pin.
- I did NOT run the suite. All "RED on HEAD" claims for L2/L3 are, by construction, seam+mutant (no
  power against HEAD); L4 and L5(ii) RED are source-read predictions the TDD seat must confirm by
  landing the tests red.

---

## Proposed ledger lines

| ID | Requirement (checkable) | Instrument | Evidence | Verified/Inherited |
|----|-------------------------|------------|----------|--------------------|
| PL-1 | Steps land in order L5 → L4 → L2 module → L3 module → page.js; page.js touched last in 3 localized replacements; no migration | sequencing review §3 | route.js not held; page.js/useManualTailor/useDocumentPreview held | verified (git status + reads) |
| PL-2 | L5: `Promise.all([runCoverLetter(),runHiringEmail()])` sits below `pickTailoredResume`; `tailorResume` never inside it; warnings consumed résumé→cover→email; neither task throws | route test 3 engine-deferreds (i)+(ii); warnings-order; isolation | `route.js:409,441,450,517,566-579,489-492,533-536` | verified |
| PL-3 | R-1 resolved: `route.test.js:277-280` adopted to content-based cover-call lookup (not `mock.calls[1]`) in the L5 unit | run route.test.js alone after adoption | `route.test.js:277-280` | verified defect |
| PL-4 | L4 gated on `opts.openPreview !== false` (NOT `queued`); interactive path opens preview before backgrounded, wrapped persistence; queued/`openPreview===false` keeps inline await | L4 hook test (open-before-persist) + DS-4 queued-inline | `useManualTailor.js:257-317`; `useManualPostings.js:262-289` | verified |
| PL-5 | L4 background persist failure surfaces (never bare swallow / saved-looking blank); `upsertApplication` throw no longer aborts preview | inject throwing `upsertApplication`; assert open + notice/error | `applicationStatusWriter.js:272` | inherited (DS-5) |
| PL-6 | Version history re-loads via new `onGenerationPersisted({jobId,positionId})` → `reloadVersionsForPosition(jobId,positionId)` on `knownPositionId` seam | assert dropdown populates after persist deferred resolves | `useDocumentPreview.js:167-168,204-209,889-907` | verified (seam exists; method absent) |
| PL-7 | `lib/session/loadSignedInUserData.js` fires 5 login round-trips via one `allSettled`, no await between starts, never throws, per-leg isolation; pure (no setState/ref) | initiation-order test + serial-mutant control (MANDATORY) | `page.js:379-463` | verified target; test power = mutant |
| PL-8 | page.js preserves `contextLoadedRef`/`uiPrefsLoadedRef` set-true adjacency per leg; no net-new save-back POST vs HEAD (R-2 protocol) | DS-8 guard: characterize HEAD then pin; naive-mutant control | `page.js:284-285,343,356,384,394,397,420` | verified hazard; HEAD behaviour NOT observed |
| PL-9 | `lib/applications/loadApplicationRelations.js` fires 3 sub-fetches via one `allSettled`, per-leg isolation, empty-id short-circuit, owns stage reduce, returns `{resumeMap,coverMap,stageMap}`; page.js keeps merge only | initiation test (3 deferreds) + one-leg-rejection-yields-others + serial-mutant | `page.js:1088-1184` | verified target; test power = mutant |
| PL-10 | Both new modules + page.js importer + their tests co-land as one unit; export-reachability sweep never runs in intermediate state; end state ORPHAN=71 / TEST_REFERENCED=364 | `exportReachability.sweep.test.js:402,688`; §4 co-landing | assertions verified live; comments stale (56) | verified |
| PL-11 | No provider/LLM/Gmail/external call initiated earlier than HEAD; L6/L9 deferred; L8 unbuilt; `loadSignedInUserData` gets no speculative warm | audit diff for new/earlier provider calls | design §7; `useManualTailor.js:257` existing deduped warm | verified (scope) |
| PL-12 | Rebases expected on `useManualTailor.js`, `useDocumentPreview.js` (Step 2) and `page.js` (Step 5); after each, re-run that file's tests + full suite; re-read persist-helper signatures post-N59-rebase | post-rebase re-run | held-file list; N59 in flight | verified (git status) |
