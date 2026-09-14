<!-- GENERATED FROM docs/backlog.yml by hello-world/scripts/backlog/render.mjs — DO NOT HAND-EDIT -->

# Backlog

The queue of work this repo owes: **what is owed, by whom, and measured how.**

Read this **before starting anything** (step 0 of the dev loop). An item that lives only in a scratchpad, a
subagent report, or a chunk's own criteria is a deletion with extra steps — nothing reads those at the start of
the next piece of work.

## Rules for this file

1. **Every quantity names its command or `file:line`.** A number without an instrument rots silently, and this
   repo has already shipped counts that were wrong in three documents at once.
2. **Record at disposal, reconcile at the push.** When a check or a round disposes of a finding as "later",
   append it here *then* — not at the end. Residuals are created many waves before a push.
3. **No diary.** This is not a log of what was done. Closed items are deleted, not archived. Use `git log` for
   history.
4. **Owner-only items are never started by an agent.** They are listed so they are not forgotten, not so they
   are picked up.
5. **The loop does not stop while this file has entries.** Finishing a chunk is not finishing the work — the
   next action is always the next backlog item. See "How the loop consumes this file" below.

## How the loop consumes this file

**While this file is non-empty, the dev loop does not stop.** At the end of every chunk, wave, or ruling, the
next action is read off this file rather than chosen freshly.

| Section | What the loop does |
|---|---|
| **Next — actionable now** | Work it. Top to bottom unless a dependency says otherwise. This is where the loop spends its time. |
| **Owner decisions outstanding** | **Never started.** When these are all that remain, the loop's action is to **put them to the owner as a decision** — once, with what is blocked and what would unblock it. Escalating is a step; idling is not. |
| **Verification owed** | Same: surface it, with the exact instrument the owner would run. |

**The loop ends a turn only after it has either advanced an actionable item or escalated a blocked one.**
Stopping with actionable entries present and neither done is the failure this rule exists to prevent.

### Disjoint items are worked SIMULTANEOUSLY

The loop does not work the backlog one item at a time when items do not touch each other. Before dispatching,
compute each candidate item's **file set** and run them together when the sets do not intersect.

**Disjointness has two halves, and both must hold. File-disjoint alone is not enough** — that lesson cost this
repo a whole contract mechanism when two design seats with non-overlapping outputs produced two incompatible
schemas for the same table, because each was designing against facts the other was still establishing.

1. **Exact-path disjointness — computed, never eyeballed.** An item's set is *the files it edits* **plus the
   tests that assert on the behaviour it changes**. Intersect the sets mechanically (`sort | uniq -d`, empty
   output) and paste the result.
2. **Informational independence.** Ask of each pair: *does either establish a fact the other designs against?*
   If yes they are coupled however disjoint their files are — sequence them, or extract the shared contract
   into its own earlier step, alone.

**Cap a simultaneous wave at 2–3 items.** A larger fan-out has produced duplicated discovery here — three
agents independently finding the same blocker, and one designing a solution to a problem a sibling was
concurrently proving did not exist.

**Worked example, run 2026-09-13 — and it refuted the obvious answer.** `SEC-1` (item 1) looked like the ideal
parallel candidate: a one-file resolver fix, unrelated to interview-prep. Computed:
`grep -rln "featureEngine\|wantsEmbedded" --include=*.js app lib` → **58 files** (canary
`zzNoSuchSymbolzz` → 0), and the set **includes `app/api/interview-prep/route.test.js` and
`lib/copilot/groundingNotice.js`** — files IP3 and IP-N own. **Not disjoint.** SEC-1 waits.
Items 2 and 3 (`scripts/regression/**` and a regression AC ruling) *are* disjoint from IP3's
`lib/interviewPrep/**`, and run alongside it.

**A blocked item is escalated once, not repeatedly.** Re-asking the same unanswerable question every turn is
spinning wearing a decision's clothes. Once surfaced, it stays listed and silent until the owner answers or the
blocker clears.

---

## Next — actionable now

| # | Item | Owed by | Measured how |
|---|---|---|---|
| N1 | **`SEC-1`: the engine-override fix, repo-wide.** A request-supplied `engine` overrides server config: `wantsEmbedded("gemini", { RESUME_ENGINE: "embedded" })` returns **false**, with control `("bogus", …)` → **true** proving the default *is* read for unrecognised values. An offline-configured deployment can be forced to spend on paid generation with the candidate's résumé. | Its own chunk — not yet started | `lib/llm/featureEngine.js:28` `wantsEmbedded(requested, env)`; its own header states the precedence — `1. An explicit per-request engine` **before** `2. The server default RESUME_ENGINE` (`:8-9`), and `:33` falls back to the default only when there is no explicit request. Owner ruling **O-14** |
| N2 | **O-2 step 7 precedence is ambiguous** when both the `Test Files` and `Errors` lines hold. No fix round is scheduled. | A regression AC round | ledger `T3-C4b-6`, `T3-V6-6` |
| N3 | **Three 4b instrument minors, disclosed and unfixed.** `C4B-6` an import-extension regex fragility; `C4B-7` the reason-vocabulary CHECK canary drawn from the same source it validates (partially mitigated); `C4B-8` an outcome-check that asserts containment only | A later 4b round | `check-4b.r1.md` majors table; scoped out by `4b.r2.md` |
| N4 | **The K1-PROHIBITION corpus is held-out by instruction, not by construction.** `lib/interviewPrep/__fixtures__/predictionCorpus.js` sits in the implementer's own module directory; nothing prevents reading it. Proven discriminating today: a 10-string lookup-table build passes all 27 visible rows and ships both held-out sentences unrefused | A later hardening round — derive held-out members rather than store them | `4b.r2.md`; ruling `R-IP3-64` |
| N5 | **Three named contract functions have no test and no implementation.** `packRenderState`, `packIsStale`, `shouldStartPrep` are named by `design-structure.r1.md` §3 but no 4b row exercises them, so step-5 wave 1 correctly declined to build them against a guessed row shape. A coverage gap in 4b, not an implementation gap | A 4b round, then the wave that owns them | `prepContract.js`'s own comment names the gap; step-5 wave 1 report |
| N6 | **`launch.js` L7's `lockedIds` guard is unswept** — no faithful dangerous mutant was found for it. Named, not asserted clean | A later sabotage pass | `sabotage.r2.md` |
| N7 | **`prepLog.js` was built with no specifying document and no test.** 86 lines, created because the wave table needs the file to exist for a later mechanical gate and the UI wave. Its export shape is invented, and nothing exercises it — the same class wave 1 correctly refused for three other functions | A 4b round before it carries behaviour | `lib/interviewPrep/prepLog.js` header discloses it; step-5 wave 2 report |
| N8 | **The prep prompt does NOT send the résumé or cover letter.** `route.js` writes `resumeId`/`coverLetterId` as `null` and generates from the posting text plus the digest only, because no binding document names a résumé/cover-letter store. **Two consequences**: answers are not tailored to the candidate's actual material, which is the feature's point; and **O-12's disclosure says the résumé and cover letter are sent**, so the notice currently over-states what leaves the app | A design round to name the store, then the wave that wires it — **and IP-N re-checks the notice text against what is actually sent** | `app/api/interview-prep/route.js` header discloses it; owner ruling **O-12** |
| N9 | **The route discriminates a CHECK violation by MESSAGE TEXT.** `finishAttempt()` matches on the error message because `prepStore.js`'s return shape does not expose `error.code` — yet 3b confirmed at primary source that SQLSTATE `23514` passes through supabase-js **clean and unmodified**. A message-text matcher breaks on any wording change; the code is right there | Expose `error.code` from `prepStore.js` and match on it | `route.js` `finishAttempt()`; `3b.r1.md` item 3 |
| N10 | **`interview_prep_events.outcome` mapping is unconfirmed** (`'failed'→'error'`, else mirrors pack status) — a best-evidenced reading absent a stated CHECK vocabulary | 4b/9c, against the real migration | flagged in `route.js` in-file |
| N11 | **O-7's digest-ensure forwards the caller's cookie** in a server-to-server fetch, because no existing helper does this. Security-relevant and unreviewed | A security review round | disclosed in `route.js`'s header |
| N12 | **`interview_prep_spend.attempts` is still client-resettable.** `authenticated` holds `grant update (attempts, updated_at)` because `claim_prep_pack_slot` is `SECURITY INVOKER` and increments `attempts` **as that role** — revoking it breaks every claim with a permission error. So a `PATCH` can set `attempts` to 0 and buy more retries. **Bounded, and adjudicated as acceptable for now**: every retry still increments `model_calls`, which only the `SECURITY DEFINER` `record_prep_model_call` can write, so the **money** cap holds regardless — exposure is capped at `model_calls <= 12`. **The fix**: make `claim_prep_pack_slot` `SECURITY DEFINER` with its own tenant checks, then revoke insert/update from `authenticated` entirely | A contract round (the contract currently specifies `SECURITY INVOKER`) | `20260914000000_interview_prep.sql:368-369`; flagged by the implementer rather than worked around |

## Owner decisions outstanding

| # | Question | Why it is blocked |
|---|---|---|
| D1 | **RLS on the three new interview-prep tables cannot be verified here.** Supabase's URL is a placeholder, so every CHECK, policy and the `claim_prep_pack_slot` RPC is a *specification*, not confirmed behaviour. | Needs `pg_class.relrowsecurity`, `pg_policies` and `information_schema.columns` run against the live project and pasted back. Inferring it from the migration is the defect that has already produced two wrong rulings here (`schema-migration-drift`) |
| D2 | **The transport claim is doc-verified, not wire-verified.** | No `GEMINI_API_KEY` in this checkout. Recorded in the research ledger with that caveat |

## Verification owed

| # | Item | Measured how |
|---|---|---|
| V1 | **Rich résumé copy has never touched a real clipboard.** The unit tests prove both `text/html` and `text/plain` are set with the right payloads, each with a negative control — but nobody has pasted into Word or Google Docs. | `npx vitest run lib/clipboard app/components/preview app/components/DocumentPreviewDialog.copy.test.js` → 339/339. A real paste is the missing instrument |

## Standing hazards — re-read before trusting a number

- **An instrument here is defective until a constructed mutant kills it.** The author's own claim that a mutant
  dies is not evidence: one wave reported a kill in good faith and the real mutant survived, because the mutant
  tested was easier than the named one (ledger `T3-S9-3`).
- **A count beside a list it does not match** has occurred three times — a table heading, a column enumeration,
  and a ledger figure asserted as 4 where `grep -c "module:"` returns **5**.
- **A claim restated from another document is not verified.** Six false claims propagated here purely by
  restatement, each one grep-checkable. Run the grep with a canary before repeating a fact.
- **Ruling on a check's blockers alone silently drops its majors.** Nine majors once sat unrouted through three
  revisions because a ruling answered only the blockers, and everything downstream read the check as handled.
