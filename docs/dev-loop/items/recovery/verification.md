# Independent recovery verification

Verifier `/root/recovery_baseline`, 2026-10-16. I authored neither the checked fixture corrections nor the criteria/plans. **The complete offline diagnostic obligation passes through source-bound aggregate evidence.** This is not a claim that one fresh whole-suite invocation passed: the original full run failed six cases, corrected affected cases were rerun, and independently checked call-path analysis permits reuse of unaffected passes. Concrete provider enablement and final repository delivery remain separate obligations.

## Candidate and freshness

Accepted criteria: `contracts.md` C1–C8, SHA256 `fa739d7cab09b2380310c1a8a3505884416fdba4521f26a312b8c67228d9b8bb`; independent acceptance in `contracts.check.md`. Implementation and bounded reuse acceptance: `implementation.check.md`. Actual two-file diff and surrounding helpers were read independently before execution.

The original 69-entry source/configuration/package manifest is `.agnostic-loop/recovery/baseline/source-before.json` (SHA256 `1763E8704A161FEDEF731D6CCFD3B6462523B63E69772EF96DFC9696902185B8`), bound initially to HEAD `ff3db6414762719aba151bf89748fae42e0c436a`. Exactly two manifest entries differ in the current candidate:

- `supervisor-repair-fixtures.ts`: `ef34f0c424cce61151e155c82de9366179ee22c12cdf4bbdd7e2a0cb3288477e` — only non-gate completion optional chaining and bounded pause-contention retry.
- `supervisor-repair-mutation.test.ts`: `cc3a5df7dc3e121cc27051bccfe1ffd5ec8a80626331df122bae19505d6e03da` — finite observation ceilings only; behavioral seams/oracles unchanged.

All production runtime, application, dependency declarations and dispatch configuration bytes are unchanged. Current 69-entry manifest: `.agnostic-loop/recovery/verified/source-final.json`, SHA256 `EF4A4D4818E9FD7373A81C7B45C0EF5CC764CACE455E521AD0855C70EA92C590`. All entries matched fresh-run initial bytes at final check11:40:07-05:00. Changes after this point require affected-evidence reassessment. Documentation-only finalization does not change these behavioral inputs.

Conditional reuse is narrow: modified fixture code occurs only inside `nonGateControl`; it is not called by reused R1–R5, missing/corrupt, bounded diagnostics, wrong-item or checkpoint/budget mutation helpers. Non-gate invalidation already establishes the item before the shared completion predicate; optional chaining is equivalent on that observed path. The mutation test's larger finite ceilings do not alter the already successful checkpoint/budget executions. `implementation.check.md` independently accepted this mapping. No historical failure is counted as success.

## Commands and actual results

All commands ran at the repository root with installed Node 22.14.0/Vitest 4.1.8; no install or network provider call. Node sandbox escalation was needed for OneDrive path `EPERM`. Existing per-child10-second and fixture600-second authority limits remain unchanged. Fresh invocations were serialized, one fork, no concurrent test cases; each completed within the two-hour invocation budget.

| Instrument | Actual terminal outcome | Evidence |
| --- | --- | --- |
| Full dispatch: `node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.dispatch.config.mjs --fileParallelism --maxWorkers=2 --reporter=verbose` | Exit1; 8 files,37 pass/6 fail, 43 total;3182.41s | `baseline/verbose.log`, `baseline.md`; failed baseline retained. |
| Corrected controls: `node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.dispatch.config.mjs tools/agnostic-loop/supervisor-repair.test.ts --no-file-parallelism --maxWorkers=1 --reporter=verbose --testNamePattern 'non-gate (review\|provider\|paused) remains'` | Exit0;3 pass, 12 selection skips;663.15s | `verified/non-gate.log`; review229257ms,paused217264ms,provider216086ms. |
| Pause comparison: `node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.dispatch.config.mjs tools/agnostic-loop/supervisor-pause.test.ts --no-file-parallelism --maxWorkers=1 --reporter=verbose` | Exit0;1 pass;25.87s | `verified/pause-comparison.log`. |
| Corrected mutation controls: `node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.dispatch.config.mjs tools/agnostic-loop/supervisor-repair-mutation.test.ts --no-file-parallelism --maxWorkers=1 --reporter=verbose --testNamePattern 'reentry:\|diagnostics-verification:\|diagnostics-final-report:'` | Exit0;3 pass, 2 selection skips;2943.26s | `verified/repair-mutations.log`; reentry828046ms,verification986135ms,final-report1128319ms. Each includes original/comment/intended behavioral red/restored plus exact original/copy hashes. |
| `npm.cmd run loop:test` | Exit0;20files;151 pass,2existing skips;366.06s | `verified/core.log`, mandatory engine/manual-port gate. |
| `node tools/repository-gate.mjs backlog` | Exit0; fresh render matches;159 items, 0 violations | `verified/backlog.log`. |

Evidence paths in this report are under ignored `.agnostic-loop/recovery/`. Result JSON files record actual exits/end timestamps. No empty RUN banner is treated as a completed measurement. Shard skips are explicit selection exclusions whose obligations are covered by the aggregate below, distinct from the two environmental core skips.

## Exhaustive configured dispatch inventory

Machine-readable `.agnostic-loop/recovery/verified/test-inventory.json` contains every exact case name, file, baseline duration, current evidence source and current duration: **43 cases exactly**, SHA256 `D428394D119B63AC93B1FDA47C0796132C0B8396F931AF21AA1E2CA65E828C4D`. The aggregate has 43 passed obligations, with 36 retained baseline passes and 7 fresh passes (one fresh comparison replaces an already passing baseline case). It is not 43 fresh tests.

| Selected file | Complete cases | Accepted evidence |
| --- | ---: | --- |
| `dispatch-entry.test.ts` |4| Baseline: setup, explicit workflow validation, public CLI+actual MCP complete role loops, compact status. |
| `supervisor.test.ts` |3| Baseline: checked local lifecycle, two-round restart checkpoint, pause/uncertainty. |
| `supervisor-admission.test.ts` |2| Baseline: spawn/pre-PID crash recovery, rejected native credential cleanup. |
| `supervisor-lifecycle.test.ts` |8| Baseline: inbox/replay, token/unowned writes, observed settings, pause/cancel, pending-launch uncertainty, cancel/integrity/deadline termination. |
| `supervisor-mutation.test.ts` |5| Baseline: launch,qualification,admission,revocation,reservation, each four controls. |
| `supervisor-pause.test.ts` |1| Fresh comparison pass. |
| `supervisor-repair.test.ts` |15| 12 retained baseline passes: R1,R4,R2,R5verification,R3,R5final-report,missing,corrupt,non-gate invalidation,long output,admission,wrong-item; 3 fresh review/paused/provider passes. |
| `supervisor-repair-mutation.test.ts` |5| 2 retained checkpoint/budget four-control passes; 3 fresh reentry/diagnostics-verification/diagnostics-final-report four-control passes. |

## Criterion-to-evidence judgment

| Criterion | Judgment and measured evidence |
| --- | --- |
| C1 | **Pass offline.** Baseline CLI+actual MCP public lifecycle, fixed-policy/malformed source checks, supervisor local delivery and fresh mandatory transport/conformance suite. Fixture identities are protocol controls, not independent semantic model judgment. |
| C2 | **Pass.** R1 positive257809ms and fresh R1 mutant four controls; R4 checkpoint137571ms and retained checkpoint mutation558542ms establish persistent reentry/diagnostics/read-only status behavior. |
| C3 | **Pass.** Actual failed verification283696ms and final-report336366ms repair cases establish output-dependent repaired current-candidate delivery; actual exhausted outcomes178858ms/223458ms retain activity budget. Fresh R2/R3 mutant controls and retained budget mutation710857ms prove the oracles detect designated defects. |
| C4 | **Pass offline.** Missing168642ms/corrupt173880ms reject; long-output166381ms validates UTF-8 cap, truncation, credential canary redaction and packet-hash binding; admission161571ms includes diagnostic bytes; wrong-item397369ms excludes unrelated failure. All four non-gate paths have current evidence, three fresh plus retained invalidation262363ms. |
| C5 | **Pass for measured fixtures.** Lifecycle/admission/watcher cases plus both fresh pause controls establish no new admission, fenced publication, uncertainty/reservation preservation and actual child termination controls. Final host inventory has no observed owned process/descendant. No arbitrary third-party process-tree guarantee. |
| C6 | **Pass.** All 10 designated mutation families have original/comment/intended behavioral invariant red/restored controls and exact source/copy hash assertions. Original timeout-only failures received no defect-detection credit and were replaced by successful fresh controls. |
| C7 | **Pass subject to independent acceptance of this report.**69-entry manifests, exact two-file delta/call mapping, exhaustive43-case inventory, completed logs/exits and named limits bind offline readiness. No replacement readiness engine introduced. |
| C8 | **Offline restrictions pass; final delivery pending.** Changed files are test fixtures/timing/docs only; no target/grant/provider configuration enabled, paid call/install/login/deployment performed. Mandatory core/backlog pass. Current report checking, final report acceptance, commit/push and live `loop:delivery` proof are coordinator-owned remaining steps. |

## Process reconciliation, evidence integrity and remaining limits

Final recursive inventory at11:40:07-05:00 reports zero known PIDs, zero live descendants and zero Node fixture/Vitest run processes (`verified/processes-final.json`). Fresh dispatch snapshot also had no fixture processes before core admission. Source ownership is released; no admitted test operation remains running or uncertain. Baseline timeout fixture roots remain preserved read-only as described in `baseline.md`; no shared lock or historical root was blindly deleted. Existing hooks cleaned fresh fixture/mutation copies.

Primary fresh log SHA256 values: non-gate `7060C06054E73C95F805ACB2C1F275AAB050E6F555CFBAB03A1D3422025723A9`; pause `6E7B155C57526043BE371BA392B55FC471887365061812F46A54371F03F33810`; mutations `ECDA3F0E3DAAF64F3D84D40782411B8E716085AAB23286E0ED9E278122C807FA`; core `BC50FC3D724B7F6BA52DEF1F57AF8D464232614E69B3C0164D05B2C831075F68`; backlog `D8D93FA18CD6CD4D365798E65F49F6D6153B9402F6B33E4D25122B5871A90A56`. Baseline log hash and all original failures remain in `baseline.md`.

The core's two unchanged Windows `store.test.ts` escaped/symlink branches require privileged symlink capability; those branches remain unproven, owned by the repository operator with a privileged Windows rerun as instrument. Current offline fixtures do not prove live provider authentication/model access/semantic judgment, arbitrary provider process-tree isolation or external side effects. Those remain with the operator's explicit provider qualification/authority workflow; providers remain disabled/unqualified.

Per coordinator gate ruling, no fresh application full regression/lint/build was required for these exactly two test-only files and documentation: production/app/package/configuration are unchanged. Those commands were **not rerun**; historical app passes are not represented as fresh evidence. No standalone typecheck gate was invented. Overall repository delivery is still pending final acceptance and successful live remote confirmation for the eventual exact commit.
