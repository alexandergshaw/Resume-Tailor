# Independent verification

Verifier: fresh worker `/root/verifier`, 2026-10-16. No implementation authorship. Verdict: **bounded manual port verified**, subject to independent acceptance of this report. This report does not mark any runtime store or host coordination item shipped.

Inputs: accepted `contracts.md` and contract reviews, implementation round-2 acceptance, actual source/tests, workflow guidance. Base revision `6c4befea900a4ac239eb95f258c6a708a3708e8c`. Initial pre-existing `.claude/settings.local.json` remains present; application source/configuration and authoritative backlog are unchanged by this port.

## Candidate and freshness

Initial tools manifest `.agnostic-loop/verification/candidate-tools.sha256` SHA256 `b8d4dcafcf1b4ede5898dddb9d9fedee0951f73fd1a76c636cf208666508ea9d` binds the full mandatory run. Final manifest `.agnostic-loop/verification/candidate-tools-final.sha256` SHA256 `ddd0adbabfcbdeeb650e81bc5634eaafc627e33d7c188206b38f717313f20a89` was compared byte-for-byte by path. Exactly two tools files changed afterward: the gate wrapper's own-property name guard and its targeted tests. Final affected tests and positive registered gate were rerun independently; all other tools bytes remain identical. No broad rerun is substituted for the explicit affected-delta measurement.

Final SHA256 identities:

- `tools/repository-gate.mjs`: `7d591b6092fc12cf93a20f526f2a481b899e7a576afedc18d5a177440acbbedf`
- `tools/agnostic-loop/repository.test.ts`: `87ba8b3d335772fbdd4fefe50ddc210a686fe735cb95ba9aca4d2fe5347493bf`
- `docs/dev-loop/USAGE.md`: `772a87de1c70fc4f56f452c5d39b71bd12f276b704ca3e24eb77ec29428eb3a5`

Host documentation/coordination records are separate from runtime store evidence. Their edits do not turn the isolated fixture's shipped item into shipment of this port. Runtime commands required authorized sandbox escalation because default Node realpath encounters EPERM at the Windows user ancestor.

## Executed instruments

| Command | Observed outcome |
|---|---|
| `npm.cmd run loop:test` | Exit 0; 19 files passed; 129 tests passed, 2 skipped (131); 334.06s, start 06:28:03 America/Chicago |
| `node hello-world/node_modules/vitest/vitest.mjs run --config tools/vitest.config.mjs tools/agnostic-loop/repository.test.ts` | Final guard delta: exit 0; 1 file/15 tests passed; 2.78s, start 07:13:42; ignored `verification/repository-final.log` |
| `node tools/repository-gate.mjs lint` | Exit 0; no diagnostics; ignored `verification/lint.log` |
| `node tools/repository-gate.mjs backlog` | Exit 0 before and after final guard; generated Markdown matches; 156 items, 0 violations; ignored `verification/backlog.log` |
| `node tools/repository-gate.mjs build` | Exit 0; MediaPipe staging and Next production build completed; ignored `verification/build.log` |
| `node tools/repository-gate.mjs test` | Exit 0; 1294 files passed, 1 skipped (1295); 20418 tests passed, 9 skipped (20427); 270.36s, start 06:37:47; ignored `verification/app-test.log` |
| `npm.cmd run loop:test:dispatch` | **Incomplete at overall 30-minute bound**, then exit 1 from explicit termination; no test-count or failure summary was emitted. This is neither a passing diagnostic nor demonstrated recovery defect; ignored `verification/dispatch.log` |

Application fixture stderr included missing git HEAD, malformed CLI option, and jsdom unsupported methods; the final application test verdict passed. No unrelated baseline failure was observed in completed app gates. Application test discovery/configuration remain unchanged. `git diff --check` passed after final measurements (only informational CRLF conversion notices).

Mandatory tests executed both isolated mutation families: security self-review and stale-candidate defects, and repository blocker-bypass defect. Instruments require defect detection and original/no-op/restored controls; adapter mutation confirms exact mutant bytes, and security mutation verifies restored hash and untouched production original. Their passing suite result establishes detection for these deliberate defects, not arbitrary adversarial correctness.

The mandatory suite's two skipped cases are `escaped rejects after hit and restoration revalidates` and `symlink rejects after hit and restoration revalidates` in `store.test.ts`. These are the only source skip branches and catch symlink EPERM, restore the backup, then skip. Privileged symlink behavior remains unproven here. Existing application skips likewise remain limitations, not measured coverage.

## CLI and repository measurements

Real repository template under ignored `.agnostic-loop/verification/setup` used command kind and Node executable, with disabled provider/target, zero qualifications and no configure/local-delivery authority. Inspection confirmed real absolute gate wrapper paths, shared workspace resources, source retained in candidate capture, and application dependency/generated exclusions. Init of `.agnostic-loop/verification/run` succeeded at revision 0. A separate process status succeeded with no items/assignments/operations; candidate `b5491215f4a0300febb8535a8fd74bb5a96060f13ff4fac138d08866b05ddd2a` identifies that smoke observation, not the final mutable documentation tree.

Root help emitted structured successful command discovery; malformed `not-a-command` emitted `ok:false` with corrective action and exit 1. Root handoff forwarding with an unknown item exited 1 and stated no transition/recovery performed. Full successful lifecycle and restart controls were already executed by conformance tests using actual CLI subprocesses; manual-handoff tests covered positive completion and negative retained-work checks. Repeating the full lifecycle was unnecessary.

Source dependency absence scan `rg -n 'src/tools|teaching-assistant|C:/Users|C:\\Users' tools -g '*.ts' -g '*.mjs'` found no matches. The identical pattern found a known-positive teaching-assistant canary under ignored verification evidence. This is a bounded source-path absence claim.

## Criteria and independent evidence

| Criterion | Object/instrument and result |
|---|---|
| P1 | Root smoke and repository test establish local launch, help/status/error transport; canary-backed scan establishes no source-checkout runtime paths: pass |
| P2 | adapter/store/atomic/conformance tests exercise restart, CAS, immutable bytes, identical/conflicting event replay: pass |
| P3 | engine/conformance/mutation tests reject instance/context reuse, scope/resource overlap and exhausted/expired admission: pass |
| P4 | candidate/import/runner/engine/mutation tests reject forged identity/token/authority and stale bytes/evidence; preserve round cap: pass |
| P5 | engine/runner/conformance/store/handoff tests reject premature completion, fence cancellation and preserve unknown-operation reservations: pass |
| P6 | repository policy and final guard tests plus all registered instrument paths measured; default-disabled routing inspected: pass for manual scope; automatic recovery unqualified |
| P7 | repository and blocker-mutation tests cover explicit intake, unchanged real YAML, disappeared blockers, invalid proof/duplicates/scope and shipped rejection: pass |
| P8 | actual CLI lifecycle/restart, manual-handoff tests and independently checked operator docs establish reproducible manual operation and supervision limitations: pass |
| P9 | dedicated root suite green, final affected tests green, all application gates green; offline supervisor diagnostic honestly incomplete within command bound: pass for required manual-port gate, diagnostic residual retained |

Advantage over chat: persisted revision-checked handoffs, immutable imported bytes and evidence-bound rejection of premature completion survive actual CLI process restarts. Structured errors/status, event history and observed gate records expose failure causes. Security/reliability/operations concerns were exercised by negative, persistence, recovery and mutation instruments. No new browser surface/data path was introduced, so accessibility/visual review was not triggered. This is not evidence of semantic model judgment, hostile-worker isolation, live providers or process-tree guarantees for arbitrary third-party tools.

## Diagnostic reconciliation and residuals

At 07:13:23 the diagnostic root PID74564 was confirmed as the exact dispatch Vitest config. Its descendants were recorded in ignored `verification/dispatch-processes-before-stop.json`; taskkill `/PID 74564 /T /F` reported termination of74564,88032,87952,73644. Recorded owned IDs were observed absent afterward; session40506 exited1. Child fixture turnover had progressed through entry/status, reentry, verification/final-report diagnostics and checkpoint mutation stages, but no terminal test verdict was available. An older coordinator duplicate mandatory run had separately been terminated/reconciled and contributes no passing evidence.

| Requirement/residual | Owner | Settling instrument and condition |
|---|---|---|
| Privileged symlink branches | Repository operator | Rerun `store.test.ts` on a host permitting file symlinks; require both named cases execute and pass |
| Full offline supervisor/failed-gate repair diagnostic | Operator responsible for any future automatic enablement | Run `loop:test:dispatch` with a deliberately reviewed suitable execution window and inspect actual complete verdict, including failed-gate repair/mutation paths; keep dispatch disabled until qualified |
| Live provider identity/access, usage, arbitrary process descendants and production behavior | Owner of separately authorized integration work | Qualified live-provider/integration/process-tree instruments under explicit authority; no fixture or template substitutes |
| Existing skipped app tests | Application owners | Execute their existing instruments when required resources/conditions exist; this port does not alter them |

No installation, login, paid dispatch, deployment, external messages or live-provider calls occurred. No retained verifier process or unresolved mandatory manual-port failure remains. Independent acceptance of this report and final delivery report, followed by the coordinator's separate completion audit, remain required before local host-state shipment.
