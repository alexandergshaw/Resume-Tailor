# Bounded repair mutation timing correction plan

Author `/root/recovery_contract`, 2026-10-16. Proposal only, pending independent checking and completion/reconciliation of the active immutable run. No code edited or tests executed for this plan.

The coordinator reports a passing R1 flow at 257,809 ms. The mutation harness currently permits 240,000 ms per flow, so the reported valid behavior can exceed its observation window. The active run's actual final verdict remains required: anticipated timeout is not an observed failure, and timeout never satisfies a mutation's designated behavioral oracle. `timing-analysis.md` identifies repeated trusted-source hashing/probes as plausible cost, without measured attribution; this plan makes no optimization claim.

## Exact bounded change

Only implementation write: `tools/agnostic-loop/supervisor-repair-mutation.test.ts`. Add named test constants near `source`/`loader`:

- `REPAIR_HARNESS_TIMEOUT_MS = 720_000`: existing 600,000 ms fixture authority/qualification window plus 120,000 ms bounded startup/cleanup margin.
- `REPAIR_MUTATION_TIMEOUT_MS = 4 * REPAIR_HARNESS_TIMEOUT_MS + 120_000`: 3,000,000 ms enclosing ceiling for original, harmless-comment, designated mutant and restored-original controls, plus isolated-copy setup/restoration/hash inspection.

Replace only the `spawnSync` 240,000 ms timeout with the first constant and the enclosing `it` 1,100,000 ms timeout with the second. These are instrument ceilings, not worker authority. Keep the existing 600,000 ms fixture policy, routing budget and qualification expiry, all finite progress/iteration bounds, 10,000 ms provider/gate limits, buffer bound and cleanup mechanisms unchanged. Keep all five mutation families, unique-seam checks, actual mutation writes, exact original/no-op/restored success expectations, designated R1–R5 error-prefix assertions, exit/signal/error rejection and production/copy hash checks unchanged. Do not add caches, skip probes, exclude source bytes, reduce controls, or alter runtime/fixture logic. Expired authority is a separate failure to diagnose, not permission to extend grants.

## Preconditions and measurements

1. Obtain independent acceptance of this plan. Wait for the active immutable run's complete actual verdict or its predeclared overall deadline. Preserve its complete logs/source identity. Before any edit or rerun, reconcile its owned process tree, exit state and fixture side effects; a killed harness alone does not prove descendants stopped.
2. Inspect the final failure mechanism. Apply this narrow plan only if it remains a justified instrumentation correction; record unrelated failures separately. Capture exact before/after source hashes and inspect the actual diff for the two replacements/constants only. Review the correction independently before consuming its verification results.
3. Run the affected file serially to avoid CPU contention:

   `node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.dispatch.config.mjs tools/agnostic-loop/supervisor-repair-mutation.test.ts --reporter verbose`

   Require all five families' four controls to reach terminal behavioral verdicts; timeout/harness errors fail. Retain progress/logs and final cleanup/process observations. A conservative overall envelope is 4 hours 15 minutes for this serial file: five 50-minute case ceilings plus five minutes process/setup overhead. This is a proposed reviewed maximum, not a requirement to consume it; the coordinator must record the adopted overall budget before execution. If only a smaller budget is admitted, shard by explicit test name and retain an exhaustive inventory without silently marking the remaining families passed.
4. Reconcile fixture/process cleanup, then rerun `npm.cmd run loop:test` and complete the dispatch inventory with verbose serial execution (either `npm.cmd run loop:test:dispatch -- --reporter verbose`, or explicit config file-filtered commands). Reuse earlier unaffected results only against proven identical relevant source/configuration/policy bytes. Re-run affected readiness evidence after its bound test/configuration source changes; never transplant a stale receipt.

Keep application gates serialized with shared-resource work. Report command, source identity, elapsed time, complete verdict, limitations and cleanup evidence. A second timeout or authority-expiry result stays failed/unproven and requires diagnosis; no automatic further ceiling increase is authorized by this proposal. Independent final verification and report acceptance remain required. This plan does not qualify or enable live provider dispatch.
