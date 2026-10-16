# Independent contract delta check — round 2

Reviewer: `/root/contract_check`, 2026-10-16; independent of contract authorship.
Reviewed object: `docs/dev-loop/items/port/contracts.md`.
SHA256: `690c6d24d5a933082211903ce49cfd25627221ee73519475a80a83a0fc868e85`.
Instrument: `Get-FileHash docs/dev-loop/items/port/contracts.md -Algorithm SHA256`; read revised contract against round-1 findings.

Verdict: **accepted**. Stopping need: **nothing**. No remaining blocker and no new substantive review round required.

- Selector-scope expansion: resolved. P7 and architecture explicitly require ID-selected intake, preserve engine activity scheduling, and exclude a new product queue selector/preview.
- Baseline-failure completion contradiction: resolved. P9, test design and residual clause consistently require mandatory engine/manual-port gates green, separately record app/source diagnostics, and require correction of introduced regressions without expanding scope into unrelated baseline application failures or unattended repair.
- Undefined proof oracle: resolved. Architecture fixes the oracle to existing `validateContract` semantics, names the relevant proof checks and provenance limits, and P7 requires stale-hash and zero-kill fixtures. `verifyProofViolations` is internal to that existing validator; invoking the exported `validateContract` is the intended reuse, not a requirement to export or directly import its private helper.

Root `AGENTS.md` is included as the repository workflow entry within the authorized workflow-documentation surface. This acceptance covers contract fidelity only; it establishes no implementation/test outcome.
