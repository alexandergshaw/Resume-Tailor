# Read-only recovery timing analysis

Reviewer `/root/recovery_check`, 2026-10-16. Static inspection only: no test execution, source changes, profiler sampling or interference with the active run. The coordinator reports a successful standalone R1 duration of 257,809 ms; this note does not independently attest that run.

`supervisor-repair-mutation.test.ts` calls each harness with `spawnSync` timeout 240,000 ms and runs baseline, harmless-comment, designated mutant and restored-baseline controls inside one 1,100,000 ms test. A reported successful baseline longer than 240,000 ms establishes an instrumentation mismatch on that host. Such a timeout never demonstrates the R1 behavioral defect: the harness must return its intended `INVARIANT:R1:` error for mutant detection to count.

Static cost mechanism (not measured attribution):

- `until` obtains status, then `step` obtains status again before `drive` obtains status. Each status loads state and validates immutable references, observes artifacts, captures candidate and reads accepted bodies.
- `LoopStore.load` verifies every artifact/evidence blob and stored report; repeat calls grow more expensive as the fixture accumulates accepted artifacts and gate evidence. Integrity checks remain required.
- `captureCandidate` hashes every gate executable on each call; the inspected Node executable is 83,344,536 bytes (`Get-Item (Get-Command node.exe).Source`). That executable is reused by the fixture gate. Multiple state/context boundaries repeat this read/hash without avoiding the trust check.
- Child admission and launch each call `probeProvider`, rereading/hashing the executable and absolute prefix scripts, plus spawning version/help subprocesses. `repairFixture` first builds/configures a generic fixture and then changes scripts and creates/configures its final store, repeating setup qualification/probes.
- `digest` uses native `node:crypto` SHA-256. The code does not support a pure-JavaScript hashing diagnosis. Atomic persistence and immutable-reference I/O are additional costs; no CPU profile distinguishes their actual shares here.

Recommended bounded correction after the immutable run settles: make the harness wall timeout exceed the existing 600,000 ms fixture authority/qualification window by a bounded startup/cleanup margin, and make its enclosing four-control timeout exceed the sum of those four harness ceilings plus setup/restoration. Preserve the 600,000 ms authority/qualification deadlines, finite progress bound, 10,000 ms child/gate timeout and all behavioral/error-prefix/control/hash assertions. Exact constants should be recorded and reviewed together; arbitrary low enclosing ceilings can invalidate a correctly enlarged harness. No timeout is accepted as a mutant behavioral red.

If the unchanged measurements show authority expiry rather than instrumentation timeout, that is a separate measured outcome requiring diagnosis; do not silently extend grants to make it pass. An optimization may remove redundant fixture status collection with independently reviewed equivalence and corruption/mutation controls. Do not add production cross-call executable/blob caches merely to speed tests: that risks bypassing the freshness and tamper detection under examination. Likewise do not exclude gate/tool bytes or skip probes to reduce elapsed time.

This is a recommendation, not acceptance of a runtime failure or an implementation. Active source remains immutable. Reconcile actual child termination and cleanup after harness interruption before rerunning; `spawnSync` killing the harness alone is not proof its descendants stopped.

## Reviewed source identities

- tools/agnostic-loop/supervisor-repair-mutation.test.ts: 2cae49cbbffa3e00afcd1dde73d070539643830886e2b4d4eb743d2051f6189c
- tools/agnostic-loop/supervisor-repair-fixtures.ts: 8085f11e9ea8d601130cc93b09f0bcff3439f0d5773c0df10267f453c7113169
- tools/agnostic-loop/supervisor-fixtures.ts: 2570bf9be99764612b7f4f58de1ea78e94456360d8ace552ddfa66f88930ded5
- tools/agnostic-loop/provider-probes.ts: 18f16283dde90aee3cee02dd19df2f32be565c9c21a3258a96b8d6e06d12d389
- tools/agnostic-loop/candidate.ts: a4b4d77b7dc78ebb38c862a3abc7bb7719f78d80a4ec5167e346b166a13ed46b
- tools/agnostic-loop/store.ts: e265e7df7a2ec256cff150d3443b4864c7fed708faadc53f9f7349be11fb75f0
- tools/agnostic-loop/supervisor.ts: eb34a346bce77df5ed9c056023378e240741adff82f48cfa207d1f6f6a39702d
- tools/agnostic-loop/supervisor-process.ts: 9f654f30a074c336ba3379428bac16dde9008b98ab763926e4f5f34f69617485
- tools/agnostic-loop/supervisor-inbox.ts: f9524cb980f8ce2db1f3b44f8176ee34f01023675a1c137090230e3d18b56bfd
- tools/agnostic-loop/json.ts: 57d95bac1bb76088ffc11cd00b4930a80377b3f9b925bdb2464389c51fb41436

Concrete test-instrument-only candidate for independent review: 660,000 ms harness ceiling and 2,700,000 ms enclosing four-control ceiling (four harness ceilings plus 60,000 ms setup/restoration). Retain existing 600,000 ms fixture authority. Serialize repair files on a rerun if shared CPU contention is material. Current full-suite verdict remains pending. The forthcoming correction must be authored by a different worker and independently checked against these requirements before consumption; this note does not accept unseen code.
