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
| N2 | **O-2 step 7 precedence is ambiguous** when both the `Test Files` and `Errors` lines hold. No fix round is scheduled. | A regression AC round | ledger `T3-C4b-6`, `T3-V6-6` |
| N3 | **Three 4b instrument minors, disclosed and unfixed.** `C4B-6` an import-extension regex fragility; `C4B-7` the reason-vocabulary CHECK canary drawn from the same source it validates (partially mitigated); `C4B-8` an outcome-check that asserts containment only | A later 4b round | `check-4b.r1.md` majors table; scoped out by `4b.r2.md` |
| N4 | **The K1-PROHIBITION corpus is held-out by instruction, not by construction.** `lib/interviewPrep/__fixtures__/predictionCorpus.js` sits in the implementer's own module directory; nothing prevents reading it. Proven discriminating today: a 10-string lookup-table build passes all 27 visible rows and ships both held-out sentences unrefused | A later hardening round — derive held-out members rather than store them | `4b.r2.md`; ruling `R-IP3-64` |
| N5 | **Three named contract functions have no test and no implementation.** `packRenderState`, `packIsStale`, `shouldStartPrep` are named by `design-structure.r1.md` §3 but no 4b row exercises them, so step-5 wave 1 correctly declined to build them against a guessed row shape. A coverage gap in 4b, not an implementation gap | A 4b round, then the wave that owns them | `prepContract.js`'s own comment names the gap; step-5 wave 1 report |
| N6 | **`launch.js` L7's `lockedIds` guard is unswept** — no faithful dangerous mutant was found for it. Named, not asserted clean | A later sabotage pass | `sabotage.r2.md` |
| N7 | **`prepLog.js` was built with no specifying document and no test.** 86 lines, created because the wave table needs the file to exist for a later mechanical gate and the UI wave. Its export shape is invented, and nothing exercises it — the same class wave 1 correctly refused for three other functions | A 4b round before it carries behaviour | `lib/interviewPrep/prepLog.js` header discloses it; step-5 wave 2 report |
| N8 | **The prep prompt does NOT send the résumé or cover letter.** `route.js` writes `resumeId`/`coverLetterId` as `null` and generates from the posting text plus the digest only, because no binding document names a résumé/cover-letter store. **Two consequences**: answers are not tailored to the candidate's actual material, which is the feature's point; and **O-12's disclosure says the résumé and cover letter are sent**, so the notice currently over-states what leaves the app | A design round to name the store, then the wave that wires it — **and IP-N re-checks the notice text against what is actually sent** | `app/api/interview-prep/route.js` header discloses it; owner ruling **O-12** |
| N11 | **O-7's digest-ensure forwards the caller's cookie** in a server-to-server fetch, because no existing helper does this. Security-relevant and unreviewed | A security review round | disclosed in `route.js`'s header |
| N13 | **Two of the five B1 trigger sites are inert.** `generateWithReviewedValues` (`app/page.js`) and `runWorker` (`app/hooks/useManualPostings.js`) call `startInterviewPrepResearch` with **no resolvable `applicationId`** — `tailorPosting`'s return carries only `jobId` — so `prepTrigger.js`'s blank-id refusal fires and nothing happens downstream. The landed seam tests assert the *call*, which is made, so they stay green. **Three of five manual-tailor paths work; two do not.** | A wave that threads the application id through the tailor return, or a design round that decides it cannot be | `plan.r1.md` §4 names this as an unresolved tracing gap; the step-5 waves 8/9 report documents both call sites and the reliance on the blank-id refusal |
| N15 | **A tracking row cannot open the preview/edit window.** Owner request, 2026-09-14. `app/components/tracking/ApplicationCard.js` gives each row `JD` (`:178`) and `Resume` (`:181`) buttons, but both open `AppViewDialog` with a `kind`, which is a **read-only view** — not `DocumentPreviewDialog`, the window that carries editing, the rich-copy path, filename control, download and Save-to-Drive. That dialog is mounted once by `app/components/DocumentPreviewMount.js` and driven by the `preview` state of the main tailoring flow, so it is reachable only by tailoring a posting in this session: a row tailored on a previous visit has no route to it at all. **What is owed**: a per-row action on the tracking table that opens `DocumentPreviewDialog` for that row's tailored résumé and cover letter. **Two things a design round must settle before code**: (1) the dialog is a single long-lived mount reading one `preview` object — opening it for an arbitrary row means either populating that state from the row or giving the mount a second entry point, and which one is correct is not derivable from the current code; (2) the stored-document source for a row is the same unnamed résumé/cover-letter store that **N8** is blocked on, so if the row's documents are not already in hand this item inherits that blocker. **Constraint**: the standing minimize-clicks directive applies — one action with good defaults, not a menu then a picker | A design round settling the mount's second entry point and the row→document source, then the wave that builds it | `app/components/tracking/ApplicationCard.js:178`, `:181` (the two existing read-only row buttons); `app/components/DocumentPreviewMount.js` (single mount, driven by the tailoring flow's `preview` state); `app/components/DocumentPreviewDialog.js` (the window owed); coupled to **N8** for the document source |
| N16 | **The Gemini path writes `status: '''ready'''` with a pack shape the live CHECK rejects — so the feature'''s MAIN path cannot reach a terminal state either.** `interview_prep_packs_ready_is_complete` (confirmed on the live project 2026-09-14, no drift) requires `pack->'''sections'''` to carry ALL FOUR of `aboutYou`, `whyRole`, `askThem`, `stages`, each resolving to a NON-EMPTY array at the paths the migration names. But `buildPrepPrompt` (`route.js:233`) asks the model for `{"tellMeAboutYourself": string, "whyThisPosition": string, "questionsToAsk": string[], "sections": {"stages": [...]}}` — three of the four live at TOP level under different names, and `sections` carries only `stages`. The `ready` write at `route.js:448` therefore violates the CHECK on every successful generation. **Verified independently, not restated**: prompt shape read at `route.js:233`, write status at `:448`, CHECK text from the live `pg_constraint` dump. **This is the same class the embedded path just had** — embedded was resolved by writing `'''partial'''` (owner ruling, honest about what a no-LLM backend produces), but Gemini is the path that is SUPPOSED to produce a complete pack, so writing `'''partial'''` here would be hiding the defect rather than fixing it. **The fix is a prompt/parse reshape**: ask for the four named sections, parse them into `sections.{aboutYou,whyRole,askThem,stages}`, and keep `normalizePack`'''s K1-SHAPE/K1-PROHIBITION stage handling working across the new shape. Note `normalizePack` today only normalizes `sections.stages`; three new sections would be unnormalized unless the reshape covers them — a grounding hole, not just a shape change | A design round naming the four-section pack contract (prompt, parse, and what normalizePack must cover), then the wave that builds it | `app/api/interview-prep/route.js:233` (the prompt'''s requested shape), `:448` (the `ready` write); `supabase/migrations/20260914000000_interview_prep.sql` `interview_prep_packs_ready_is_complete`; `lib/interviewPrep/prepParse.js` normalizePack covers `sections.stages` only |
| N17 | **Voice enrollment: identify the candidate'''s own voice from an uploaded sample of them reading an app-provided passage.** Owner request, 2026-09-14. **Scope is narrower than it sounds, and the survey is why**: for a REMOTE interview the app already separates the two voices by CHANNEL — `lib/copilot/capture.js` takes the candidate'''s own voice from `getUserMedia` (mic) and the other party'''s from `getDisplayMedia` (tab/system audio), so enrollment adds nothing there. The case that actually needs this is the **SHARED MICROPHONE / in-person** session, which is exactly what `lib/copilot/speakerIdentity.js` exists for today — and it identifies the candidate BEHAVIOURALLY (word share, question detection, confidence gates), not by voice. **The motivating failure is already documented in that file'''s header**: v1 scored on word share alone and elected the INTERVIEWER as the user at '''high''' confidence on two real interview openings, after which the copilot stopped evaluating their speech for questions and went **silently deaf for the rest of the session** — the file calls this the worst failure mode the feature has, because the user cannot tell it happened. A voiceprint replaces a heuristic that is known to fail silently, which is the strongest case for building it. **THE FEASIBILITY CRUX, unresolved**: diarization as wired today (`lib/copilot/stt/index.js`, Deepgram and ElevenLabs Scribe) yields ANONYMOUS speaker tags (`speakerTag` = provider-assigned id), never an identity — binding tag→person needs either provider-side speaker enrollment/verification or a locally-run speaker-embedding model, and NEITHER is confirmed available on the current providers. That question must be settled at primary source BEFORE any UI is designed, or the enrollment flow gets built against a capability that does not exist. **Why an app-provided passage is the right call** (the owner asked for it and it is correct): a known transcript gives phonetic coverage, lets the app verify the upload is actually someone reading THAT passage rather than arbitrary audio, and supports a quality gate (too short, too noisy, clipped) before a bad enrollment silently degrades every later session. **A voiceprint is BIOMETRIC data** — distinct from the recordings the copilot already stores — **OWNER RULING, 2026-09-14: storing the candidate'''s voice is PERMITTED, provided they are made aware of it and consent.** That settles whether the feature may exist. Three things it does NOT settle, and a design round must: (a) what deletion looks like — consent to store is not consent to keep forever, and the copilot already ships a delete control precedent (O-16'''s per-application delete) rather than a tombstone; (b) whether the consent is one-time at enrollment or re-surfaced, and where the disclosure actually appears — this repo has already shipped a disclosure that OVER-STATED what left the app (see N8), so the notice text must be checked against what is actually sent; (c) **conditional, and only if the research round finds provider-side enrollment is the ONLY feasible path**: consent to the APP storing a voiceprint is not obviously consent to transmitting it to a third-party STT vendor, which is a separate egress the owner should rule on once it is known to be necessary | A 3b research round settling provider speaker-ID/enrollment support at primary source and an owner ruling on biometric storage, THEN a design round, THEN the wave that builds it | `lib/copilot/speakerIdentity.js` header (the behavioural identifier this replaces, and its silently-deaf failure); `lib/copilot/capture.js:4-12` (channel separation already solves the remote case); `lib/copilot/stt/index.js:117-137` (`speakerTag` is provider-assigned and anonymous; `diarizationActive`); `lib/copilot/answerSpeakers.js` header (the no-tag-means-candidate compatibility rule any change here must preserve) |

## Owner decisions outstanding

| # | Question | Why it is blocked |
|---|---|---|
| D2 | **The transport claim is doc-verified, not wire-verified.** | No `GEMINI_API_KEY` in this checkout. Recorded in the research ledger with that caveat |

## Verification owed

| # | Item | Measured how |
|---|---|---|
| V1 | **Rich résumé copy has never touched a real clipboard.** The unit tests prove both `text/html` and `text/plain` are set with the right payloads, each with a negative control — but nobody has pasted into Word or Google Docs. | `npx vitest run lib/clipboard app/components/preview app/components/DocumentPreviewDialog.copy.test.js` → 339/339. A real paste is the missing instrument |
| V2 | **N12'''s lockdown migration has never been applied or run.** `supabase/migrations/20260915000000_interview_prep_spend_lockdown.sql` converts `claim_prep_pack_slot` to `SECURITY DEFINER` with an explicit ownership check and revokes `authenticated`'''s write privileges on `interview_prep_spend`. Every claim about it is a **source-text claim about SQL that has never executed** — no Supabase project is reachable from this checkout (placeholder `NEXT_PUBLIC_SUPABASE_URL`). Until it is applied, the client-resettable `attempts` hole is still OPEN in production, and the conversion carries its own risk: if the function'''s owner is not the table owner, or `relforcerowsecurity` is set on the table, `SECURITY DEFINER` does NOT bypass RLS — the migration hedges by re-stating the two spend policies rather than dropping them, but which world the project is in cannot be seen from here | Apply the migration, then run: (1) `select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='''public''' and p.proname in ('''claim_prep_pack_slot''','''record_prep_model_call''');` — expect `prosecdef=true` for both and a pinned empty `search_path`. (2) `select grantee, column_name, privilege_type from information_schema.column_privileges where table_schema='''public''' and table_name='''interview_prep_spend''' and grantee='''authenticated''' and privilege_type='''UPDATE''';` — expect ZERO rows; `role_table_grants` alone does NOT show column privileges, so this is the query that proves the revoke landed. (3) `select p.proname, p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='''public''' and p.proname in ('''claim_prep_pack_slot''','''record_prep_model_call''');` — `proacl` must contain no entry beginning `=X/` (that is PUBLIC'''s execute). (4) **THE DECIDING QUERY, absent from the D1 set**: `select c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='''public''' and c.relname in ('''interview_prep_spend''','''interview_prep_packs''');` — DEFINER only bypasses RLS if `relowner` matches the function owner from (1) AND `relforcerowsecurity` is false. (5) The only instrument that proves N12 CLOSED rather than described: with a real signed-in user'''s JWT, `PATCH /rest/v1/interview_prep_spend?application_id=eq.<own id>` body `{"attempts":0}` must return 403 / SQLSTATE 42501, **and** a subsequent claim from that same user must still succeed. Both halves are required — the first proves the revoke landed, the second proves the conversion did not break claiming |

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
