# Independent contract check

Reviewer: fresh worker `/root/contract_check`, 2026-10-16. No authorship of the reviewed contract.

Reviewed object: `docs/dev-loop/items/port/contracts.md`
SHA256: `caec82cbdb83f19277dac5c750918b19ecd2bd64ae0505f1387eceb520e2a9e2`
Instrument: `Get-FileHash docs/dev-loop/items/port/contracts.md -Algorithm SHA256`.

Verdict: **changes required before implementation consumes the contract**. Stopping need: coordinator design clarification for the three bounded classes below; no owner scope expansion is needed. This is round 1.

## Findings

1. **P2 / NEW / selector-scope expansion.** P7's shipped-top-priority-followed-by-eligible instrument and architecture's “excluded before selecting the next eligible item” require a new product backlog selector, although the scope describes a read-only preview and explicitly scoped intake. Source `cli.ts` applies explicit item events and `next` schedules activities already in engine state; it does not select product backlog intake. Preserve YAML order in preview, reject an explicitly requested shipped ID, and test that rejection without mutation. Make automatic next-product selection optional/out of scope, or explicitly define a bounded new preview-only interface. Otherwise implementers may build a second priority system unrequested by the owner.

2. **P2 / NEW / baseline-failure completion contradiction.** P9 requires the app suite/lint/build/backlog checks and the last paragraph says no residual may excuse a failed mandatory local gate, while the test section permits unchanged baseline failures and source caveats require honest reporting of unfinished repair tests. This leaves completion simultaneously permitted and forbidden for known unrelated failures. Identify the new engine/manual port tests as mandatory green for the delivered capability; run and report all source and app regressions, distinguish unchanged baseline failures and default-disabled supervisor repair failures, and require investigation of any newly introduced regression. Do not turn source repair fixtures into a requirement to finish the unattended supervisor, and do not silently omit red tests from the report.

3. **P2 / NEW / undefined backlog proof oracle.** P7 demands invalid-proof rejection, but never fixes its meaning. The repository already defines `validateContract` in `hello-world/scripts/backlog/lib/contract.mjs`: verify hash plus nonzero fails-on-head/kill and zero fix/no-op outcomes and required fields, with cited-path and dead-filter checks. Use that existing validator where practical and require those semantics at intake; missing `owns`/`verify` remains an unscoped diagnostic at the read site. Do not substitute truthiness of `verify_proof` or invent stronger authenticated-proof claims: existing proof is a checker record, not independently replayed evidence. No `verify` text may become command authority. Add a fixture where the proof object exists but its command hash is stale or its kill result is zero.

## Accepted boundaries

The remaining contract appropriately binds immutable output bytes, independent identities, transaction/revision safety, trusted policy gates, uncertainty reservations, and completion records. Root runtime isolation and repository-specific gate registration are concrete port concerns. Manual host supervision with automatic dispatch disabled is consistent with the source's explicit failed-gate repair caveat. No live provider qualification or autonomous repair completion should be inferred.

Evidence inspected: full contract; attached workflow and owner pasted request; source `adapter.ts` and `cli.ts`; target backlog schema header, `loadBacklog.mjs`, and `contract.mjs`. This is a contract review, not a passing implementation verification.
