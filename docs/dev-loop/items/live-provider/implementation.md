# Adapter implementation handoff

Authored against accepted adapter plan (root supplied plan prefix 9E949BAE and
check D76EC314A6A24E613A6DD8365FD7C9AB14D9970E0D824D901533E322CCFC68DA).
This is author verification, not independent acceptance. No live model call,
ledger mutation, budget extension, sandbox provisioning or provider enabling.

Changed only providers.ts, providers.test.ts and narrow USAGE.md operator note:
Codex accepts optional windowsSandbox literal elevated, rejects invalid/empty
values and emits its config after exec alongside reasoning. Existing default
argument vector and role sandbox grants remain unchanged. Other native adapters'
allowlists and command adapter extensibility remain unchanged.

Actual file SHA256:

| Path | SHA256 |
| --- | --- |
| tools/agnostic-loop/providers.ts | 3D57B6167EE0967ED554ECB7E0895546E932DA229B2E9B503FA3B5DBDC83C3D8 |
| tools/agnostic-loop/providers.test.ts | 60C3901D2950FAA169715347177E2E4FA1FB037B51829691FB1471B2EBA185D9 |
| docs/dev-loop/USAGE.md | AB359E17579D49D3AE78A0A01465ABC821E841135BB7B6C3465327DDD4C7A1B1 |

Author command:
`node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.config.mjs tools/agnostic-loop/providers.test.ts`
exited zero: 1 file, 6 tests passed. A prior attempt using
vitest.dispatch.config.mjs exited one with no test files because that config
includes supervisor/dispatch-entry only; it was an instrument selection error,
not a passing test or candidate failure.

Isolated mutation command:
`node .agnostic-loop/live-provider/provider-adapter-mutations.mjs`
exited zero. It copied the actual module/test tree into ignored per-case paths,
never changed shared source, and recorded source/candidate hashes and logs in
provider-adapter-mutations.json and provider-adapter-mutation-copies/:

- Baseline and restored controls: all 6 tests passed, exit zero.
- Actual mutation moving windows.sandbox config before exec: exactly the command-
  locality test failed, 5 others passed, exit one. Candidate hash
  49ea8b003739297afbe4ce7e860ea60cc3772a93d6319e573e7f47d823bcf9dc.
- Actual mutation removing backend value rejection: exactly invalid-backend test
  failed, 5 others passed, exit one. Candidate hash
  e31cb5e40227f9fd562a8f73706e079c8a493e04f7ac5b87f5aa245e46244989.
- Both mutations differed from baseline; no signal/timeout/error; shared source
  hash remained identical after all copies. Test logs were inspected to confirm
  intended assertions, not unrelated failures, detected each defect.

Independent whole-diff review and verifier-owned mandatory core tests remain
pending. Offline supervisor diagnostic evidence needs explicit source-delta/path
mapping or fresh measurements; live qualification remains unproven. Previously
failed provider attempts remain failed and consumed. Root owns remaining live
budget decision, independent final acceptance and commit/push/loop:delivery.
