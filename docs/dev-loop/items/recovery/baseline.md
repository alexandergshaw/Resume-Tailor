# Recovery diagnostic baseline — failed, reconciled

Independent diagnostic operator: `/root/recovery_baseline`, 2026-10-16. No production/test/configuration edits were made by this operator. This is a measured baseline, not offline readiness acceptance.

Command (repository root, Node 22.14.0, installed Vitest 4.1.8):

```powershell
node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.dispatch.config.mjs --fileParallelism --maxWorkers=2 --reporter=verbose
```

Started 09:33:28-05:00; ended 10:26:32-05:00. Actual process exit **1**. Vitest duration **3182.41 seconds**; **8 files: 6 passed, 2 failed; 43 tests: 37 passed, 6 failed**. No 30-minute cutoff was applied. Existing per-test/harness deadlines were preserved. Node required sandbox escalation because its sandboxed path resolution returned OneDrive `EPERM`; no installation, login or paid provider was used.

The initial HEAD was `ff3db6414762719aba151bf89748fae42e0c436a`. The 69-entry before/after SHA256 manifests cover every `tools/agnostic-loop/*.ts` file plus dispatch configuration, resolver, root package and app package. Every manifest entry remained identical; intervening coordinator changes were documentation/backlog only. Both manifest files SHA256: `1763E8704A161FEDEF731D6CCFD3B6462523B63E69772EF96DFC9696902185B8`.

## Actual failures

| Case | Observed mechanism | Stack / disposition |
| --- | --- | --- |
| repair mutation reentry | `spawnSync node.exe ETIMEDOUT`, 240073ms | `supervisor-repair-mutation.test.ts:43`, invoked at line 95 baseline. No intended invariant result; no mutation credit. |
| repair mutation diagnostics-verification | Same timeout, 240060ms | Same stack/class. |
| repair mutation diagnostics-final-report | Same timeout, 240067ms | Same stack/class. |
| non-gate review | `TypeError: Cannot read properties of undefined (reading 'status')`, 2463ms | `supervisor-repair-fixtures.ts:343` predicate, `until:136`, test line31. Fresh selection item is absent before first drive. |
| non-gate provider | Same absent-item predicate, 2223ms | Same stack/class. |
| non-gate paused | `Store locked; do not remove automatically. Explicit recovery requires the observed lock token and operator acknowledgement.`, 153560ms | `store.ts:22` → `controlDispatch` at `supervisor.ts:35` → fixture line326 → test line31. No lock was removed or recovery acknowledgement invented. |

The timeout ceiling is contradicted by independently successful positive R1 (257809ms), R2 (283696ms), and R3 (336366ms). Timeout failures do not establish a runtime invariant defect. The accepted timing/non-gate/pause plans govern separate corrections and fresh verification.

## Completed inventory and positive evidence

All eight configured files actually ran: `dispatch-entry.test.ts`, `supervisor.test.ts`, `supervisor-admission.test.ts`, `supervisor-lifecycle.test.ts`, `supervisor-mutation.test.ts`, `supervisor-pause.test.ts`, `supervisor-repair.test.ts`, `supervisor-repair-mutation.test.ts`. The full verbose log names all 43 cases and all failure stacks.

The six entirely passing files cover public CLI plus actual MCP offline lifecycle, compact status, real subprocess completion, two-round restart stopping, launch uncertainty, post-spawn/pre-PID crash, credential sanitization, watcher cancellation/integrity/deadline termination, gate pause, and launch/qualification/admission/revocation/reservation mutation controls. All five ordinary mutation families passed original/comment/designated red/restored controls.

In the repair positive file, R1 reentry, R4 bounded checkpoint and read-only zero-step, both verification/final-report diagnostic-dependent repairs, both actual exhausted activity budgets, missing/corrupt referenced-byte rejection, non-gate invalidation, UTF-8 truncation/redaction/hash binding, conservative diagnostic admission, and wrong-item exclusion passed. Wrong-item final case passed397369ms. In repair mutations, checkpoint passed558542ms and budget passed710857ms with all four controls and restored/original hashes. The remaining three mutation families remain unproven, and three non-gate controls failed.

## Isolation, processes and retained evidence

Before parallel execution, code inspection established unique `mkdtemp` roots, module-local cleanup arrays and process-private environment edits. Vitest's observed pool was two fork processes; mutation sources were isolated runtime copies, never root-source mutations. Primary Vitest PID93152 and observed fork/harness identities were retained. Final recursive process snapshot at10:27:34-05:00 found zero known PIDs, zero live descendants and zero Node commands referencing the fixture prefixes. This is an observed local fixture reconciliation, not an arbitrary third-party process-tree guarantee.

Three timeout-created supervisor roots remain for evidence: `agnostic-supervisor-NdsAD2`, `agnostic-supervisor-fci5rG`, `agnostic-supervisor-38zr5t` under the OS temporary directory. Their state/journal/file inventories are preserved read-only in `run-leftover-details.json`. No live fixture process referenced them; no blind cleanup was performed. Other inventoried older roots are unrelated historical residue and were left intact. Normal finished fixtures and isolated mutation runtime copies were cleaned by their existing hooks.

Ignored evidence directory: `.agnostic-loop/recovery/baseline/`. Authoritative files: `verbose.log`, `result.json`, `start.txt`, `head.txt`, `source-before.json`, `source-after.json`, `source-comparison.json`, `evidence-hashes.json`, `processes-before.json`, `processes-after.json`, `process-reconciliation-final.json`, `quiet-progress.json`, `temp-leftovers.json`, `run-leftover-details.json`. Verbose log SHA256: `F8CDBFE13726D74211F22BAA793D05BF21A9CFA7660B10B6D17A97E3A4C5A897`.

Source ownership is released after this reconciled report. Mandatory core/backlog gates are pending, intentionally serialized after checked corrections and repair reruns. No provider enablement, qualification, grant, deployment, commit or push was performed by this worker.
