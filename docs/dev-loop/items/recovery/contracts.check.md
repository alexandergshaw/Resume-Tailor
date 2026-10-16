# Independent recovery contract check — round 1

Checker: fresh worker `/root/recovery_check`, 2026-10-16. This worker did not author the contract. Reviewed `docs/dev-loop/items/recovery/contracts.md`, SHA-256 `23b85e4dc1e9510621505a3788d0681bcb3271a14031993d09bdfa97f538f8b8`, together with repository `AGENTS.md` and the dispatch inventory configuration. No source changes or test execution were performed in this check.

Verdict: **changes required for one scope finding**. The existing offline verification and baseline measurement may proceed; implementation should consume the corrected contract after independent delta acceptance.

## Finding

**P2 / NEW / mandatory-additive-readiness-scope.** The coordinator assignment makes source-bound readiness evidence optional and explicitly excludes building a new qualification engine. The contract's opening readiness claim and unconditional C7 instead require a new repository-local command/gate and an independent readiness test family before the recovery obligation can close. Existing dispatch configuration only defines offline diagnostic coverage and warns against live qualification. These requirements can turn completion of retained recovery verification into a new product that blocks delivery without being needed to measure R1–R5. Correct by making C7 conditional on a coordinator-selected, bounded readiness helper, with offline diagnostic completion and current evidence sufficient to close the retained offline obligation; alternatively the coordinator may explicitly authorize that additive scope and give it exact owned paths and budget. Keep any helper strictly separate from provider enablement or live qualification.

Stopping point: **coordinator scope ruling or contract revision**, then one independent delta check if revised. No owner spending/model decision is needed to perform the authorized offline work. This is review round 1 for this contract activity; retain its history.

## Accepted scope and measurement expectations

C1–C6 and C8 define observable offline success, actual failed-gate repair, fresh checking, round preservation, diagnostic integrity, cancellation/uncertain-operation accounting, isolated mutation controls and disabled providers. The finite two-hour initial assumption does not weaken existing test limits and appropriately avoids treating the earlier 30-minute interruption as a verdict. Exhaustive per-file aggregation is permissible with complete inventory and reconciled child operations. Source/configuration changes must invalidate affected baseline evidence. Test success is not live-provider qualification or reliable arbitrary third-party process-tree termination. Main delivery requires the independent final report, scoped commit, normal push and live delivery guard.

No additional blocker identified in this bounded contract review. Exact implementation write sets remain a prerequisite of implementation admission as already required by the contract; the broad surface list itself grants no unrestricted edits. Final evidence still needs actual measurement and independent candidate verification.

## Round 2 — independent delta acceptance

Reviewed revised contract SHA-256 `fa739d7cab09b2380310c1a8a3505884416fdba4521f26a312b8c67228d9b8bb`. Verdict: **accepted**. The opening and C7 faithfully implement the coordinator ruling: source-bound report, exhaustive command/test inventory and complete observed evidence are required; a new executable readiness gate is optional and requires demonstrated need. A new qualification engine is explicitly unnecessary. Offline evidence remains separate from paid provider qualification and enablement authority.

The sole round-1 class `mandatory-additive-readiness-scope` is resolved. No new blocker found in this delta. Stopping point: **nothing** for contract acceptance; proceed with actual offline measurements, scoped defect repair if demonstrated, and independent candidate/final verification. This acceptance is not a test or delivery verdict. Retain the round-1 review above as history; no additional confirmation round is needed.
