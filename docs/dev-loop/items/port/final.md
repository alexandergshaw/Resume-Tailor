# Local delivery evidence — provider-agnostic loop port

Requested item: **port** — repository-local durable engine, CLI and workflow
documentation, with automatic provider dispatch disabled. This report is prepared
for independent judgment; the exact accepted bytes are identified in
`delivery.check.md`. Authoritative manual delivery status is `../../state.json`.
These host records are not fabricated engine-store acceptance events.

## Delivered behavior

- Self-contained engine under `tools/agnostic-loop/`: revision-checked transactions,
  idempotent event replay, immutable evidence, assignment/publication binding,
  independent role admission, review limits, resource ownership, freshness,
  cancellation, reconciliation and completion guards.
- Root CLI and separate engine tests use the existing Node/Vitest installation.
  The source engine's CLI/MCP transports and offline fixtures are preserved.
  No source-project checkout is needed at runtime.
- Resume-Tailor gate adapters use actual application commands. Backlog intake is
  explicit, preserves existing proof checks, rejects shipped/unscoped/blocked
  records, and cannot turn `verify` text into command authority. Duplicate YAML
  fields and inherited gate-command names are rejected.
- Root `AGENTS.md`, operator usage and workflow guidance document manual handoffs
  and disabled/unqualified provider templates. Existing product files, backlog,
  `.claude/` workflows and local settings are preserved.

## Verification and identities

The independent `verification.md` is the criterion-by-criterion evidence record
and identifies tested file manifests and logs. It distinguishes the full initial
core run from the final targeted gate-validation rerun. Base Git revision:
`6c4befea900a4ac239eb95f258c6a708a3708e8c`; delivered changes remain local and
uncommitted. `source-manifest.json` records imported source bytes, not an upstream
release or qualification claim.

| Instrument | Observed result |
| --- | --- |
| `npm.cmd run loop:test` | 19 files passed; 129 tests passed, 2 skipped |
| Final affected `repository.test.ts` run | 1 file, 15 tests passed; includes inherited-name rejection controls |
| `node tools/repository-gate.mjs test` | 1,294 files passed, 1 skipped; 20,418 tests passed, 9 skipped |
| Registered lint, build and backlog commands | Passed; backlog has 156 items and zero violations |
| CLI help/error and real-repository init/restart status | Passed with disabled configuration and no provider launch |
| `npm.cmd run loop:test:dispatch` | Incomplete at the 30-minute bound; no suite verdict or counts claimed; owned process tree stopped and observed absent |

Security/stale-evidence and adapter mutations passed original, harmless-control,
deliberate-defect and restored-control checks in isolated copies. Full initial
engine and application results are not represented as observations of skipped
cases or reliable autonomous recovery. The final guard change affects only name
admission; valid registered command paths and application source are unchanged.

Accepted design/review references: `contracts.check.r2.md` and
`implementation.check.r2.md`. The delivery check covers the final guard correction,
documentation prerequisite correction, current verification report and this report.

## Residuals and limits

| Unproven obligation | Owner | Settling instrument | Measurement condition |
| --- | --- | --- | --- |
| Complete supervisor recovery diagnostics | Operator | Full `npm.cmd run loop:test:dispatch` with sufficient explicit runtime budget and process reconciliation | Before considering automatic dispatch |
| Two privileged symlink/escape store observations | Operator with Windows symlink capability | Rerun the skipped `store.test.ts` cases in a symlink-capable environment | Before claiming those host observations |
| Live provider qualification, identity, accounting and real process/service behavior | Operator | Separately authorized qualification/live integration instruments | Before enabling a provider or relying on unattended operation |
| Existing application skipped coverage | Product owner | Relevant currently skipped application instruments | When those application claims are required |

Automatic providers remain disabled and unqualified. No installation, login,
paid provider call, external message, deployment, publishing or release occurred.
The cooperative engine does not promise a hostile-worker sandbox or reliable
process-tree termination from a missing PID. An operator acknowledgement requires
actual observation; the completed diagnostic interruption was reconciled separately.

For operation start with `npm.cmd run loop -- help` and `../../USAGE.md`.
