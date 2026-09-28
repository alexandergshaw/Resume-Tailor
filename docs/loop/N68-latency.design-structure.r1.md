# N68 latency — structural design (seat 1b, round r1)

Seat: STRUCTURE (1b). Input AC: `docs/loop/N68-latency.ac.r1.md` (AC-L1..AC-L10). Round: r1.
No source edited, no git writes. All file:line citations read against the working tree 2026-09-28.

Scope handed to me: rule on and design the module/contract boundaries for the four SAFE,
no-provider-spend latency wins the AC enumerated — **L2** (login chain), **L3** (tracking
sub-fetches), **L4** (preview-before-persistence), **L5(ii)** (cover ∥ email) — plus a ruling on
the marginal/gated items **L6**, **L9**, and the owner-gated **L8**. L7 is owned by N61/N72/N73
(reference only). No wall-clock measurement (inherited AC-L10; jsdom limit N74).

---

## 0. The verification the brief demanded FIRST: is L5(ii) real?

**Ruling: L5(ii) is CORRECT — the hiring email has no dependency on the cover letter, in any of
the three engines. Cover ∥ email is safe.** The AC seat verified the email reads `tailoredResume`
(route.js:520-523) but did NOT trace the email engine implementations for a hidden cover-letter
dependency. I traced all three:

- **Route call site** (`app/api/tailor/route.js:517-527`): `tailorHiringEmail` is passed exactly
  `{ jobPosting, jobPostingUrl, companyName, jobTitle, resumeText, tailoredResume,
  additionalContext, persona, userId }`. **No cover-letter argument is passed at all** — the cover
  draft (`coverDraft`, `coverLetterResultLines`, `coverLetterResult`) is never referenced in the
  email block.
- **embedded** (`lib/llm/engines/tailor-lite/engine.js:774-785`): destructures
  `{ jobPosting, jobPostingUrl, jobTitle, companyName, userId, persona }`. Builds the email from the
  posting text + the user's library capabilities. No cover input; does not even read `tailoredResume`.
- **gemini** (`lib/llm/engines/geminiEngine.js:31-34` → `generateTailoredHiringEmailDraft`,
  `lib/llm/tailorResume.js:607-657`): destructures
  `{ jobPosting, jobPostingUrl, companyName, jobTitle, resumeText, tailoredResume,
  additionalContext, steeringInstructions }` and calls `buildHiringEmailPrompt(...)` with those.
  No cover-letter parameter reaches the prompt builder.
- **external** (`lib/llm/engines/externalEngine.js:146-148`): `tailorHiringEmail()` returns `null`
  unconditionally — no email, no dependency (`lib/llm/engines/index.js:12-17` documents this).

**Conclusion:** the cover letter and the hiring email each depend only on `tailoredResume`
(`route.js:441`), never on each other. Running them concurrently after the résumé cannot change what
either produces. **L5(ii) stays in scope.** (The résumé→both dependency at `:441,:456,:523` is real
and unchanged; parallelizing the résumé away remains out of scope per AC §5.)

---

## 1. The design in one picture (what moves where)

| Change | Where the concurrency lives today (serial) | Target seam | New module? | page.js touch |
|---|---|---|---|---|
| **L5(ii)** | `route.js` cover block (:442-493) then email block (:515-537) | in-file: two never-rejecting async tasks under one `Promise.all` after `tailoredResume` is computed | no | none |
| **L4** | `useManualTailor.js` persistence (:271-303) awaited **before** `finishByOpeningPreview` (:307) | reorder: open preview first (synchronous), persist in a wrapped background task; re-trigger version load on completion | no (one new callback prop) | small (wire 1 prop) |
| **L2** | `page.js` `loadUserData` five serial awaits (:381,:394,:425,:434×2) | extract concurrent fetch fan-out to `lib/session/loadSignedInUserData.js`; page.js applies settled results | **yes** (1 importer: page.js) | replace serial block with loader call + result application |
| **L3** | `page.js` `loadApplications` three serial sub-fetches (:1117,:1133,:1153) | extract to `lib/applications/loadApplicationRelations.js`; three `.in()` batches concurrent with per-leg isolation | **yes** (1 importer: page.js) | replace serial block with loader call |

No migrations. No schema changes. No table/column added. Nothing starts an LLM/Gmail/external call
earlier than today (owner ruling honoured — see §7).

---

## 2. L5(ii) — cover letter ∥ hiring email (server, `app/api/tailor/route.js`)

### Structure
Today the flow is strictly serial:
`result = await tailorResume(...)` (:409) → `tailoredResume = pickTailoredResume(...)` (:441) →
cover block awaits `tailorCoverLetter` (:450) → email block awaits `tailorHiringEmail` (:517).

Target: after `tailoredResume` is computed (:441), evaluate cover and email **concurrently**. Each
of the two existing blocks already contains its own `try/catch` that converts a failure into a
plain error string (`coverLetterError`, `emailError`) and **never rethrows** (:489-492, :533-536).
Wrap each block's body in a local async function that RETURNS the values it currently assigns to
outer `let`s, then:

```
const [coverOutcome, emailOutcome] = await Promise.all([runCoverLetter(), runHiringEmail()]);
```

Because each task's failure is caught *inside* the task, `Promise.all` here has
`allSettled` semantics by construction (neither task can reject), so a failed email cannot fail the
cover letter and vice-versa. Destructure the outcomes back into the existing variable names the
response assembler reads.

### Contracts (the two extracted local tasks — same file, not exported)
- `runCoverLetter()` → `Promise<{ resultLines: string[], result: string, docxB64: string,
  match: object|null, warnings: string[], variantUsed: {name,source,detected}|null, error: string }>`.
  Contains the pre-call guards unchanged (`coverLetterFile instanceof File` :442, empty-template
  :444, file-type :446) — these are synchronous and set `error` without a round-trip; only the
  `tailorCoverLetter` call (:450) is awaited.
- `runHiringEmail()` → `Promise<{ subject: string, resultLines: string[], warnings: string[],
  error: string }>`. Contains the `typeof activeEngine.tailorHiringEmail === "function"` guard
  (:515) and the null-draft handling (:528). external's `null` return path is preserved (empty
  strings/arrays, no error).

### Load-bearing invariants (what a reviewer applies to a diff)
1. **Résumé strictly precedes both** (AC-L5 guard (i)). Reviewer check: `await tailorResume`
   (or its assignment to `result`) and the computation of `tailoredResume` must both appear
   *before* the `Promise.all`, and neither task may reference `result`/`tailoredResume` from inside
   an expression evaluated before the résumé await resolves. Diff rule: **the `Promise.all` must sit
   below the `pickTailoredResume(...)` line; `tailorResume` must never appear inside the
   `Promise.all` array.**
2. **Warning order and dedup unchanged** (`route.js:566-579`). The aggregation reads
   `resumeWarnings` then `coverLetterWarnings` then `emailWarnings` in that fixed order, deduping
   cover/email against a `Set` seeded from résumé warnings. `Promise.all` preserves array order, so
   feed `coverOutcome.warnings`/`emailOutcome.warnings` into the *same* positions. Diff rule:
   **the three `.push`/spread sites at :566-579 must consume the outcomes in résumé→cover→email
   order; a reordering is a defect.**
3. **Per-artifact error isolation** (AC-L5 trap). Each task keeps its own `try/catch`; do not hoist
   a catch to the `Promise.all`. Diff rule: **neither task body may `throw`; each must resolve with
   its `error` string field.**

### Initiation-order observability (AC-L2/L5 instrument, N74-safe)
The engine is an injected seam (`getEngine(engineName)`, route.js). A route test supplies a fake
engine whose `tailorResume`/`tailorCoverLetter`/`tailorHiringEmail` each return a test-controlled
deferred, and asserts: (i) neither cover nor email is invoked until the résumé deferred resolves
[guard, passes on HEAD]; (ii) both cover and email are invoked before either resolves [RED on HEAD,
where they are serial]. This is a call-count-at-a-point-in-time assertion — pure initiation order,
not a wall-clock or mid-flight-edit race, so it is inside jsdom's power (not an N74 violation).
**Observable because the seam is the engine method boundary, which the test already controls
(`route.test.js` exists).** No extraction needed to see it.

### Blast radius
- Callers of the route: `useManualTailor.js:141` (`fetch("/api/tailor")`) and any other POSTers —
  none observe internal ordering; they read the assembled JSON, whose shape is unchanged.
- Assertions that pass because of current behaviour: `app/api/tailor/route.test.js` (owned — must be
  read for any test that pins sequential completion order of cover-before-email; classify each such
  assertion checked-safe or adopt it). `lib/llm/tailorResume.wire.test.js` pins the gemini
  `config`/`tools` nesting on the wire — **unaffected** (we change orchestration, not the per-call
  shape). Canary the search for order-dependent route tests (§8).

---

## 3. L4 — preview opens before post-generation persistence (`app/hooks/useManualTailor.js`)

### The fact base
- Generated content is in client state by `:240` (the `updateTailoringJob` write).
- `finishByOpeningPreview` (`useDocumentPreview.js:886-904`) is **fully synchronous**: it calls
  `setResumePreview({ open:true, ... })` synchronously (:890) and then fires `loadVersionsForJob`
  (:902, fire-and-forget `void refreshDocumentVersions`) and `startBackgroundResearch` (:903,
  fire-and-forget). Nothing in it awaits.
- Today it runs only *after* up to three awaited persistence round-trips: `upsertPosition` (:273),
  `upsertApplication` (:290), `persistGeneratedDocuments` (:292). That is pure dead time the
  candidate waits through with a finished document already in state.

### Error-semantics ruling (brief MUST-ADDRESS #3 — the reason this is a 1b decision, not a 1d one)
I traced the three persistence helpers' throw/return contracts:
- `upsertPosition` (`lib/supabase/upsertPosition.js:50-67`): **never throws** — swallows to `null`.
- `persistGeneratedDocuments` (`lib/supabase/persistGeneration.js:43-110`): **never throws** —
  wrapped in try/catch, returns `{resumeId, coverLetterId}` (nulls on failure).
- `upsertApplication` (`lib/supabase/upsertApplication.js:31-34`) → `writeApplicationStatus`
  (`lib/supabase/applicationStatusWriter.js:66`): **CAN throw** — there is a
  `throw new TypeError(...)` at `applicationStatusWriter.js:272`.

**Consequence, verified:** *today*, a `writeApplicationStatus` throw propagates out of the awaited
persistence block into `tailorPosting`'s `catch` (`:320`), which sets `status:"error"` and returns
`{ok:false}` — **discarding an already-generated, already-paid-for résumé and never opening the
preview.** This is a pre-existing latent defect. Backgrounding persistence *removes* that failure
mode for the interactive path (the preview opens regardless), which is a strict improvement — **but
only if the background task is itself wrapped**, or the throw becomes an unhandled rejection.

**Ruling on "what the user sees when a background persist fails":** the background persistence task
MUST be wrapped in `try/catch`. On failure it must NOT present a saved-looking finished screen with
nothing persisted (this repo's recurring defect class). The failure is surfaced through the
preview's existing scoped `notice`/`error` channel (`resumePreview.notice`/`.error`,
`EMPTY_SCOPE_TEXT`, `useDocumentPreview.js:899-900`) — **the general legibility/decision-log form of
this is owned by N84 (`docs/loop/N68.ac.r1.md`); this design references N84 for the surfacing
mechanism and does not re-specify it.** What 1b fixes here is only that the failure must remain
*observable*, not that it be swallowed, when persistence moves off the critical path. Note the
current helpers already swallow position/document failures to `console.error` only — so
backgrounding does not *worsen* visibility for those two; it is the `upsertApplication` throw that
changes handling, and the wrap makes it no worse than today (and better, since the preview survives).

### The version-history interaction (AC-L4 design consideration #1 — a real regression if ignored)
`finishByOpeningPreview` fires `loadVersionsForJob(jobId)` → `refreshDocumentVersions` →
`resolvePositionId(jobId)` (`useDocumentPreview.js:146-159`), which looks the position row up by
`external_id`. **Today** persistence has already created that row, so version history loads
populated. **After** we open the preview before persistence, `resolvePositionId` runs before the row
exists → returns `null` → version history renders empty (`:171-182` sets the scopes to `[]`). For a
brand-new manual generation there is no *prior* history, so the visible effect is: the version
dropdown is briefly empty and then does not self-populate with the just-persisted generation. That
is a regression of a currently-working behaviour.

**Seam to close it — a new optional callback prop on `useManualTailor`:**
`onGenerationPersisted?: ({ jobId, positionId }) => void`. After the background persistence resolves
with a `positionId` (from `upsertPosition`), the task calls `onGenerationPersisted({ jobId, positionId })`.
`page.js` wires this to a version reload. `useDocumentPreview` already exposes the exact primitive:
`refreshDocumentVersions(jobId, scopesToLoad, requestId, knownPositionId)` accepts a
`knownPositionId` precisely "right after a revise persists a new generation"
(`useDocumentPreview.js:161-168`). The clean wiring is a thin public method on `useDocumentPreview`,
e.g. `reloadVersionsForPosition(jobId, positionId)` that bumps a fresh `requestId` and calls
`refreshDocumentVersions(jobId, VERSION_SCOPES, requestId, positionId)`. This keeps `useManualTailor`
ignorant of version history (it just fires a callback), which is the correct decoupling — the hook
must not learn what a "version" is (mirrors the `onCheckDuplicate` opaque-callback pattern already in
this hook, :204).

**Lower-cost alternative (state it; let the plan + checker make the cost call, per iteration-caps):**
accept the brief empty-then-nothing version dropdown on first generation as tolerable, and skip the
callback. I recommend AGAINST: "a document that appears saved but shows no saved version" is exactly
the legibility defect class N84 exists for. The callback is small and removes the regression.

### Structure and contract
```
// finishByOpeningPreview is synchronous — call it FIRST, guarded by openPreview:
if (opts.openPreview !== false) {
  finishByOpeningPreview({ jobId, jobTitle, company, posting, applyResume, applyCover,
                           coverLetterResultLines });   // opens the modal immediately
}
// Persist in the background — NON-awaited, fully wrapped:
if (currentUser && opts.openPreview !== false) {
  void (async () => {
    try {
      const supabase = createClient();
      const positionId = await upsertPosition(supabase, syntheticJob);
      if (positionId) await upsertApplication(supabase, { userId, positionId, status: STATUS.TAILORED });
      await persistGeneratedDocuments(supabase, { ...unchanged... });
      onGenerationPersisted?.({ jobId: syntheticJobId, positionId });
    } catch (err) {
      // surface via preview notice/error channel — N84 owns the copy/decision-log.
      // MUST NOT be a bare swallow; MUST NOT leave a saved-looking blank screen.
    }
  })();
}
```
- **The queued path (`opts.openPreview === false`) is UNCHANGED** — it keeps the awaited persistence
  block exactly as today (see blast radius). L4's reorder applies only when `openPreview !== false`.

### Blast radius (enumerated)
- **Callers of `tailorPosting`:**
  - `useManualPostings.js:266` (`const result = await tailorPosting({...})`, queued run,
    `openPreview:false`). The queue awaits the return to know a worker finished (`:139`, `:245`,
    `:370`). Because L4 leaves the queued path's persistence *inline/awaited*, `await tailorPosting`
    still means "persisted" for the queue. **Untouched — this is why L4 must be scoped to the
    interactive path.**
  - `page.js` `handleRegenerateSyntheticJob` and `generateWithReviewedValues` call `tailorPosting`
    directly and **discard the return** (documented at `useManualTailor.js:178-186`). They do not
    rely on persistence completing before return, so backgrounding is safe for them. **Owned — must
    re-read both handlers when wiring `onGenerationPersisted`.**
- **New behaviour to note for any interactive caller:** for `openPreview !== false`, persistence
  completion no longer precedes `tailorPosting`'s resolution. Any code that reads the persisted rows
  immediately after the call would race. Census this on the diff (§8); today only the queue reads
  post-return state and it is on the untouched path.
- `finishByOpeningPreview`'s own fire-and-forget `startBackgroundResearch` (:903) and the N73 warm
  already fired earlier at `useManualTailor.js:257-268` share a per-job dedupe
  (`researchStartedRef`) — moving the preview-open earlier does not double-spend (same `jobId`).
  **Checked-safe.**

### Initiation-order / rendered-hop observability (AC-L4 instrument)
Mount the real hook via a harness that supplies the real `finishByOpeningPreview` from
`useDocumentPreview`; mock the persistence helpers as an unresolved deferred; drive `tailorPosting`;
assert `resumePreview.open === true` (the rendered state, not a flag) **before** the persistence
deferred resolves. Observable because the open is a synchronous `setResumePreview` that reaches
state independently of the (now backgrounded, unresolved) persistence promise.

### Held-file / rebase note
`useManualTailor.js` and `useDocumentPreview.js` are both in the brief's held set (other agents,
uncommitted). **Rebase expected on both.** The `page.js` wiring for `onGenerationPersisted` is small.

---

## 4. L2 — login load chain concurrency (`app/page.js` `loadUserData`, extract)

### The five independent round-trips (all confirmed independent; none consumes another's output)
1. `GET /api/user-context` (:381) → `setAdditionalContext`
2. `GET /api/user-prefs` (:394) → several controller/state setters (:398-412)
3. `loadAppliedOrLaterExternalIds(supabase, user.id)` (:425) → `setAppliedJobIds`, `setAppliedByExternalId`
4. `supabase.storage.from("resumes").download(`${id}/resume`)` (:434 iter 1) → `setResumeFile`
5. `supabase.storage.from("resumes").download(`${id}/cover-letter`)` (:434 iter 2) → `setCoverLetterFile`

### The trap this seat must not miss (the frame the flag carries — AC-L3-style, applied to L2)
`contextLoadedRef` and `uiPrefsLoadedRef` are not incidental. They gate the **save-back** effects:
- `page.js:338` — `if (!currentUser || !contextLoadedRef.current) return;` guards the effect that
  writes `additionalContext` back to Redis.
- `page.js:351` — same for `uiPrefsLoadedRef` guarding the prefs save-back.
Today each ref is set `false` immediately before its load (:379, :392) and `true` immediately after
(:389, :415), *adjacent to* its `setState`. That adjacency is what prevents the just-loaded value
from being immediately re-saved. **A naive `Promise.all` that sets both refs `true` after the
aggregate resolves changes save-back timing and can trigger a spurious save-back POST of the value
we just loaded.** This is a real correctness hazard, not a style point.

### Design ruling
**Extract the concurrent FETCHING into a pure loader; keep the setState + ref-set adjacency in
page.js.** The loader returns settled outcomes; page.js applies each outcome with the same
`setter → ref=true` adjacency per leg as today.

```
// lib/session/loadSignedInUserData.js  (NEW; sole production importer: app/page.js)
/**
 * Fire all five independent signed-in-bootstrap round-trips CONCURRENTLY and
 * return their settled outcomes. Never throws; a failed leg yields ok:false.
 * Injectable fetch + supabase so an initiation-order test can drive it directly.
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient,
 *           userId: string, fetchImpl?: typeof fetch }} deps
 * @returns {Promise<{
 *   context: { ok: boolean, additionalContext: string|null },
 *   prefs:   { ok: boolean, prefs: object|null },
 *   applied: { ok: boolean, ids: Set<string>|null, byExternalId: object|null },
 *   resume:  { ok: boolean, file: File|null },
 *   cover:   { ok: boolean, file: File|null },
 * }>}
 */
export async function loadSignedInUserData({ supabase, userId, fetchImpl = fetch }) { /* Promise.allSettled of 5 */ }
```
- The loader issues all five requests synchronously (builds the `allSettled` array) before awaiting.
- The loader does **no** `setState` and touches **no** ref — it is a data function.
- `page.js`'s `loadUserData` becomes: `const r = await loadSignedInUserData({ supabase, userId });`
  then apply each leg with the existing per-leg `setter; ref=true` adjacency:
  `if (r.context.ok) setAdditionalContext(r.context.additionalContext); contextLoadedRef.current = true;`
  `if (r.prefs.ok) { /* the :398-412 controller writes */ } uiPrefsLoadedRef.current = true;`
  `if (r.applied.ok) { setAppliedJobIds(r.applied.ids); setAppliedByExternalId(r.applied.byExternalId); }`
  `if (r.resume.ok) setResumeFile(r.resume.file); if (r.cover.ok) setCoverLetterFile(r.cover.file);`
  The signed-out branch (:441-449) and the try/catch swallow-per-leg semantics are preserved.

### Load-bearing invariants (diff rules)
1. **All five in flight before any resolves.** Diff rule: inside `loadSignedInUserData`, the five
   round-trip calls must all appear as elements of a single `Promise.allSettled([...])` array
   (or be started before the first `await`); **no `await` may sit between two of the five starts.**
2. **Ref adjacency preserved.** Diff rule: in `page.js`, `contextLoadedRef.current = true` must
   remain adjacent-after the `setAdditionalContext` application, and `uiPrefsLoadedRef.current = true`
   adjacent-after the prefs application — never both set true after the aggregate in a way that
   changes save-back timing. **A guard test must assert the loader's parallelization does not emit
   an extra `POST /api/user-context` or `/api/user-prefs` save-back for the just-loaded values.**
3. **Per-leg failure isolation.** A failed leg leaves its state at the mount default (today's
   per-`try{}catch{}` swallow), never aborts the others. `allSettled` gives this by construction.

### Instrument / RED demonstration (honest note to the plan + TDD seats)
The AC records "RED on HEAD: YES" against the *in-place* serial code at `page.js:381→394→425→434`.
**Extraction changes the RED demonstration**: the initiation-order test targets the new
`loadSignedInUserData` seam (inject `fetchImpl` + a supabase stub whose `download`/query return
deferreds; assert all five issued before any resolves). Because the seam does not exist at HEAD, RED
is demonstrated by the **mutation/no-op control** (a serial reference implementation of the loader
fails the test), not by running against current page.js. This is the standard seam+mutant pattern
here; the plan/TDD seat owns wiring it. If the orchestrator requires literal RED-against-HEAD, the
alternative is an in-place `Promise.allSettled` inside `loadUserData` (mount the page component) —
higher blast radius on a held god-component and a heavier test. **I recommend extraction** (testable
seam, shrinks the god-component per the active consolidation effort, decouples the test from
page.js internals) and flag the RED-demonstration consequence explicitly.

### Blast radius
- `loadUserData` is invoked only from the mount effect: `:453` (`getSession().then`) and `:455-457`
  (`onAuthStateChange`). Both call `loadSignedInUserData` the same way. **Owned.**
- Consumers of the five setters/refs: `setAdditionalContext`, the prefs controllers
  (`referencesCtl`/`educationCtl`/`employmentCtl`, `setHideAppliedJobs`, `setInterviewSort`),
  `setAppliedJobIds`/`setAppliedByExternalId`, `setResumeFile`/`setCoverLetterFile`, and the two
  save-back effects (:338, :351). All page.js-internal; the plan must enumerate the save-back effect
  deps to confirm invariant #2. **Owned; canary the ref search (§8).**

### Export reachability
`loadSignedInUserData.js` has exactly one production importer (`page.js`) → **does not raise
ORPHAN_EXPORTS (pinned 71, `exportReachability.sweep.test.js:402`).** Export exactly the one
function page.js consumes; keep any internal helpers unexported so TEST_REFERENCED (pinned 364,
`:688`) is unchanged. (The initiation-order test importing `loadSignedInUserData` does not make it
test-only — page.js imports it too.)

---

## 5. L3 — tracking-table sub-fetches concurrency (`app/page.js` `loadApplications`, extract)

### The three independent sub-fetches (all derive from `appRows` only, not from each other)
After the applications+positions query resolves (`:1102` `appRows`):
- resumes: `.from("generated_resumes").in("id", resumeIds)` (:1117), `resumeIds` from
  `appRows.map(r => r.resume_used_id)` (:1114).
- covers: `.from("generated_cover_letters").in("id", coverIds)` (:1133), `coverIds` from
  `appRows.map(r => r.cover_letter_id)` (:1130).
- stages: `.from("interview_stages").in("application_id", appIds)` (:1153), `appIds` from
  `merged.map(app => app.id)` (:1150). **Confirmed:** `merged` is `appRows` with resume/cover maps
  attached (:1144-1148); `app.id` equals `appRows`' id, so `appIds` is derivable from `appRows`
  directly — it does **not** depend on `resumeMap`/`coverMap`. All three are mutually independent.

### The partial-failure trap (AC-L3, brief MUST-ADDRESS #3 — enumerate what the frame carried)
Today each sub-fetch has its OWN error branch: on error it `console.warn`s "(non-fatal)" and leaves
its map `{}`, letting the other two populate (`:1121-1125`, `:1137-1141`, `:1159-1167`). A naive
`Promise.all` would reject the whole thing if any one fails, converting three independently-handled
failures into one all-or-nothing loss of partial data. **The extracted loader MUST preserve per-leg
isolation** (`Promise.allSettled`, or three independent `try/catch` inside the concurrent tasks) so
a resume-fetch failure still lets covers/stages land. **N84 owns the swallowed-failure legibility;
this design only preserves the isolation, and references N84.**

### Design ruling
```
// lib/applications/loadApplicationRelations.js  (NEW; sole production importer: app/page.js)
/**
 * Given the applications+positions rows, fetch their three related batches
 * CONCURRENTLY with per-leg failure isolation. Never throws; a failed leg
 * yields its empty map (today's non-fatal semantics). appIds derives from
 * appRows directly, so all three are independent of one another.
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient,
 *           appRows: Array<object> }} deps
 * @returns {Promise<{ resumeMap: Record<string,object>,
 *                     coverMap: Record<string,object>,
 *                     stageMap: Record<string, object[]> }>}
 */
export async function loadApplicationRelations({ supabase, appRows }) { /* Promise.allSettled of 3 .in() */ }
```
`page.js`'s `loadApplications`: run the applications query (unchanged, incl. its own error return at
:1104-1111 and the `cancelled` guard), then
`const { resumeMap, coverMap, stageMap } = await loadApplicationRelations({ supabase, appRows });`
then merge (:1144-1148) and reduce stages (:1162-1166) exactly as today, still behind `if (!cancelled)`.

### Load-bearing invariants (diff rules)
1. **Three in flight before any resolves.** Diff rule: the three `.in()` queries are elements of one
   `Promise.allSettled([...])` (or started before the first await); no `await` between two starts.
2. **Per-leg isolation kept.** Diff rule: a rejected leg yields `{}`/`{}`/`{}` respectively; the
   loader must never surface a single rejection that drops the other two legs' data. The empty-input
   short-circuits (`resumeIds.length > 0` etc., :1116/:1132/:1152) are preserved (a leg with no ids
   resolves to `{}` without a round-trip).
3. **Merge shape byte-identical.** `merged`/`nextStageMap` structure unchanged; only the fetch timing
   moves.

### Instrument / RED demonstration
Same seam+mutant note as L2: the initiation-order test targets `loadApplicationRelations` (inject a
supabase stub whose three `.in()` queries return deferreds; assert all three issued before any
resolves; plus an `allSettled`/per-catch assertion that one leg's rejection still yields the other
two maps). RED demonstrated by a serial reference implementation failing the test.

### Blast radius
- `loadApplications` invoked only from the mount effect (`:1177`), dep `[currentUser,
  applicationsRefreshKey]`. **Owned.**
- Downstream consumers read `applicationData` (merged) and `applicationStages` — shape unchanged.
  **Checked-safe.**

### Export reachability
`loadApplicationRelations.js` — one production importer (page.js). Same ORPHAN/TR guarantee as §4.

---

## 6. Rulings on the marginal / gated items

- **L6 (template-line precompute at upload):** **DEFER.** It is local CPU (two docx parses,
  `useManualTailor.js:130,136`), not a round-trip; jsdom cannot time it; the win is tens of ms and it
  competes for edits on held files (`useManualTailor.js`, `page.js` upload setters). Building it now
  would add blast radius to the held hooks for a marginal gain. Leave as named gated work; a later
  round may take it. (Concurs with AC-L6's own "low priority, may defer".)
- **L9 (reuse-not-refetch on `applicationsRefreshKey`):** **DEFER (gated).** Provisional in the AC;
  value depends on unmeasured key-bump frequency and table size; interacts with N84's refresh-blank
  finding. Structurally it would require a targeted/incremental refresh path in `loadApplications`,
  materially more complex than L3's fan-out and on the same held file. Not worth coupling to this
  chunk. Named gated work.
- **L8 (speculative PROVIDER/EXTERNAL prefetch):** **NOT IN SCOPE — owner spend decision, unbuilt.**
  Honoured verbatim (brief owner ruling). None of L2/L3/L4/L5 starts any LLM/Gmail/external call
  earlier than today (see §7).
- **L7 (research at generation-START):** owned by N61/N72/N73. Reference only; not re-specified.

---

## 7. Owner ruling compliance — nothing starts provider/external work earlier

Explicit confirmation the design starts **no** LLM/Gmail/external call earlier than HEAD:
- **L5(ii):** the same three engine calls, re-ordered among themselves; résumé still gates both.
  No new call, none moved earlier than its data dependency allows.
- **L4:** moves *DB persistence* off the critical path and moves the *preview open* earlier. The
  research warm it triggers (`startBackgroundResearch`) already fires today at this point (and even
  earlier at `useManualTailor.js:257`), deduped per `jobId` — **no new or earlier paid call.**
- **L2/L3:** only the user's own Redis (`/api/user-context`, `/api/user-prefs`) and Supabase
  reads/downloads — no provider quota, no external ingest.

**Does the structure make speculative provider prefetch "easy later"?** Mildly: `loadSignedInUserData`
is a natural place someone could later add a speculative feed/prep warm. **Flagged, per brief:** do
not. Any future addition of a provider/external call to these loaders is an L8 owner decision, not a
free extension of this chunk. No code is built toward it here.

---

## 8. Search canaries the plan/checker must run (false-absence guards)

- **Callers of `tailorPosting`** (L4 blast radius): `grep -rn "tailorPosting" app/` — canary: must
  return `useManualTailor.js` (definition), `useManualPostings.js:53,266`, and the page.js handlers.
  If it returns fewer than the queue + two page handlers, the search root/pattern is wrong.
- **Ref consumers** (L2 invariant #2): `grep -n "contextLoadedRef\|uiPrefsLoadedRef" app/page.js` —
  canary: must return the declarations (:279-280), the two save-back guards (:338, :351), and the
  set sites (:379,:389,:392,:415,:443,:444). Nine hits confirmed this round.
- **Order-dependent route tests** (L5): `grep -rn "tailorCoverLetter\|tailorHiringEmail" app/api/tailor/route.test.js`
  — canary against a known positive (the file references both). Read each assertion that pins
  cover-before-email completion order; classify owned/adopted/checked-safe.
- **Post-return persistence readers** (L4): on the diff, confirm no interactive caller reads a
  persisted `applications`/`generated_*` row immediately after `await tailorPosting(...)` on the
  `openPreview !== false` path.

Emoji scan (standing rule): the two new modules and any edited files must pass a Node-based emoji
scan (not `grep -P`) with a canary matching a known emoji. No emojis anywhere.

---

## 9. Sequencing (page.js touched LAST and small; rebases named)

1. **L5(ii)** — `app/api/tailor/route.js` only. No held files, no page.js. Land first.
2. **L4** — `app/hooks/useManualTailor.js` (reorder + wrapped background task + new
   `onGenerationPersisted` prop) and `app/hooks/useDocumentPreview.js` (thin
   `reloadVersionsForPosition` public method). **Both held — rebase expected.** page.js wiring for
   the prop is deferred to step 5.
3. **L2 module** — create `lib/session/loadSignedInUserData.js`. New file, conflict-free.
4. **L3 module** — create `lib/applications/loadApplicationRelations.js`. New file, conflict-free.
5. **page.js LAST, small** — replace the `loadUserData` serial block with the loader call + result
   application (L2), replace the `loadApplications` sub-fetch block with the loader call (L3), and
   wire `onGenerationPersisted` (L4). **page.js is held with uncommitted changes by other agents —
   rebase expected here; keep the edit to the three localized replacements.**

Each new module lands with its production importer in the SAME step it is created is not possible
(the importer is page.js, step 5); therefore steps 3-4 create the modules and step 5 imports them.
**Between step 3/4 and step 5 the new modules are momentarily unimported** — which would trip
ORPHAN_EXPORTS if a gate ran in between. **Mitigation:** land steps 3, 4 and 5 as one commit (module
+ its page.js importer together), or land the page.js importer in the same PR before any gate runs.
Flag to the plan: **do not let a new loader module sit through a gate without its page.js importer.**

---

## 10. What I could NOT verify (stated plainly, with the instrument the next seat needs)

1. **Wall-clock latency of any wait point.** Inherited AC-L10: not measurable in this environment
   (jsdom, no telemetry — N74). All ranking is round-trip-structure proxy. Instrument the next seat
   would need: production timing telemetry or a real browser Network panel. **Named gated work, not
   satisfied.**
2. **The full set of `writeApplicationStatus` throw paths.** I confirmed one `throw` exists
   (`applicationStatusWriter.js:272`, a `TypeError`), which is sufficient to prove `upsertApplication`
   CAN throw and that the L4 background task must wrap. I did NOT enumerate every throw path. The
   ruling does not depend on the count (the wrap is required regardless). Instrument: full read of
   `writeApplicationStatus` (`:66-331`).
3. **Whether applying the five L2 results in a single tick triggers a spurious save-back.** I
   established the *hazard* (refs gate saves at :338/:351) and the *contract* (preserve adjacency),
   but I did NOT run a render to observe the save-back effect firing. Instrument: a jsdom test that
   mounts the page (or the extracted apply-logic) and asserts no extra `POST /api/user-context`
   `/api/user-prefs` after a load. **Handed to the TDD seat as invariant #2's guard test.**
4. **RED-against-HEAD for L2/L3 under extraction.** By construction the seam does not exist at HEAD,
   so RED is shown by a serial-mutant control, not by current page.js. Flagged to plan/TDD as a
   demonstration-mechanism change, not a criterion change.
5. **`route.test.js` order-dependent assertions.** I did not read the route test file's assertions;
   I flag the canary (§8) and the owned/adopted/checked-safe classification as plan/TDD work.

---

## Proposed ledger lines

| ID | Requirement (checkable) | Instrument | Evidence | Blast radius / rebase |
|----|-------------------------|------------|----------|-----------------------|
| DS-1 | L5(ii) verified SAFE: hiring email takes no cover-letter input in any engine; cover ∥ email is correct | read the 3 engine `tailorHiringEmail` signatures + route call site | `route.js:517-527`; `tailor-lite/engine.js:774-785`; `geminiEngine.js:31-34`+`tailorResume.js:607-628`; `externalEngine.js:146-148` | — |
| DS-2 | Tailor route runs cover ∥ email via one `Promise.all` of two never-rejecting async tasks placed AFTER `pickTailoredResume`; `tailorResume` never inside the `Promise.all` | route test, 3 engine-method deferreds: (i) neither cover/email before résumé resolves [guard], (ii) both before either resolves [RED] | `route.js:409,441,450,517`; per-call try/catch `:489-492,:533-536`; warning aggregation `:566-579` | route.js (not held); read `route.test.js` order assertions |
| DS-3 | Warning aggregation still consumes résumé→cover→email in fixed order after parallelization; per-artifact error isolation kept (neither task throws) | assert warnings array order + a failing email leaves cover intact | `route.js:566-579` | owned |
| DS-4 | Interactive preview (`openPreview!==false`) opens BEFORE persistence resolves; persistence runs in a wrapped background task; queued path (`openPreview===false`) persistence stays inline/awaited | mount real hook; persistence helpers as unresolved deferred; assert `resumePreview.open===true` before it resolves; assert queued path still awaits | `useManualTailor.js:271-303,:307`; `useDocumentPreview.js:886-904`; queue `useManualPostings.js:266` | useManualTailor held — rebase |
| DS-5 | Background persistence failure is surfaced (preview notice/error), never a bare swallow presenting a saved-looking blank screen; `upsertApplication` throw no longer aborts the preview | inject a throwing `upsertApplication`; assert preview stays open AND a notice/error is set (surfacing form owned by N84) | `applicationStatusWriter.js:272` (throw exists); `upsertPosition.js:50-67` + `persistGeneration.js:43-110` (swallow); N84 | references N84; useManualTailor held |
| DS-6 | Version history re-loads after background persistence via new `onGenerationPersisted({jobId,positionId})` prop → `reloadVersionsForPosition` using `knownPositionId` | assert version dropdown populates after the persistence deferred resolves | `useDocumentPreview.js:146-168,:204-210` (`knownPositionId` seam) | useDocumentPreview + page.js wiring — rebase |
| DS-7 | New `lib/session/loadSignedInUserData.js` fires all 5 login round-trips concurrently (single `allSettled`, no await between starts); never throws; per-leg isolation | initiation-order test (inject fetchImpl+supabase stub, 5 deferreds); serial-mutant control proves RED | `page.js:381,394,425,434` | new module; sole importer page.js |
| DS-8 | page.js preserves `contextLoadedRef`/`uiPrefsLoadedRef` set-true adjacency after applying each leg's result; no spurious save-back POST for just-loaded values | guard test: after login load, no extra `POST /api/user-context` or `/api/user-prefs` | `page.js:279-280,338,351,379,389,392,415,443,444` | page.js held — rebase |
| DS-9 | New `lib/applications/loadApplicationRelations.js` fires the 3 sub-fetches concurrently with per-leg failure isolation (`allSettled`); merged/stage shapes unchanged; empty-id legs short-circuit without a round-trip | initiation-order test (3 deferreds) + one-leg-rejection-still-yields-other-two; serial-mutant control | `page.js:1102,1114,1117,1130,1133,1150,1153` | new module; sole importer page.js |
| DS-10 | Both new modules keep ORPHAN_EXPORTS=71 and TEST_REFERENCED=364: export exactly the one production-consumed function each; land module + page.js importer without a gate in between | run `exportReachability.sweep.test.js`; keep helpers unexported | `exportReachability.sweep.test.js:402,688` | sequencing §9 |
| DS-11 | No provider/LLM/Gmail/external call is initiated earlier than HEAD by any change (owner ruling); L6/L9 deferred, L8 unbuilt, L7 owned by N61/N72/N73 | audit the diff for new/earlier provider call sites | brief owner ruling; `useManualTailor.js:257` (existing warm, deduped) | — |
| DS-12 | page.js touched LAST and small (three localized replacements); rebase expected on page.js, useManualTailor.js, useDocumentPreview.js | sequencing review | brief held-file list; §9 | — |
