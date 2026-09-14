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

**A blocked item is escalated once, not repeatedly.** Re-asking the same unanswerable question every turn is
spinning wearing a decision's clothes. Once surfaced, it stays listed and silent until the owner answers or the
blocker clears.

---

## Next — actionable now

| # | Item | Owed by | Measured how |
|---|---|---|---|
| 1 | **`SEC-1`: the engine-override fix, repo-wide.** A request-supplied `engine` overrides server config: `wantsEmbedded("gemini", { RESUME_ENGINE: "embedded" })` returns **false**, with control `("bogus", …)` → **true** proving the default *is* read for unrecognised values. An offline-configured deployment can be forced to spend on paid generation with the candidate's résumé. | Its own chunk — not yet started | `lib/llm/featureEngine.js:28` `wantsEmbedded(requested, env)`; its own header states the precedence — `1. An explicit per-request engine` **before** `2. The server default RESUME_ENGINE` (`:8-9`), and `:33` falls back to the default only when there is no explicit request. Owner ruling **O-14** |
| 2 | **Unswept regression modules.** Named rather than asserted clean by the step-9 sabotage pass: `io.js`'s `killTree`, `git`/`toplevel`, `spawnVitest`, `readVitestVersion`, walk/hash helpers, `createExclusive`/`appendExisting`/`rewriteInPlace`/`readLockText`; `launch.js` L3/L6/L7 beyond L1; `report.capEvidence`; `invoke`'s zero-tests case; `verdict.judgeRun`'s both-null case | A later sabotage pass | ledger `T3-S9-6`, `T3-S9-10` |
| 3 | **O-2 step 7 precedence is ambiguous** when both the `Test Files` and `Errors` lines hold. No fix round is scheduled. | A regression AC round | ledger `T3-C4b-6`, `T3-V6-6` |
| 4 | **Three 4b instrument minors, disclosed and unfixed.** `C4B-6` an import-extension regex fragility; `C4B-7` the reason-vocabulary CHECK canary drawn from the same source it validates (partially mitigated); `C4B-8` an outcome-check that asserts containment only | A later 4b round | `check-4b.r1.md` majors table; scoped out by `4b.r2.md` |
| 5 | **The K1-PROHIBITION corpus is held-out by instruction, not by construction.** `lib/interviewPrep/__fixtures__/predictionCorpus.js` sits in the implementer's own module directory; nothing prevents reading it. Proven discriminating today: a 10-string lookup-table build passes all 27 visible rows and ships both held-out sentences unrefused | A later hardening round — derive held-out members rather than store them | `4b.r2.md`; ruling `R-IP3-64` |

## Owner decisions outstanding

| # | Question | Why it is blocked |
|---|---|---|
| 1 | **RLS on the three new interview-prep tables cannot be verified here.** Supabase's URL is a placeholder, so every CHECK, policy and the `claim_prep_pack_slot` RPC is a *specification*, not confirmed behaviour. | Needs `pg_class.relrowsecurity`, `pg_policies` and `information_schema.columns` run against the live project and pasted back. Inferring it from the migration is the defect that has already produced two wrong rulings here (`schema-migration-drift`) |
| 2 | **The transport claim is doc-verified, not wire-verified.** | No `GEMINI_API_KEY` in this checkout. Recorded in the research ledger with that caveat |

## Verification owed

| # | Item | Measured how |
|---|---|---|
| 1 | **Rich résumé copy has never touched a real clipboard.** The unit tests prove both `text/html` and `text/plain` are set with the right payloads, each with a negative control — but nobody has pasted into Word or Google Docs. | `npx vitest run lib/clipboard app/components/preview app/components/DocumentPreviewDialog.copy.test.js` → 339/339. A real paste is the missing instrument |

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
