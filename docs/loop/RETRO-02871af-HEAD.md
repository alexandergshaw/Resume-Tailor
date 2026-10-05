# RETRO-02871af-HEAD — first cross-chunk retrospective

**Author:** loop-retro (fresh instance; not present for the work reviewed)
**Fired by:** BACKLOG "Next" drain — the N102/N103/N104/N105 batch + N106 reviewer + N107/N111 go-lives shipped and verified.
**Window:** `02871af..HEAD` (83 commits, HEAD = `bd45444`). Spans N105 (built first), N106 (shared reviewer), N103, N104, N102, N107/N111 go-lives, and loop-infra (SESSION-HANDOFF.md, the loop-retro role).
**Prior retro boundary:** none. `RETRO-roles.review.r1.md` is the retro-ROLE design review, not a chunk retro — not a window boundary.

**Optimization objective (owner directive 2026-10-04):** every recommendation's #1 aim is to LOWER TOKEN SPEND without sacrificing quality. Quality is a hard constraint. Defect-prevention usually also saves tokens (a defect caught at a check round = an extra terminating r2); those recs rank top because they do both.

**Instruments & blind spots:** evidence is `git log --oneline 02871af..HEAD`, `docs/loop/*` artifacts, `docs/SESSION-HANDOFF.md`, `docs/BACKLOG.md`, and `hello-world/lib/sourceScan/exportReachability.sweep.test.js`. Blind spot: orchestrator working-memory events (false stops, narrated-but-unlaunched dispatches) are only partly durable — they appear in git/handoff only when a *correction* was committed. A recurrence that was silently absorbed leaves no trace here; that under-counts R4 and R5.

---

## Recommendations (ranked: defect+token > token > effectiveness/token > evidence-caveated)

### R1 — AC seat must bind a completeness/provenance field on every status/verdict/coverage/"fixed" surface
- **Ready-to-file title:** "0e + loop-ac brief: any status/verdict/coverage/'fixed-clean-complete' surface requires a completeness-provenance field and a no-false-positive consumer criterion, authored at AC time."
- **Named control surface:** the `loop-ac` seat brief (the section that enumerates per-criterion power/honesty requirements) + a 0e risk-triage trigger ("does this chunk introduce or render a status/verdict/coverage/remediation-status surface?").
- **Concrete change:** when the trigger fires, the AC seat MUST author, up front: (a) a completeness/provenance field in the contract (e.g. `coverage{evaluatedCategories, engineMode, complete}`; for a remediation surface, an evidence-id correspondence), and (b) a criterion forbidding any consumer from presenting a partial/unverified state as clean/complete/fixed, with the breaking fixture named. The downstream check then only *verifies* this, instead of discovering its absence and forcing a terminating r2.
- **Objective + expected token magnitude:** PRIMARY token saving AND a defect-prevention (honesty floor) — the aligned case. In-window this class forced **3 terminating r2 rounds**, each an Opus re-author of a 40–55KB design/AC artifact plus a re-check: N106 AC r1→r2 (added `coverage`, ~17KB→53KB), the N105 experience r1→r2 cascade it triggered (coverage had to be forwarded + a `partial` band added — a cross-chunk re-work cascade from one missed field), and N104 design r1→r2 (pin+guard to kill the false-"fixed"). Preventing the class removes ~2–3 r2 rounds per occurrence going forward.
- **Quality (hard constraint held, in fact improved):** this is the honesty-of-status safety property itself — "no weaknesses"/"fixed" shown over unanalyzed or unverified content is the exact defect caught each time. Authoring it up front cannot lower correctness; it raises it.
- **Evidence (recurrence, 3 chunks, named):**
  - N106 AC check NEEDS REVISION — `33ed366`: "F1 embedded false-clean needs a coverage field in the contract" (SESSION-HANDOFF: embedded floor-clean but employer-implausible draft returns `{flags:[]}`, frozen shape had no coverage field → consumers render "no weaknesses" over an unanalyzed draft).
  - N105 G2 experience check NEEDS REVISION — `12fe95b`: "F-A … zero-flag renders 'No issues flagged' which N106 AC-17 forbids when complete===false (false on EVERY slice-1 invocation)." Same class, consumer side of the same field.
  - N104 grouped check NEEDS REVISION — `91af2da`: "F1 gap-closure id-drift (false 'fixed')"; fixed only by the r2 pin+guard, confirmed load-bearing in `docs/loop/N104.verify.r1.md` ("no false 'fixed' … pin + guard both load-bearing").
- **Proposed backlog disposition:** one item against `loop-ac` brief + the 0e trigger list; the brief edit and the trigger edit are each their own chunk, applied by the orchestrator.

### R2 — route the export-reachability census reconciliation into the chunk that adds the module (0e trigger + plan step)
- **Ready-to-file title:** "0e trigger: a chunk that adds an exported symbol/module must carry the exportReachability census delta in its plan + implementer brief, so the count edit lands in-wave instead of as a surprise-RED reconciliation round."
- **Named control surface:** a 0e risk-triage trigger ("new exported symbol or new module?") + the `loop-plan` seat's step list (add an explicit "reconcile `exportReachability.sweep.test.js` counts with stated delta" step for triggered chunks).
- **Concrete change:** on trigger, the plan enumerates the expected `TEST_REFERENCED` / `ORPHAN_EXPORTS` / `ALLOWED_UNREACHABLE_MODULES` delta and assigns the ledger edit to the feature wave; the implementer brief carries it. Do NOT weaken the exact-count assertion — it is a deliberate review-event forcing function (file header lines 71–82, 416–423).
- **Objective + expected token magnitude:** token saving by converting an unplanned reactive cycle into a planned in-wave edit. **Every module-adding chunk in the window forced a manual reconciliation** of the hardcoded counts (`expect(TEST_REFERENCED.length).toBe(391)`, `toHaveLength(66)`, `toHaveLength(14)`); at least one landed as a standalone chore round (`5958e11` "reconcile export-reachability ledger for the N105/N106 slice"). Saving ≈1 avoidable reactive cycle per module-adding chunk (5 in-window: N105/N106, N104, N104 D/E, N102, N107).
- **Quality (held):** the exact-count defect-catch (dead/unwired module with a green test — the three original findings) is preserved verbatim; only *when* the delta is computed moves earlier.
- **Evidence (recurrence, ≥5 chunks):** `hello-world/lib/sourceScan/exportReachability.sweep.test.js` reconciliation comments in-window — `368 → 386` (N105/N106 slice) with `70 → 67` orphans and `13 → 14` allowed-modules; `386 → 385` (N104); `385 → 386` (N104 D/E); `386 → 391` (N102); `67 → 66` (N107, LEVEL_CAPTIONS). Standalone round `5958e11`; inline in `05fc691` ("sweep 385/451"), `bd45444`. The file itself records several past deltas were mis-counted ("that comment was itself wrong (M2, fresh delta review)") — a reactive edit is also error-prone, so routing it in-wave with the delta pre-stated also reduces re-work.
- **Proposed backlog disposition:** one item against the 0e trigger list + `loop-plan` step template.

### R3 — pre-push BACKLOG render-currency gate (rendered BACKLOG.md must equal render(backlog.yml))
- **Ready-to-file title:** "Standing rule / pre-push check: never push a `docs(backlog)` commit whose BACKLOG.md is not a current render of backlog.yml."
- **Named control surface:** a standing orchestrator rule (loop-traps-orchestration standing rules) OR a `.claude/settings.json` pre-push/pre-commit hook; BACKLOG.md is generated (`<!-- GENERATED … DO NOT HAND-EDIT -->`), so a forgotten re-render or a flake-failed render ships stale durable state that step-0 reads.
- **Concrete change:** before any backlog push, re-run `render.mjs` and assert the working tree's BACKLOG.md matches; on a yamlLite failure, rewrite the file (tr -d CR / cp) and re-render before committing. A hook makes it mechanical.
- **Objective + expected token magnitude:** token saving (removes the re-render/correction round) + quality (honest durable reporting — a stale BACKLOG misleads the next session's step-0). Low-magnitude per event but recurs.
- **Quality (held):** no defect risk; strictly prevents a stale artifact.
- **Evidence (recurrence):** `c21547e` "re-render BACKLOG.md … prior commit shipped a stale render; yamlLite flake"; `493868a` "rename suffixed ids … fixes yamlLite/renderMarkdown schema tests"; `e82cd33` files N114 (the flake itself); SESSION-HANDOFF tooling note (2026-10-04): render.mjs failed with a yamlLite line-44 error on a byte-identical backlog.yml.
- **Relation to N114:** N114 proposes *fixing the yamlLite flake*. R3 is the complementary *process backstop* (render-not-verified-before-push) that also catches a forgotten re-render even after the flake is fixed. File as a sibling of N114, not a duplicate.
- **Proposed backlog disposition:** one item; prefer the settings.json hook form so it fires without the orchestrator remembering.

### R4 — a "dispatched/running" handoff line is invalid without the agent ID it claims to have launched
- **Ready-to-file title:** "SESSION-HANDOFF format rule: every 'DISPATCHED/running' line must carry the agent ID returned by the Agent call; a dispatch claim with no ID is not a dispatch."
- **Named control surface:** the SESSION-HANDOFF.md format contract (its §2 "mid-flight waves / active dispatches" convention) — and the `stated-plan-vs-executed` memory rule that FAILED to fire here (the orthogonality-permitted "cite the memory that failed, recommend the structural change that makes it fire").
- **Concrete change:** the handoff template requires an agent ID (e.g. `a16b0a450b51d775e`) on every "running/dispatched" entry — exactly the shape the N83/N105 entries already use. An entry with no ID is, by rule, a *plan*, not an executed dispatch. This makes a false "running" claim structurally impossible to write truthfully.
- **Objective + expected token magnitude:** effectiveness→token. A false "running" claim means work the orchestrator believed was in flight was never launched → a wasted cycle + a correction commit + the risk of a blocked wave stalling. Measured cost: `0564eec` "correct a false 'N106 structure r2 running' claim — it was never dispatched", and the SESSION-HANDOFF CORRECTION block naming it the "stated-plan-vs-executed trap."
- **Quality (held):** no code-path effect; improves honest reporting and reduces stalls.
- **Evidence:** one clear in-window instance (`0564eec` + handoff CORRECTION) = measured cost. The `stated-plan-vs-executed` memory rule's existence attests the class recurs beyond the window; the structural fix is what the prose rule has not delivered. (Blind spot: silently-absorbed instances leave no git trace.)
- **Proposed backlog disposition:** one item against the SESSION-HANDOFF format section; small.

### R5 — mechanical Stop-hook enforcement of the never-stop rule (EVIDENCE-CAVEATED; loop-top to corroborate)
- **Ready-to-file title:** "Add a `.claude/settings.json` Stop hook that blocks a turn-end whose last tool call was not an Agent dispatch (backlog-empty excepted)."
- **Named control surface:** `.claude/settings.json` Stop hook (none exists today — `.claude/settings.json` has no hook entry) + the `never-ask-to-continue` memory rule that keeps failing to self-enforce.
- **Concrete change:** a Stop hook that inspects the turn's final tool call and refuses the stop (or re-prompts) unless it was an Agent dispatch or the backlog is empty — the one surface that enforces the rule unconditionally rather than relying on the orchestrator re-reading a prose rule every turn.
- **Objective + expected token magnitude:** a false stop costs a wasted turn and a cold re-engagement (the user must nudge; context reload is expensive). A hook that holds the invariant removes those.
- **Quality (held):** no defect risk; a hook only prevents a premature stop.
- **Evidence (CAVEATED — why this is R5, not higher):** I could NOT corroborate an in-window false-stop from the durable record (git log, SESSION-HANDOFF show none). The owner's task names it "the never-stop rule's 5th instance," but a launching-agent message is a pointer, not durable evidence, and false stops live in orchestrator/chat memory, not git — my structural blind spot. The recurrence is attested only by the `never-ask-to-continue` memory rule's existence and escalating mechanical specificity. **Disposition for the reviewer:** a lost turn is recoverable (not high-severity), so on in-window evidence alone this does not clear the power bar; I surface it because the loop-top CAN see chat history and should corroborate the 5th instance before filing. If corroborated, it is high-value (defect-prevention of a recurring loop-health failure the prose rule cannot hold).

---

## Examined and judged NOT worth a change (with reason)

- **Round-count of NEEDS-REVISION checks (8 in-window).** Eight terminating r2 rounds (N105 structure, N105 G2 experience, N105 plan, N106 AC, N106 structure, N106 plan, N104 grouped, N103 grouped) is the dominant token spend — but the two-round cap worked as designed each time (every r2 was terminating; no third round). The admissible slice is the *recurring finding class* (R1), not the mechanism, which is healthy. No change to the cap or the check structure.
- **N114 yamlLite flake itself.** Already filed (`e82cd33`). I do not restate it; R3 adds only the complementary process gate.
- **N115 R-4 opt-in-dead (documentLevelMissingKeyword/classHints built, tested, no consumer).** A single occurrence (`f8c704f`, `e318540`), correctly caught by the N104 verifier and the export-reachability sweep, correctly deferred as cross-cutting. The detection worked; no loop change warranted. (It is, separately, a live example of why R2's sweep must keep its exact-count teeth.)
- **Disjoint-subagent / wave-gating discipline.** The N105/N106 parallel waves and the "full suite is orchestrator-owned; implementers run only touched files" rule held — no implementer-stall or shared-tree collision recorded in-window. Memory `disjoint-subagents` and the SESSION-HANDOFF standing hazard are firing. No change.
- **CITED-SUBAGENT line-ref re-grep burden.** The structure checks re-grepped cited refs (e.g. docx.js:68, strategy.js:614) and several were stale — but this is the checker doing its job, caught cheaply, and the memory `loop-traps-search` already governs it. No new surface; would reduce to "remember to re-grep," which is already covered.
