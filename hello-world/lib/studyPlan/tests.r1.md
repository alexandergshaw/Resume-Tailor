# N157 SC-B-persist — 4b acceptance tests (r1)

TDD seat notes for the two store-layer test files. Binds to
`docs/loop/N157.SC-B-persist.plan.r1.md` (steps 1/3/5, risks R1/R2/R7) and
`docs/loop/N157.arch.r2.md` (§3/§5.2/§6/§7/§9). Builds on the shipped foundation
(commit 9166a40): `studyPlanContract.js` + `studyPlanSchema.js` — imported, never
redefined.

## Files authored (test + notes only; NO production edits)

- `lib/studyPlan/studyPlanStore.test.js` — 351 lines, **25 tests** (DB wrappers).
- `lib/studyPlan/studyPlanProgressStore.test.js` — 264 lines, **18 tests** (client state store).
- `lib/studyPlan/tests.r1.md` — this file.

I did NOT touch `lib/sourceScan/exportReachability.*` — the sweep reconcile is the
orchestrator's combined step after SC-A + SC-B-persist land, per the brief.

## RED status and why

Both files are **RED on HEAD for the one correct reason**: the modules under test
(`./studyPlanStore.js`, `./studyPlanProgressStore.js`) do not exist, so the relative
imports fail to resolve and each file fails at collection. Verified twice:

```
 ❯ lib/studyPlan/studyPlanProgressStore.test.js (0 test)
 ❯ lib/studyPlan/studyPlanStore.test.js (0 test)
 FAIL ... Error: Cannot find module './studyPlanProgressStore.js'
 FAIL ... Error: Cannot find module './studyPlanStore.js'
 Test Files  2 failed (2)
```

Because the files fail at collection (greenfield), vitest reports `0 test` per file
rather than per-test reds — the honest consequence of absent modules. Per-test red
*behaviour* is proven instead against a discarded scratchpad reference (below), where
all 43 go GREEN, so every assertion describes a build that provably exists and turns
red only when its property is violated. **No test passes vacuously**: each one either
asserts against injected data/calls or is a named canary/control that proves its
instrument discriminates.

## Satisfiability proof (discarded scratchpad reference)

Isolated reference tree at
`…/scratchpad/ref/` — copies of the shipped `studyPlanSchema.js`/`studyPlanContract.js`
+ `test/helpers/supabaseMock.js`, copies of both `.test.js` files, and a REFERENCE
`studyPlanStore.js` + `studyPlanProgressStore.js` written to the plan's §4.1/§4.2
contracts. node_modules junctioned from hello-world (then removed). Result:

```
 Test Files  2 passed (2)
      Tests  43 passed (43)   (store 25 + progressStore 18)
```

The reference is a throwaway; the working-tree modules remain absent (RED). This proves
the reds are satisfiable and that a correct build greens both files without breaking the
imported shipped schema/contract.

Neighbouring-suite note: these are `.test.js` only and add NO production module, so the
production-only `exportReachability` scan and every pinned census are untouched by this
change — nothing neighbouring to break.

## Mutation testing — every mutant WATCHED fail, no-op controls WATCHED survive

Each mutant is a faithful behavioural change to the reference source (module still
loads); run against the reference copy, never the working tree. All killed:

| Mutant | Module | Targeted property | Result |
|---|---|---|---|
| M-READ-STAR | store | `.select(STUDY_PLAN_PROJECTION)` → `.select("*")` | 1 failed (projection test) |
| M-READ-NOUSER | store | drop `.eq("user_id", userId)` | 1 failed (both-.eq test) — confirmed by name |
| M-READ-RESHAPE | store | re-shape `cached_research` instead of pass-through | 1 failed (pass-through test) |
| M-WRITE-PROGRESS | store | add `progress` to the upsert payload (R2) | 1 failed (R2 test) — confirmed by name |
| M-WRITE-EMPTYID | store | remove the empty-`applicationId` guard (S9) | 1 failed (refusal test) |
| M-RPC-USERID | store | add `p_user_id` to the rpc args (R4) | 1 failed (exact-payload test) |
| M-RPC-NOGUARD | store | remove `isSingleItemSeenDelta` guard (R1/M3) | 2 failed (whole-map + empty-delta never-issued) |
| M-SNAP-ALLOC | prog | `getSnapshot` allocates each call (R8) | 1 failed (stable-ref test) |
| M-LOAD-DROPCURSOR | prog | ignore the loaded cursor (C5/D-4) | 1 failed (resume test) |
| M-RECORD-NOWRITE | prog | drop the `writer(...)` delegation (S11) | 3 failed (delegation + merge + control) |
| M-RECORD-NOGUARD | prog | remove `isSingleItemSeenDelta` guard (M3 #1) | 1 failed (empty-delta writer-not-called) |
| M-RECORD-SWALLOW | prog | return `{written:true}` on a failed persist (R7) | 1 failed (R7 test) |
| NOOP-store | store | leading comment line (control) | **survived — 25 passed** |
| NOOP-prog | prog | leading comment line (control) | **survived — 18 passed** |

No mutant had to be rebuilt: every one applied, loaded, and died for the property it
attacked. The two no-op controls prove the suites are sensitive, not brittle.

## The one-delta canary and the progress-exclusion canary (as asked)

- **One-delta (R1/M3):** `writeStudyPlanProgress` asserts `Object.keys(args.p_seen_delta)`
  is exactly `["i_abc"]` and that a 2-key whole-`seen`-map (and an empty map) is refused
  with **`.rpc()` never issued** (`(sb.calls.rpc || []).toHaveLength(0)`). Over-fire
  control: a valid single-item delta DOES issue the rpc exactly once. A literal-fixture
  canary (`[[fn, {...}]]` → `toHaveLength(0)` throws) proves the never-issued assertion
  can fail. `studyPlanProgressStore.recordProgress` carries the same guard at the client
  boundary (M3 guard #1): a card with no `itemId` → empty delta → writer never called.
- **Progress-exclusion (R2):** `writeStudyPlan` is called with an adversarial `progress`
  key in its args; the test asserts `Object.keys(upsertedRow)` does **not** contain
  `progress` and `row` has no `progress` property. Vacuity control: the whitelist is not
  empty (`status`/`plan`/`knobs`/`engine` ARE present). Canary: a literal row carrying
  `progress` makes the `not.toContain("progress")` assertion throw.

## Supabase-rpc mock approach used

Used the repo's shared `test/helpers/supabaseMock.js` **unchanged** — it already records
`.rpc(name, args)` into `sb.calls.rpc` (array of `[fn, args]`) and accepts canned
per-function results via the second argument `{ rpc: { <fn>: { data, error } | Error } }`
(same recorder `prepStore.test.js` uses for `claim_prep_pack_slot` /
`record_prep_model_call`). **No mock extension was needed.** For `.from()` reads/writes
the mock records verb chains, `.eq` args and `.upsert(row, opts)` args per table, which
the projection / both-`.eq` / payload-key-set / K2-FROM assertions read directly.

## What the implementer (Step 1a/3a) must know

1. `studyPlanStore.js` signatures are fixed by plan §4.1 and these tests:
   `readStudyPlan(supabase,{applicationId,userId})` →
   `{status,plan,knobs,progress,cachedResearch,postingFingerprint,researchedAt,engine,error}`;
   `writeStudyPlan(supabase,{applicationId,userId,status,plan,knobs,engine,postingFingerprint,researchedAt,cachedResearch})`
   → `{written,row,error}`;
   `writeStudyPlanProgress(supabase,{applicationId,cursor,seenDelta})` → `{written,error}`.
2. **Never throw** — every path returns a result object (error fixtures assert this).
3. **`writeStudyPlan` must NOT include a `progress` column** and must NOT even accept a
   `progress` arg into the payload (R2, SILENT at runtime). Progress is RPC-write-only.
4. `writeStudyPlanProgress` sends **exactly** `{p_application_id,p_cursor,p_seen_delta}` —
   no user id — and **fails closed** (no `.rpc()`) on a non-single-item delta.
5. `studyPlanProgressStore.js`: module-scope, `getSnapshot` referentially stable (R8),
   injected reader/writer (no supabase/store import — the source sweep enforces this),
   `recordProgress` optimistically merges then delegates the durable write; on a failed
   write it **surfaces the error and keeps optimistic state**, and a later
   `loadStudyPlanRecord` reconciles from the reader (R7). `STUDY_PLAN_RECORD_STORE_MAX === 50`.
6. Export `resetStudyPlanProgressStore()` (test-only, used in `beforeEach`).

## Owner-env-only / could not verify from this checkout

- Live RLS/CHECK/grant enforcement, cross-user refusal, and
  `merge_study_plan_progress` lost-update safety under READ COMMITTED (2-session
  concurrency) — no live DB here; owner-run per plan §8. The node tests pin the
  single-delta discipline that the server merge relies on, not the live merge itself.
- R2's live consequence — a pre-seeded `seen` surviving a knob-rebuild — is a
  column-wise-upsert DB property; the mock cannot merge. The in-repo guard tested is the
  column-exclusion (the only thing the store can enforce); the read-back-intact is owner-run.

## Proposed ledger lines

| ID | Requirement (checkable) | Decidability | Instrument / evidence |
|---|---|---|---|
| TEST-SCBP-1 | `readStudyPlan` selects `STUDY_PLAN_PROJECTION` (never `*`) with BOTH `.eq("application_id")` + `.eq("user_id")` + `.maybeSingle()`; absent/mismatched row → all-null record, error null; `cached_research` passes through unchanged; DB error → result object, never throw | node-unit RED→GREEN | `studyPlanStore.test.js`; mutants M-READ-STAR/NOUSER/RESHAPE watched killed |
| TEST-SCBP-2 | `writeStudyPlan` upserts `{onConflict:"application_id"}` with `user_id` in payload; written columns NEVER include `progress` (R2); empty `applicationId` refused with no `.from()` call (S9) | node-unit RED→GREEN | `studyPlanStore.test.js`; mutants M-WRITE-PROGRESS/EMPTYID watched killed + progress-exclusion canary |
| TEST-SCBP-3 | `writeStudyPlanProgress` calls the RPC with exactly `{p_application_id,p_cursor,p_seen_delta}` (no user id, R4); a 2-key/empty `seenDelta` is refused with `.rpc()` never issued (R1/M3); boolean result maps through; never throws | node-unit RED→GREEN | `studyPlanStore.test.js`; mutants M-RPC-USERID/NOGUARD watched killed + never-issued canary |
| TEST-SCBP-4 | `studyPlanProgressStore` is module-scope with a referentially stable `getSnapshot` (R8); `loadStudyPlanRecord` writes loading synchronously, settles, drops superseded late arrivals, and exposes DB `cursor.itemId`/`seen` for resume (C5/D-4); no supabase/store import | node-unit RED→GREEN | `studyPlanProgressStore.test.js`; mutants M-SNAP-ALLOC/LOAD-DROPCURSOR watched killed + import sweep |
| TEST-SCBP-5 | `recordProgress` builds a single-item delta, optimistically merges, delegates the durable write to the injected writer (S11 removal); empty delta never reaches the writer (M3 #1); a failed persist surfaces the error and reconciles on reload (R7) | node-unit RED→GREEN | `studyPlanProgressStore.test.js`; mutants M-RECORD-NOWRITE/NOGUARD/SWALLOW watched killed |
| TEST-SCBP-6 | Both files land RED greenfield (modules absent) and are satisfiable: a scratchpad reference greens 43/43; both no-op mutation controls survive | RED proof + scratchpad reference | vitest summary lines in this file |
