# Independent gate-aware deadline verification

Verifier `/root/dispatch_verify`, independent of the production/test author and
implementation checker, 2026-10-16. **PASS D1–D4 for the measured offline candidate
and narrow unchanged-path evidence mapping below, subject to independent acceptance
of this report.** This report issues no qualification, configuration, production
grant, live model call or delivery claim.

## Candidate, instruments and immutable evidence

Base HEAD `7bb3f97ef0042a484d692d71bd031ed8062735b4`; production
`supervisor-process.ts` SHA256
`969bb65a8d54c094e1f3caabaa07f10fba55213207e48441c622e9a13297b7ff`;
`supervisor-deadline.test.ts`
`0bb5e0e7c203ed87b4147fba4b68c339424b2fbf78823c5a820243775958abd3`.
Read actual complete diff and surrounding supervisor, runner, engine expiry,
import, fixtures and diagnostic assertions. Accepted inputs are
`deadline-plan.md`, `deadline-plan.check.md`, `deadline-implementation.check.md`,
and `retention-overlay.check.md`. Root admitted a finite two-hour offline window
at 1792179598091, ending 1792186798091; all measurements completed inside it.

Evidence below lives under ignored
`.agnostic-loop/backlog-dispatch/verification/`. Exact root-bound evidence index
`evidence-index.json` SHA256
`c1eb12e67ed20408596929a98027a87f8a08cee7a1bb619c55bbb8b233bdfa22`
enumerates **543 actual files**, each with its raw SHA256; it does not self-hash.
It binds actual command logs/results, instruments, controls/copies, imports,
resource snapshots, source manifests and the exact case inventory. No future
files or inferred results are included. `finalization.json` records completed
gates and the finite admission bound; it is evidence, not engine acceptance.

The 72-entry source/package/configuration manifest is unchanged before versus
after execution (entry-by-entry comparison, not equal JSON serialization bytes).
Before manifest SHA256
`f2f44504b840a654002543cff4de5bc2856748360ec8aaa744e2dc3d1ce1b19e`;
after `8f0acbd7c192a41dae76e37b5056f8372da105427f9d2dec3b7dd68fdf02ffd0`.
Three additional original/copied backlog import dependencies are separately
byte-bound by `archive-import-repair.json`. No shared production/test source was
mutated. Retained runtime copies changed only the independently accepted cleanup
seam: preserve actual fixture roots instead of deleting them after tests.

## Commands and observed terminal outcomes

All commands ran at repository root with installed Node 22.14.0/Vitest 4.1.8,
authorized escalated execution for existing Windows filesystem/process restrictions,
no install/network provider use. Diagnostic commands used one worker, no file
parallelism, real subprocess timers and unchanged test assertions.

| Producing command/instrument | Actual outcome |
| --- | --- |
| `node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.dispatch.config.mjs tools/agnostic-loop/supervisor-deadline.test.ts --no-file-parallelism --maxWorkers=1 --reporter=verbose` | Exit0; **6 passed**, 326.87s; `focused.log`. Actual pre-provider gate130015ms, post-provider97036ms, genuine expiry99276ms. |
| `node --experimental-strip-types --experimental-default-type=module --experimental-loader ./tools/resolve-ts-hook.ts .agnostic-loop/backlog-dispatch/verification/arithmetic-oracle.mjs` | Exit0; **63,504** independently constructed exact BigInt combinations match `min(policy, routing, now + provider + 30000 + gateTimeout * count)`, including safe-integer boundaries. |
| `node .agnostic-loop/backlog-dispatch/verification/mutations.mjs` | Exit0 overall; six isolated control runs have intended outcomes, detailed below. |
| `npm.cmd run loop:test` | Exit0; **20 files,154 passed,2 existing Windows skips**, 358.34s; `core.log`. |
| Vitest dispatch archive config, files `supervisor-pause.test.ts supervisor-lifecycle.test.ts supervisor-admission.test.ts`, serial flags above | Exit0; **3 files,11 passed**,120.29s; `authority.log`. |
| Same archive config, files `supervisor.test.ts dispatch-entry.test.ts` | Exit1 due missing copied import at entry-suite collection; **supervisor3 passed**,127.84s. Entry had no executed case. `public-entry.log` retained as instrument failure plus separate supervisor passes. |
| Same archive config, `dispatch-entry.test.ts` only, after checked byte-identical import repair | Exit0; **4 passed**,219.22s; actual CLI/MCP role-loop case206128ms; `entry-only.log`. Passed supervisor cases were not rerun. |
| Same archive config, `supervisor-repair.test.ts --testNamePattern 'R2 real\|R3 real\|R5 actual'`, serial flags above | Exit0; **4 passed,11 selection skips**,975.32s; R2verification273024ms, exhausted verification168085ms, R3final-report307344ms, exhausted final-report222270ms; `repair.log`. Selection skips are covered through the explicit inherited mapping below. |

The archive config is the reviewed exact six-file diagnostic inventory, not a
replacement production gate. Public CLI/MCP/crash-controller imports intentionally
use original repository source and cwd, byte-equivalent to copied runtime source.
Entry collection originally lacked `yamlLite.mjs`; the minimal checked closure
copied original `yamlLite.mjs`, `contract.mjs`, `loadBacklog.mjs` without edits.
Copied module-URL root constants are not consumed by the selected in-process
workflow branch; real CLI subprocesses use original root constants. No assertion,
gate or deadline was weakened. The first arithmetic harness attempt had an
incorrect relative import, failed before measurement, and is preserved as
`arithmetic-initial-import-failure.log`; it receives no pass or mutation credit.

## Criteria, independent oracles and mutations

| Criterion | Examined object, direction of failure and judgment |
| --- | --- |
| D1 | **Pass.** Both actual pre-provider verification and post-provider implementation gates cross the original40second assignment cutoff. Their exit0 evidence has `finished > job.created + providerTimeout + 30000`, remains below new130second deadline, and actual worker output imports/assignment finishes. Gate PIDs and both actual operations are terminated/reconciled. No-gate exact equality and multiple serial allowances are independently tested. |
| D2 | **Pass.** Policy-first/routing-first/equal caps preserve the finite minimum. Native `buildInvocation.timeoutMs` stays180000 despite larger assignment allowance. The650second logical shift remains in effect through real gate publication/import: actual provider/gate operations terminate/reconcile, success evidence/artifact is refused, cancelled assignment is explicitly reconciled; no clock reset is used to admit success. This does not claim immediate assignment-deadline process killing. |
| D3 | **Pass.** Exact BigInt oracle63,504 cases, original boundary tests and30 invalid operand positions establish safe saturation/nonnegative-safe-integer validation; unsafe arithmetic is not accepted. |
| D4 | **Pass offline, with bounded inheritance below.** Fresh real cancellation/integrity/deadline watchers, crash-before-PID recovery, pause, failed verification/final-report repair, round exhaustion and public CLI/MCP lifecycle establish unaffected behavior for current source. Retained semantic mutation predicates remain on unchanged branches. |

Independent controls freshly executed from actual source in isolated copies:
baseline arithmetic accepts; harmless-comment real post-gate accepts; restored
old admission formula rejects the real post-gate case on **assignment budget or
policy stale**; `min`→`max` cap mutant rejects expected400000 versus300000;
removed gate allowance rejects211000 versus411000; restored actual post-gate
accepts. No timeout/import/setup failure is counted as defect detection.
`mutations/mutations.json` binds exact source/test/output hashes and commands.
`copy-validation.json` checks **396 source pairs** across six copies: only the
declared production mutant and identical accepted cleanup overlay differ.

The practical advantage is observable: registered serial gates can now publish
valid evidence inside their deliberately admitted assignment instead of expiring
after a successful long gate. Actual assignment deadlines, gate evidence and
stale-budget rejection make the condition diagnosable. Security/reliability were
triggered and independently checked through fixed caps, no child-timeout expansion,
expiry refusal and cancellation controls. CLI-only scope introduces no browser or
accessibility path. No application source changed; full app lint/build/regression
were not rerun or claimed by this verifier.

## Exhaustive dispatch inventory and narrow historical reuse

`test-inventory.json` SHA256
`9c9c680e1a12970a0cd2cad3e56c353c134149268d7049882349190ef8382607`
contains **49 obligations:28 fresh passes and21 inherited passes**, not49 fresh
tests. Existing dispatch files/case bodies are unchanged; six new deadline cases
join the historical43-case recovery inventory.

| File | Fresh / inherited obligations |
| --- | --- |
| supervisor-deadline |6 /0 |
| supervisor-pause |1 /0 |
| supervisor-lifecycle |8 /0 |
| supervisor-admission |2 /0 |
| supervisor |3 /0 |
| dispatch-entry |4 /0 |
| supervisor-repair |4 /11 |
| supervisor-mutation |0 /5 |
| supervisor-repair-mutation |0 /5 |

Inherited evidence is the independently accepted recovery aggregate in
`docs/dev-loop/items/recovery/verification.md` and
`.agnostic-loop/recovery/verified/test-inventory.json`, including its actual
baseline failures and corrected reruns. `historical-source-delta.json` compares
that69-entry manifest with current source: only optional Codex backend handling,
its tests and this deadline admission changed. Every diagnostic worker uses
`kind:command`, so the Codex-only backend branch is unexecuted. General supervisor
mutation controls dispatch only scope/no-gate tasks or reject before launch;
their admitted deadline is exactly unchanged.

The eleven retained repair cases cover R1/R4, missing/corrupt diagnostics,
four non-gate controls, bounded diagnostic output/admission and wrong-item
exclusion. Five retained repair mutation families cover reentry, verification and
final-report diagnostic removal, checkpoints and review-budget reset. Their
semantic predicates and actual mutation seams are unchanged. Short registered
fixture gates increase per-assignment allowance40→50seconds while overall600second
policy/routing caps remain fixed. Prior successful engine publication already
required its old deadline; these extensions do not alter the exact diagnostic,
candidate, review-round or checkpoint predicates. Historical intended kills were
explicit semantic `INVARIANT:R1`–`R5`, not deadline/timeouts. Current baseline
repair paths and the newly changed lifetime boundary receive fresh measurements.
This supports narrow inheritance, not an assertion that the entire suite reran.

## Controlled resources, history and limitations

All25 retained fixture roots were checked as immediate intended TEMP
`agnostic-supervisor-*` directories before recursive inventory. Final
`repair-retained.json` contains230 actual operation records; four new repair roots
contribute106 terminated/reconciled operations. Complete manifests of all25 roots
remain unchanged after **53686ms** (`late-comparison.json`), beyond fixed controlled
worker delays. Positive native Node canaries use the exact fixture-class predicate,
exit0, and final current fixture-class inventory is empty. Late manifest SHA256
`075de19fdbb9cfd9525088fe89fba3df9c1ff1389c0c2c64153e6d484fa0fe48`;
late process audit `0f1b087fc815dde3872bede240364567f9c5f18fcf715ad75203bfacd3525b6b`.

Conservative numeric-PID auditing deliberately stopped on unrelated reused PIDs;
root independently examined executable/class/parent/creation chronology before
admitting subsequent shards. Actual data is retained, never erased or killed:
114352 became WmiPrvSE after its earlier completed gate;98352 became conhost;
116540 became RuntimeBroker; final114392/103116 became Chrome under parent4320.
`reused-pid-observations.json` binds the latter exact current identities to original
terminated/reconciled Node jobs. Original98352 job finished1792180236887 before
conhost creation20:07:12Z;114392 finished1792182192740 before Chrome20:23:42Z;
latest original103116 finished1792182301154 before Chrome20:27:53Z.
No numeric-PID match alone establishes an owned live process.

Six intentional nonterminal fixture records remain preserved (five unknown, one
restored running). `authority-operation-map.json` maps actual cancellation,
synthetic pending recovery of an already observed exit0, cancel/integrity/deadline
watchers, and actual pre-PID controller crash. The integrity test deliberately
restores its pristine persisted state after observing actual PID death; the
crash-controller test awaits actual controller close and stops its marked worker.
These test states were not silently acknowledged or rewritten by this verifier.
Actual controlled current resource closure and unchanged late side effects are
separate from their intentionally retained protocol uncertainty.

Core process-audit limitations are explicit: a non-escalated CIM request was
denied; its empty projection is invalid evidence, not a zero-process result.
The escalated post-core heuristic lacked a matching positive canary and receives
no absence credit. Core's actual passed controlled detached writer case waits
beyond its1800ms write and observes the late bytes; watcher cases observe PID
termination and await their actual pending operations. This is bounded trusted
source/test closure, not universal descendant termination. Fast completed child
historical OS creation times may be unavailable and are not fabricated.

Author's earlier expiry-instrument session38644 lost its original PID/store through
cleanup. That historical audit gap remains **not a pass and not an acknowledgement**;
the accepted separate current-closure observation does not recreate missing history.
The two core Windows symlink branches remain unproven, owned by operator with a
privileged Windows rerun. No hostile process isolation or live product/service
integration is established by these offline fixtures.

## Qualification carryover receiver and handoff

Independent read-only `qualification-source-delta.json` finds exactly one changed
entry in the original22-source qualification manifest: supervisor-process only.
`carryover-admission.json` uses the actual frozen cancellation journal/packet:
created1792174832410, gateNames`[]`, provider timeout180000, both caps1792175344601;
current helper returns1792175042410, **exactly the old actual assignment deadline**.
Original and final semantic runners call `buildInvocation` directly, never
launchTask/drive. Thus the gate-aware branch is unexecuted in all six semantic
probes and actual controlled cancellation; provider/schema/normalization/bindings,
fingerprints and cancellation/import branches are unchanged. This is evidence-
bound unchanged-path carryover, not fresh live semantic qualification.

A new immutable manifest must preserve original evidence, requested target,
thresholds and expiry1792260933318; acceptance/attestation/configuration remain
root-owned. No provider call was made by this verifier. All admitted test commands
finished; shared test/cache/source-mutation ownership is released after this report
and final data handoff. Retained evidence roots remain read-only for inspection.
Independent report acceptance, qualification closure, production work grant,
scoped commit/push and exact live main-delivery guard remain separate obligations.
