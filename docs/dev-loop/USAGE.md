# Operator usage

## Required repository delivery

Every delivery also requires the owner's
[live-app verification workflow](../../AGENTS.md#owner-verification-policy--always-verify-in-the-live-app).
At intake, specify the live flow and required session/data. After the relevant
candidate is available in the live app, exercise it and record URL, time, deployed
revision, expected/observed results and sanitized evidence for independent review.
If blocked, record the exact blocker and next measurement, push verified source
when possible, and report live verification pending. The commands below establish
repository publication only; they do not enforce or replace this live check.

The owner requires every authorized change to be committed and pushed to
`origin/main`. After verification and independent acceptance, stage only scoped
source and records, commit on `main`, push normally, and verify the live remote:

```powershell
git push origin main
npm.cmd run loop:delivery
```

Do not report completion until the delivery command succeeds for the exact commit.
It rejects dirty tracked/staged/nonignored untracked files, another/detached branch,
an unexpected fetch or push destination, remote errors/mismatch and changes during
the check. It queries GitHub directly; stale `origin/main` tracking data and cached
receipts are insufficient. It never commits or pushes itself, and accepts no CLI
flags that relax the workspace, destination or checks. Preserve its successful JSON
under ignored `.agnostic-loop/` if a receipt is needed; do not create a receipt
commit that would make its own commit identity stale. Do not force push or bypass
protections. Report an actual blocker instead of claiming delivery.

`loop:handoff` now reports `localComplete` separately and applies the same live
repository guard before returning overall `complete:true` and exit zero. Generic
engine `shipped` and bare engine status remain local acceptance only. Previously
accepted local reports are historical records; their local status does not establish
remote publication. This standing push authorization does not enable providers or
authorize deployment commands.

Run commands from the repository root in PowerShell. Node 22.14.0 is the runtime
baseline. `tools/loop.mjs` supplies `--experimental-strip-types`,
`--experimental-default-type=module` and the local
`--experimental-loader tools/resolve-ts-hook.ts` resolution hook. No source-project
checkout or package installation is needed. Tests reuse installed Vitest under
`hello-world/node_modules`; missing dependencies are an environmental gap to report.

```powershell
npm.cmd run loop -- help
npm.cmd run loop:test
npm.cmd run loop:test:dispatch
npm.cmd run loop:demo -- .agnostic-loop/first-demo
```

`loop:test` is the mandatory engine/manual-port suite. `loop:test:dispatch` is an
independent diagnostic suite for the default-disabled supervisor, including repair
paths; record failures honestly. The demo creates a new/empty directory containing
an isolated project and store, runs the public CLI across process restarts, and
exercises a complete fixture lifecycle with distinct simulated worker identities.
Its offline checks prove protocol behavior, not independent human/model judgment,
live provider access, reliable unattended repair, or shipment of this port.

The CLI writes JSON `{ "ok": true, "result": ... }` or
`{ "ok": false, "error": ..., "action": ... }`; errors exit nonzero. npm may add
its own script banner. Inspect the CLI JSON line and exit status. For direct JSON
transport use `node tools/loop.mjs ...` with the same arguments.

## Create a disabled repository setup

Choose absolute workspace and provider executable paths and an exact model name.
The executable and model here are configuration values, not a live-access claim.
This command writes new files and refuses to overwrite existing setup files:

```powershell
$workspace = (Get-Location).Path
$providerExecutable = 'C:\absolute\path\to\codex.exe'
$exactModel = 'operator-selected-exact-model'
npm.cmd run loop -- dispatch template --preset repository --directory .agnostic-loop/setup --workspace $workspace --executable $providerExecutable --model $exactModel --kind codex --actor operator
npm.cmd run loop -- init --state .agnostic-loop/run --workspace $workspace --policy .agnostic-loop/setup/policy.json
npm.cmd run loop -- status --state .agnostic-loop/run --output summary
```

Review policy paths, environment names, deadlines, budgets and gate arguments before
init. The repository preset registers `engine`, `verification`, `regression`, `lint`, `build`, `backlog` (both `verification` and `regression` use the app test instrument)
with the actual `tools/repository-gate.mjs` adapter and a shared workspace resource.
Generated routing has disabled providers/targets, no qualifications and no configure
or local-delivery dispatch grant. Do not add `--grant` or enable/qualify providers
for this bounded manual workflow. Generic templates have intentionally failing
placeholder gates; they cannot count as repository verification.

On Windows with an already configured elevated Codex sandbox, optionally set
provider or target `settings.windowsSandbox` to `"elevated"`. The adapter emits
this setting after `exec`, alongside other command-local config overrides;
`--ignore-user-config` otherwise omits the user's saved Windows backend selection.
Only `elevated` is accepted. This setting does not provision a sandbox or widen
the role's read-only/workspace-write grant. Other platforms can omit it. Changed
settings/runtime identities require fresh qualification; this option does not
enable a provider or establish live model access.

## Manual event and assignment handoff

All mutations go through the CLI. Never edit `state.json`, stored blobs, or events
by hand. Keep packet/result/event files under excluded `.agnostic-loop/` and put
actual deliverable source bytes at their explicitly owned workspace paths.

An event JSON file contains `id`, `expectedRevision`, `actor`, `type`, `payload`.
Use a unique event ID and the current revision from `status`. Identical retries of
an acknowledged event are idempotent; a changed retry or stale revision is rejected.
The explicit `--actor operator` is trusted host identity, not worker-provided data.

A minimal item-create payload is:

```json
{
  "id": "manual-change",
  "objective": "One bounded authorized change",
  "owner": "operator",
  "affectedPaths": ["docs/example.txt"],
  "dependencies": [],
  "criteria": ["C1"],
  "requiredArtifacts": {
    "criteria-accepted": ["criteria"],
    "design-accepted": ["design"],
    "ready-to-build": ["plan", "test-design"]
  },
  "requiredGates": ["engine"],
  "triage": {"security": "Review fixed command authority", "reliability": "Review durable recovery"}
}
```

Wrap that payload in an `item.create` envelope; the exact `affectedPaths`, criteria,
artifacts and gates must match the accepted work contract. An `activity.create`
payload contains `id`, `item`, `kind`, `requirements`, `dependencies`. An
`assignment.start` payload contains:

```json
{
  "id": "scope-author",
  "item": "manual-change",
  "activity": "scope",
  "role": "specialist",
  "worker": {"instance": "actual-worker-instance", "context": "actual-fresh-context", "provider": "manual", "model": "operator-attested", "settings": {}, "tools": ["file"]},
  "inputs": {},
  "writePaths": ["docs/example.txt"],
  "affectedPaths": ["docs/example.txt"],
  "resources": [],
  "allowedActions": ["read", "write", "review", "run", "import"],
  "deadline": 0,
  "deliverables": ["scope"]
}
```

Replace `deadline: 0` with a future Unix timestamp in milliseconds within policy;
replace identities with actual observed host worker/context identities. Declare
all output paths, exact accepted input ID-to-hash entries and gate resources before
admission. These examples describe shapes, not ready-made grants or success records.

```powershell
npm.cmd run loop -- apply .agnostic-loop/item-create.json --state .agnostic-loop/run --actor operator
npm.cmd run loop -- apply .agnostic-loop/activity-create.json --state .agnostic-loop/run --actor operator
npm.cmd run loop -- apply .agnostic-loop/assignment-start.json --state .agnostic-loop/run --actor operator
npm.cmd run loop -- packet scope-author .agnostic-loop/scope-packet.json --state .agnostic-loop/run
```

After every mutation, obtain the new revision before preparing another event.
The host launches the actual authorized worker, retains its handle, waits for real
completion, checks the owned files/diff and imports actual bytes:

```powershell
npm.cmd run loop -- import scope-author scope docs/example.txt --state .agnostic-loop/run --actor operator
npm.cmd run loop -- result .agnostic-loop/scope-result.json --state .agnostic-loop/run --actor operator
npm.cmd run loop -- next --state .agnostic-loop/run
```

A result JSON envelope has `schemaVersion: 1`, unique `id`, current
`expectedRevision`, `assignment`, the packet's exact `worker`, its
`publicationToken`, `event: {"type":"assignment.finish","payload":{"assignment":"scope-author"}}`
and `usage: "unavailable"` (or `"operator-attested"`). Each result records one
allowed event. It cannot change trusted command authority. Do not invent observed
model identity or usage. A checker receives a separately admitted assignment with
both distinct instance and fresh context, then submits `review.record` containing
its assignment, artifact ID, exact imported hash, `verdict` and `findings`.
Finish that assignment with a separate result envelope at the next revision.

Repeat checked scope, criteria, design, plan and test-design activities before
implementation. Bind input hashes and downstream artifacts to accepted current
versions. `tools/agnostic-loop/demo.ts` is a complete executable example of event,
result, independent-identity fixture, gate and final-report shapes. The offline
demo above reproduces it without handwritten state changes.

## Gates, verification and final delivery

Admit an appropriate gate-running assignment with the policy's resource locks,
then run only registered names:

```powershell
npm.cmd run loop -- run verify engine --state .agnostic-loop/run --actor operator
npm.cmd run loop -- run verify verification --state .agnostic-loop/run --actor operator
```

Here `verify` must be the actual admitted assignment ID. Engine-managed `run`
records observed executable/arguments, candidate identity, output and exit status;
bare `apply` cannot forge gate evidence. Direct checks below are useful diagnostics
but do not become engine evidence automatically:

```powershell
node tools/repository-gate.mjs engine
node tools/repository-gate.mjs test
node tools/repository-gate.mjs lint
node tools/repository-gate.mjs build
node tools/repository-gate.mjs backlog
```

The app gates use its existing test/lint/build/backlog commands under `hello-world/`.
Run shared-resource gates serially. No standalone app typecheck is registered.
Record failed build/environment behavior as failed or unproven. Changed candidate,
policy, environment or relevant external input makes affected evidence stale.

Run the mandatory engine/manual-port gate separately with `npm.cmd run loop:test`.
Offline automatic-supervisor diagnostics are a separate instrument:
`npm.cmd run loop:test:dispatch -- --reporter=verbose`. Its checked configuration
serializes files; retain verbose progress and the actual final verdict. The earlier
recovery baseline completed after roughly 53 minutes and reported failures; a
30-minute interruption cannot establish a pass or a behavioral defect. Adopt a
finite reviewed overall execution budget before launch. Under the current
two-hour-per-run policy, use explicit test-name/file shards when needed, record
the exhaustive configured inventory, and leave incomplete shards pending.
Mutation timeouts are failed measurements, never successful defect detection.

Preserve source/configuration identity throughout each run. After a fixture timeout
or interruption, observe and reconcile its process tree and retained side effects
before retrying; do not remove locks or infer termination from a missing harness
alone. Offline diagnostic success does not configure or qualify a live provider.
Templates stay disabled until a concrete target, trusted grant and provider
qualification are separately established within the owner's authority.
See the [recovery verification report](items/recovery/final.md) for accepted offline
evidence, first implementation publication proof and the current delivery boundary.

An independent verifier imports a criterion-to-evidence report and records
`verification.record`; an independent checker accepts its exact bytes. A finalizer
imports and records `final.record`, including current candidate, verification and
whole-change-review references, regression evidence, local delivery and residuals.
The final report itself needs independent acceptance. `item.advance` carries
`item`, `status`, `artifacts`, `evidence`; legal progression is:

```text
queued -> scoped -> criteria-accepted -> design-accepted -> ready-to-build
       -> implemented -> verified -> regression-passed -> shipped
```

```powershell
npm.cmd run loop -- assemble-final finalize .agnostic-loop/residuals.json --state .agnostic-loop/run
npm.cmd run loop:handoff -- .agnostic-loop/run manual-change
npm.cmd run loop -- status --state .agnostic-loop/run --output summary
```

`assemble-final` produces a report snapshot for an admitted finalizer; it does not
publish, accept, or rerun verification. The handoff helper inspects completion;
it does not ship items or manufacture evidence. Attempting `shipped` before all
recorded prerequisites hold is rejected. Audit every requested store separately.

## Pause, cancellation and recovery

Use `apply` with `run.pause`, `run.resume` or `run.cancel` and payload
`{"reason":"specific operator reason"}`, always with fresh envelope ID/revision.
Pause blocks new admissions; admitted work may finish. Cancellation fences
publication and is not evidence that worker processes or descendants terminated.

```powershell
npm.cmd run loop -- recover-operations --state .agnostic-loop/run --actor operator
npm.cmd run loop -- reconcile-operation OPERATION_ID --state .agnostic-loop/run --actor operator --acknowledgement operations-stopped-and-side-effects-reconciled
```

Recovery marks potentially active work uncertain and retains reservations until
observed termination and side effects are reconciled. Record the actual termination
and side-effect observations separately before using the required literal
`operations-stopped-and-side-effects-reconciled`. Do not use acknowledgement
as a substitute for observation. Assignment reconciliation/quiescence events are
also explicit and must reflect real host facts. Lock recovery requires the exact
recorded lock token, the same literal acknowledgement and trusted actor; inspect
the lock and live host operations first. After recording actual reconciliation:

```powershell
npm.cmd run loop -- recover-lock --state .agnostic-loop/run --actor operator --token EXACT_OBSERVED_LOCK_TOKEN --acknowledgement operations-stopped-and-side-effects-reconciled
```

Do not delete locks to bypass ownership.

The file adapter cannot wake a finished chat, authenticate a provider, sandbox a
hostile worker or establish reliable process-tree termination. It enforces durable
records; the host still supervises actual execution.

## Explicit backlog intake

The authoritative YAML is read-only. In the manual workflow, read and independently
check the explicitly selected backlog scope, then use the `item.create` handoff
above with its exact accepted paths, criteria and gates.

The following is a reference command only for a separately authorized, already
configured dispatch store with its required dispatch configuration and journal.
It is not runnable after the manual `init` and no-grant template setup above.
This reference does not authorize configuring a store, granting dispatch or
enabling a provider:

```powershell
npm.cmd run loop -- dispatch status --state .agnostic-loop/configured-dispatch --config .agnostic-loop/setup/routing.json --actor operator --backlog docs/backlog.yml --item EXACT_ID
```

This does not enable provider dispatch. Intake rejects owner/verification records,
SHIPPED titles, already shipped engine IDs, every nonempty `blocked_by` (including
disappeared IDs), malformed/duplicate rows and invalid existing proof. Missing
`owns`/`verify` is an unscoped diagnostic; nullable/glob paths are not exact grants.
Existing proof is checked for contract consistency, not authenticated or replayed.
A `verify` string never executes or grants commands during intake.

For a separately approved bounded change, `--workflow FILE` replaces `--backlog`.
Its JSON shape is `schemaVersion: 1`, `id`, `objective`, `owns` (exact relative file
paths), `verify` (string or null) and nonempty `requirements` IDs. An explicit
workflow does not override mandatory gates or grant dispatch. The engine's `next`
schedules already admitted activities; product queue selection is outside this port.

### Exact rejected structured-proposal recovery

These owner controls apply only to an already configured dispatch store and an exact rejected scope, criteria or plan **author** job with rejection `Proposal must equal actual authored JSON artifact`. They do not repair a malformed inbox or turn rejected bytes into accepted work. Keep the original inbox, packet, job, usage and consumed counters unchanged. The next author attempt must get a new job, assignment/context and publication token and pass normal import and independent checking.

Before recovery, inspect the actual store and establish process/descendant termination and side-effect reconciliation. Every operation must be recorded terminated/reconciled; no other assignment or job may retain running/unknown ownership. Missing PIDs or an ended chat are insufficient. The selected assignment must be cancelled, its activity open with zero review rounds, and its item/activity/task/policy bindings must match the original admission. There must be no partial publication from the selected assignment/activity, no reviews or imported events. Already accepted ancestor artifacts do not by themselves authorize editing the rejected result or skipping later independent review. New authority requires remaining job/assignment capacity and unexpired policy/configuration deadlines.

Inspect the selected item with the active, verified configuration:

```powershell
npm.cmd run loop -- dispatch status --state .agnostic-loop/configured-dispatch --config .agnostic-loop/setup/routing.json --actor EXACT_OWNER --backlog docs/backlog.yml --item EXACT_ID
```

For a store configured from a separately approved workflow, replace `--backlog docs/backlog.yml` with `--workflow EXACT_WORKFLOW_FILE`. These selection flags belong to status/drive; **recover accepts neither --backlog/--workflow nor --item**. Recovery binds the exact journal job supplied by `--job`:

```powershell
npm.cmd run loop -- dispatch recover --state .agnostic-loop/configured-dispatch --config .agnostic-loop/setup/routing.json --actor EXACT_OWNER --job EXACT_REJECTED_JOB --acknowledgement authorize-rejected-proposal-reentry
```

This records one exact owner reentry event; generic assignment reconciliation does not substitute for it. Repeating that same admitted event is idempotent and does not refund usage or create a standing retry permission. Another rejected job needs its own eligibility check and owner action. After successful admission, ordinary bounded drive can schedule a fresh attempt:

```powershell
npm.cmd run loop -- dispatch drive --state .agnostic-loop/configured-dispatch --config .agnostic-loop/setup/routing.json --actor EXACT_OWNER --backlog docs/backlog.yml --item EXACT_ID --max-steps 1
```

A separate qualification-only control supports an independently verified repair of dispatch control code before that reentry. First obtain a separately reviewed configuration through the supported qualification/attestation workflow; preserve the old configuration and evidence. This documentation is not authority to create a qualification, claim a live provider passed, change a grant, or hand-edit a configuration/journal. Only qualification `id`, `evidencePath` and `evidenceHash` may differ. Qualification inventory, target/provider/settings/executable identities, profiles, score, expiry, routing, original policy, budgets and deadlines must remain identical. Evidence/target/executable hashes are checked. Rebind additionally requires the selected assignment already reconciled and **no accepted artifact anywhere in its item**, rather than merely no publication from the selected activity.

Use the reviewed successor configuration for this exact command:

```powershell
npm.cmd run loop -- dispatch recover --state .agnostic-loop/configured-dispatch --config .agnostic-loop/setup/verified-successor-routing.json --actor EXACT_OWNER --job EXACT_REJECTED_JOB --acknowledgement rebind-qualification-after-verified-control-repair
```

The transaction preserves rejected jobs, results, usage and counters, binds complete old/new state/config/journal snapshots, and retains immutable intent/completion receipts. The journal changes only its configuration identity and revision; the state adds the fixed owner maintenance event/revision. Rebind alone leaves the rejected-proposal scheduling barrier in place: the distinct reentry acknowledgement is still required using the successor configuration.

While a qualification-rebind pending marker exists, ordinary status/drive/import APIs fail closed even if the three new snapshots have already been written. After interruption, preserve all bytes and resume **the same rebind command with the exact same job and successor configuration** so the persisted intent can replay only a legal write prefix. Foreign/tampered state, journal, marker, receipt or a different configuration is a refusal, not permission to delete a marker, rewrite history or refresh grants. Exact completed replay is idempotent; a canonical configuration no-op grants no reentry. Neither replay nor no-op creates a fresh dispatch budget.

An expired original production grant remains expired. These controls never extend its deadlines or qualification expiry, reset consumed attempts, enable a provider, establish a new live qualification, or prove reliable unattended operation. A new local offline verification window does not renew production authority. If capacity/deadline or proof prerequisites are missing, leave dispatch fenced and report the specific blocker.
