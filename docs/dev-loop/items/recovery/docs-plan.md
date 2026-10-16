# Proposed recovery operator documentation delta

Draft by `/root/recovery_contract`, 2026-10-16. Proposal only; no USAGE/WORKFLOW/runtime/configuration edits during active verification. Apply after the final verifier report and independent acceptance establish the exact completed scope. Do not turn pending results into a qualification claim.

## USAGE.md proposed addition

Add a short subsection immediately after the existing direct diagnostic gate commands, before independent final-report instructions:

> Run the mandatory engine/manual-port gate separately with `npm.cmd run loop:test`. Offline automatic-supervisor diagnostics are a separate instrument: `npm.cmd run loop:test:dispatch -- --reporter=verbose`. Its checked configuration serializes files; retain verbose progress and the actual final verdict. The earlier recovery baseline completed after roughly 53 minutes and reported failures; a 30-minute interruption cannot establish a pass or a behavioral defect. Adopt a finite reviewed overall execution budget before launch. Under the current two-hour-per-run policy, use explicit test-name/file shards when needed, record the exhaustive configured inventory, and leave incomplete shards pending. Mutation timeouts are failed measurements, never successful defect detection.
>
> Preserve source/configuration identity throughout each run. After a fixture timeout or interruption, observe and reconcile its process tree and retained side effects before retrying; do not remove locks or infer termination from a missing harness alone. Offline diagnostic success does not configure or qualify a live provider. Templates stay disabled until a concrete target, trusted grant and provider qualification are separately established within the owner's authority.

Then add the final recovery report link only after completion: `[Recovery verification](items/recovery/final.md)`. If final verification is still incomplete, explicitly label the link pending rather than describe it as readiness acceptance.

## WORKFLOW.md proposed replacement

In the existing “Verify the actual candidate” discussion, retain the distinction between mandatory engine/manual-port gates and offline supervisor diagnostics. Add immediately after the paragraph ending with the disabled-supervisor diagnostic limitation:

> Completing recovery diagnostics requires terminal results for the complete configured dispatch inventory, including each original/harmless/designated-mutant/restored control. A timeout is not a mutation kill. Evidence reuse after a fixture-only correction requires independently accepted exact source-delta and executed-path mapping; an old whole-source receipt cannot qualify changed bytes. Keep mandatory core results, offline diagnostic qualification and live-provider qualification distinct. The source-bound verification report must include exact current source/configuration identities, the exhaustive inventory and complete observed evidence; missing, failed, incomplete or stale measurements do not qualify. If a separate executable readiness helper is justified and implemented, it must reject missing, failed, incomplete, tampered or stale evidence for its bound source/configuration.

Do not replace existing statements that automatic routing is disabled with “enabled” or “qualified.” Do not claim a new readiness command exists unless a separately accepted implementation and tests actually deliver it. C7 is satisfied by independently accepted source-bound report/evidence with exhaustive coverage; no new qualification or readiness engine is required by the accepted round-2 contract.

Documentation checks after application: independent fidelity/readability check against the actual final verifier report, exact command/config inventory, disabled templates and final source identities. Links must resolve. These prose edits cannot establish runtime/provider readiness or remote delivery.
