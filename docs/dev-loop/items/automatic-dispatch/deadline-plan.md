# Gate-aware dispatch assignment deadline repair plan

Status: proposed; no implementation or provider invocation admitted by this file.
Root selected this bounded prerequisite to fulfill automatic backlog dispatch.
The setup proposal's gate-bearing admission remains withheld until this repair,
its independent verification and affected qualification carryover are accepted.

## Contract and exact ownership

Change only production `tools/agnostic-loop/supervisor-process.ts` and new focused
`tools/agnostic-loop/supervisor-deadline.test.ts`. An ignored isolated-copy mutation
harness/result may be authored under `.agnostic-loop/backlog-dispatch/deadline/`.
Do not edit providers, routing fingerprint, runner, engine, fixture helpers, test
configuration, qualification records, backlog or other production paths. This
plan/report record is separate from executable evidence and remains host-owned.

D1: assignment admission reserves lifetime for every serial gate actually attached
to task.gateNames, bounded provider execution, and the existing30second import/I/O
allowance. This applies identically to pre-model verification/final-report gates
and post-model implementation-wave gates. No-gate deadline remains identical.
D2: assignment deadline never exceeds fixed policy or routing deadlines. Keep the
qualified provider timeout and invocation fingerprint unchanged, including the
actual child timeout180seconds. No safety gate is waived or converted to host-only
pretesting. Expiry still rejects successful evidence/artifacts after deadline.
D3: arithmetic cannot wrap or produce unsafe integer timestamps under large but
otherwise admitted integer settings. The gate-aware allowance saturates at the
finite minimum policy/config deadline instead of performing unsafe multiplication.
D4: failed-gate repair, round counting, ownership, cancellation, unknown-operation
retention, provider protocol and supervisor launch/import behavior remain unchanged.

The concrete advantage is that real repository gates can publish valid evidence
within a deliberately admitted assignment, instead of failing after a successful
long-running gate. Existing gate logs, assignment.deadline and rejection diagnostics
expose the behavior. This is CLI reliability work; no browser/accessibility seat
is triggered. Security/reliability are triggered by time authority and cancellation.

## Mechanism and callers

At the existing assignment.start construction inside launchTask, replace only
deadline derivation. Conceptually:

```
cap = min(policy.deadline, config.budget.deadline)
remaining = cap - admissionNow
allowance = provider.timeoutMs + 30000, saturated to remaining
for each registered task.gateNames entry:
    allowance = allowance + policy.commandTimeout, saturated to remaining
assignment.deadline = admissionNow + allowance
```

Use safe integer operands and subtraction-based comparisons before additions;
never first evaluate gateCount*commandTimeout or an overflowing now+duration.
If remaining<=0, preserve ordinary expired-admission rejection. An internal helper
may be exported from this same module to test boundary arithmetic; avoid new
production modules or configuration fields. Checked configuration/state validation
remains the source of allowed integers. Document any rejection for non-safe or
negative counters rather than silently truncating them.

The allowance is an upper scheduling reservation clamped to the existing finite
run cap, not a promise that all worst-case gate durations fit simultaneously.
A two-hour run and six30minute gate timeouts therefore reserve at most two hours;
they do not extend the run to three hours. Existing liveAssignment enforcement
rejects publication beyond that cap. No new overall deadline or renewal exists.

Only caller is supervisor.ts drive→launchTask. taskFor in workflow.ts supplies
gateNames: implementation-wave plan gates, or configured item.requiredGates for
verification/final-report. Other task kinds ordinarily have none. runGate and
importJob consume admitted assignment identity unchanged; no signatures change.
The child monitor timeout remains min(provider.timeoutMs, remaining policy budget,
remaining routing budget) exactly as today. Current gate monitors are status-based
and commandTimeout-based; this repair does not claim stronger descendant termination
or immediate deadline cancellation. Engine successful-evidence/publication expiry
guards continue unchanged, and run budgets remain fixed. A separate future monitor
hardening concern must not be smuggled into this one-line admission repair.

## Independent test design and behavioral baseline

The fresh test designer/checker must establish expected deadlines from task order,
registered gate count and fixed caps, independently of the production helper.
Keep real timers for subprocesses and locks. Prefer a host-only Date.now spy with
controlled logical increments at an observed actual gate barrier, restoring it
before fixture cleanup; do not globally fake timers around child processes.

Use actual LoopStore, configureDispatch, launchTask/drive, runGate and importJob
with existing supervisorFixture/fixtureWorker read-only reuse. New test-local
fixture construction can adapt its script/config before qualification/configure;
it cannot change shared fixture source. A real short-lived gate signals readiness
outside candidate, waits for a release file, then exits0. Parent observes barrier,
advances logical host Date.now past the OLD provider+30s assignment deadline while
remaining inside the NEW gate-aware lifetime, releases gate, and waits for actual
completion. Worker subprocess uses real clock; therefore ensure its own outcome
bindings do not depend on shifted host timestamps. Observe actual launched process,
gate evidence, assignment deadline and imported accepted artifact/report. A pure
helper test or mocked successful gate alone is insufficient for this regression.

Required families:

- Pre-model gate path: real passing gate after old cutoff still records exit0,
  then actual worker outcome imports and assignment finishes within new deadline.
- Post-model implementation-wave path: actual owned output and passing gate after
  old cutoff still import and finish; preserve baseline candidate/source assertions.
- No-gate task retains exact previous deadline, plus provider invocation timeout
  remains the configured bound even when assignment allowance is larger.
- Multiple gate allowance accumulates per registered serial gate; separately clamp
  policy-first and routing-first caps, including equality boundary.
- Overflow/safe-integer edges saturate before unsafe arithmetic, including huge
  gate durations/counts and admissionNow near MAX_SAFE_INTEGER; invalid negative,
  fractional or unsafe operands reject if helper accepts raw values.
- Genuine overall expiry still rejects successful evidence/import, with actual
  operation termination and ownership reconciled before cleanup. Do not fake a
  pass by advancing time back before publication.
- Existing failed-gate repair and cancellation suites remain mandatory affected
  diagnostics; their actual complete outcomes are recorded separately from core.

First capture old source behavioral RED with the above real gate instrumentation,
not a missing-export import failure. After fix require baseline green, harmless
no-op green, deliberately restored old deadline mutant red on intended regression,
cap-removal mutant red on cap assertions, missing-per-gate-allowance mutant red on
multi-gate oracle, and restored green. Isolate copies, verify actual byte mutation,
record hashes/control statuses and never mutate shared files concurrently.

If Date.now spying interferes with fixture validity, stop and repair test design
within this accepted oracle; do not weaken it to helper-only measurement. An
explicit bounded real wait is an admissible slower instrument if necessary.

## Commands, locks and evidence

Serialize all tests/caches and source mutations. Focused command from repository:

```
node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.dispatch.config.mjs tools/agnostic-loop/supervisor-deadline.test.ts
```

The actual core config excludes supervisor*.test.ts; the existing dispatch config
is therefore intentionally selected. Do not change config or accept "no tests".
Record the resolved executable/argument vector. Mandatory core remains
`npm.cmd run loop:test`; affected diagnostics use `npm.cmd run loop:test:dispatch`
with explicit existing pause, failed-gate/repair and relevant recovery file shards.
The independent verifier records the exhaustive affected file inventory, actual
commands, final outcomes and source identities. A timeout is pending/failed, never
a mutation kill. Broader unchanged recovery evidence requires checked executed-path
mapping, not a blanket claim that everything reran.

Independent implementation checker must inspect the actual small production diff,
test instrument, scope and all D1-D4. Independent verifier runs real regression,
controls, core and affected diagnostics against stable source. Root owns final
report, independent acceptance and verified main delivery; no worker Git changes.

## Qualification freshness receiver

This production file is bound by the immutable live qualification manifest. Do not
edit old evidence or replace its source hash in place. After offline acceptance,
an independent checker must map the exact delta: assignment.start lifetime only;
provider executable/source/schema/buildInvocation, normalization, requested target,
scope/identity/binding checks and cancellation branches unchanged. Real existing
semantic probes have no gate-bearing TaskSpec, so prove their old and new admitted
deadline is identical and the new branch is unexecuted for those probes. Prove the
controlled cancellation experiment's gate count from its actual frozen packet,
not assumption; if nonempty, independently assess deadline delta and cancellation
executed path. If mapping cannot establish unaffected conclusions, affected
measurement is pending and no new live calls are implied by this plan.

With accepted narrow carryover, create a NEW immutable manifest containing current
source hashes, original immutable evidence references plus repair verification,
review identities and explicit inherited-vs-new measurement table. Retain original
expiry1792260933318, requested provider/target fingerprint and profile thresholds.
Root may separately issue operator attestation to this new evidence path only
after independent manifest/fidelity acceptance. No provider model call is needed
for a demonstrably unexecuted admission branch, and no new live qualification is
claimed; this is evidence-bound carryover, not fresh semantic observation. This
plan does not itself attest or enable the production configuration.
