# Read-only non-gate fixture failure analysis

Reviewer `/root/recovery_check`, 2026-10-16. No tests or source edits. Current `.agnostic-loop/recovery/baseline/verbose.log` records non-gate review failure at 2,463 ms with `Cannot read properties of undefined (reading 'status')`; a full terminal stack was not yet present when inspected. Current suite verdict remains pending.

Static defect class: **fixture predicate assumes pre-bootstrap item existence**. `createState` initializes `items: {}`. `repairFixture` initializes/configures stores without creating a product item. `nonGateControl('review')` then reaches the line-343 `until` predicate `s => s.items[f.selection.id].status === 'shipped'` without any preceding `until`/`step` that bootstraps the item. `until` evaluates its predicate before calling `step`. The dereference therefore throws before actual non-gate review behavior can be exercised. `nonGateControl('provider')` has the same control path; paused/invalidation modes first drive safely toward existing activities and do not share this initial-state precondition.

`nextActions` explicitly returns bootstrap when the selected item is absent (line 13), before dereferencing its status. Thus the evidence supports a fixture setup/oracle precondition defect, not a demonstrated runtime recovery defect. A complete stack should confirm the attribution once the active run settles; no third-party behavior or runtime success is inferred.

Minimal candidate correction: use `s.items[f.selection.id]?.status === 'shipped'` for the common non-gate delivery predicate only. Absence remains false and the real supervisor must bootstrap and complete the workflow. Keep subsequent no-nonzero-gate-evidence and no-fabricated-diagnostic assertions; preserve actual worker retry/review behavior, authority limits and all other oracles. Independently review that small fixture diff, then execute both review/provider controls and affected aggregate coverage. No fabricated baseline pass or timeout-as-detection is acceptable. Wait for current immutable-run completion and process reconciliation before edits.

Reviewed source SHA-256:

- `tools/agnostic-loop/supervisor-repair-fixtures.ts`: `8085f11e9ea8d601130cc93b09f0bcff3439f0d5773c0df10267f453c7113169`.
- `tools/agnostic-loop/next-actions.ts`: `6fe223dabff3b2171f2675e6a05e9be05dc4ed4cdd92cab65f905e1a059d2f42`.
- `tools/agnostic-loop/engine.ts`: `ecb815cdca5a7fdc7d874c2bcae0aaa905d69b5d9f6210be8507dc3e810471d7`.
