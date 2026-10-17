# N166 / N175 frozen-wave mandatory verification

Verifier: native `/root/email_checker`, independent of both product implementers and the handoff-fixture/reachability-repair author. Requested/observed model and token usage unavailable. This report records actual local instruments, not live-app, provider, deployment or Git delivery acceptance. Another independent instance must check this report before downstream acceptance.

## Candidate and instruments

Base HEAD: `757b05fbda0254e7048c9a96a202c79b7c8eb235`. Exact current manifest: ignored `.agnostic-loop/backlog-N166-camera/gates/source-config-r3-before.json`, SHA256 `96718376A2E39298BA694C4823351234EA48822644D31CC75719161F66D2F440`. It binds **23 authored source/accounting paths plus 9 shared configuration/backlog inputs**: 15 camera paths, 4 N175 paths, the manual-handoff fixture, and 3 additional reachability accounting files. The camera helper is included once with current `F5A15F4722D28F62053FBDED3ACA4EF7A0BF007F60373D44FEEA7475684BB662` identity. All other camera and N175 bytes match their accepted source checks. Fixture `2D669466432AD88C7EADAEBF74431760973ECB7CC3A73AFE2DDF807DFBD8D601` and accounting identities match their separate implementation checks.

Final readback `source-config-final.json`, SHA256 `664A057CC4FDE5CCA8F050E09236D5656757E99D1CB04F25A9FEF6344DE097AD`, reports all **32 unchanged**. The nine shared inputs are app Vitest config/setup, root Vitest config, gate wrapper, both package manifests, installed app lockfile and both authoritative/generated backlog files. Source writing stopped before current gates; test/cache resources were held exclusively and all gates ran serially.

Executable: installed `C:/Program Files/nodejs/node.exe`, observed v22.14.0. `npm.cmd run loop:test` resolves the root package's existing Vitest command with `tools/vitest.config.mjs`; application wrappers use the actual checked-in `tools/repository-gate.mjs`. Its test/lint/build/backlog argument arrays were read before execution. Relevant environment names recorded without values in `gates/instruments.json`: PATH, NODE_OPTIONS, CI, NEXT_TELEMETRY_DISABLED, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY. The build reported use of `.env.local`; contents/secrets were not recorded. No installation, standalone app typecheck, deployment command, paid dispatch or credential action occurred. Fixed host verification deadline remained 2026-10-17T22:10:00Z.

## Current mandatory outcomes

All UTC intervals below are on 2026-10-17. Every command ran from repository root; wrapper-owned app commands use `hello-world/`. Every actual exit was captured before any output handling. Raw logs/JSON and exit/timing receipts are retained under ignored `.agnostic-loop/backlog-N166-camera/gates/`.

| Required instrument / exact command | Actual interval | Outcome and receipt |
| --- | --- | --- |
| engine: `npm.cmd run loop:test -- --reporter=json --outputFile=.agnostic-loop/backlog-N166-camera/gates/engine-r3.json` | 21:01:49.7987882Z–21:08:02.2250689Z | exit 0; 187 passed, 0 failed, 2 skipped; `engine-r3.json`, `.log`, `.receipt.json` |
| verification and regression: `node tools/repository-gate.mjs test` | 21:09:08.6221171Z–21:13:09.4766538Z | exit 0; 1326 files passed, 1 file skipped; 20663 tests passed, 0 failed, 9 skipped; `app-test-r2.log`, `.receipt.json` |
| lint: `node tools/repository-gate.mjs lint` | 21:13:51.7066077Z–21:15:02.4806160Z | exit 0, no diagnostics; `lint.log`, `.receipt.json` |
| build: `node tools/repository-gate.mjs build` | 21:15:11.8592493Z–21:15:39.0824897Z | exit 0, production compilation and route generation succeeded; `build.log`, `.receipt.json` |
| backlog: `node tools/repository-gate.mjs backlog` | 21:15:55.1464835Z–21:15:55.4395474Z | exit 0; generated Markdown matches source YAML, 159 items and 0 contract violations; `backlog.log`, `.receipt.json` |

Verification/regression are the same registered app instrument on the same immutable candidate; one complete run serves both gates. The engine's two existing Windows skips are the private assignment monitor escaped/symlink cases; these are not hostile process-isolation passes. App skip quantities are actual suite output, not executed successes. Expected negative-path Git/CAC messages and jsdom unsupported-browser-method messages appeared in the passing app log. Build retained the existing Next middleware-to-proxy deprecation warning. None was suppressed or relabeled. Next's own build-internal TypeScript step is not a separately registered app typecheck gate.

## Failed observations and bounded repairs retained

1. Original `engine` run exited 1 at 20:30:11.1274146Z–20:36:44.0968425Z: 186 passed, 1 failed, 2 skipped. Public manual-handoff child status was null at its existing 10000ms bound; testcase duration 10024.55ms. The old JSON omitted child error/signal, so timeout-compatible is the supported diagnosis, not a claimed exact OS error. The fixture had pointed candidate capture at the entire host tree. Separate independently accepted fixture work creates a tiny real candidate with a canary, preserves 10000ms/30000ms limits, executable/exits and immutability, and strengthens exact missing-live-reason checks. Focused rerun exited 0, 10 passed at 20:42:36.8459645Z–20:42:39.0848931Z (`handoff-focused.*`). Intermediate full `engine-r2` also passed 187/2 skipped at 20:42:48.7749750Z–20:49:16.8506717Z. It is historical after the later accounting repair; the current full result is `engine-r3` above.

2. First full app run exited 1 at 20:50:32.5483542Z–20:54:51.1395351Z: 20661 passed, 2 failed, 9 skipped. Exactly the reachability orphan census and TR-1 count failed. MAX_CAMERA_WIDTH/HEIGHT added two unconsumed exports; real camera-route consumption of screenshotOcr#ocrImage moved one symbol from test-only to shipping use, giving 450 rather than pinned 451. Separate checked repair removes only the two unnecessary export modifiers, preserves their runtime bounds, records the named real caller movement, and updates exact 450/515 accounting. It adds no orphan exemptions or classifier changes. Focused scanner/helper/route command `npm.cmd test -- lib/sourceScan/exportReachability.sweep.test.js lib/copilot/cameraQuestion.test.js app/api/copilot/camera-question/route.test.js --reporter=json --outputFile=../.agnostic-loop/backlog-N166-camera/gates/reachability-focused.json` from app cwd exited 0, 59 passed at 20:58:16.2559226Z–20:58:22.5808829Z. The subsequent fresh full app pass above replaces the old failed candidate outcome.

All original failed receipts/logs, pre/post manifests and process observations remain. No test assertion, timeout, mandatory gate, production guard, grant, exclusion or budget was weakened to obtain these passes.

## Reachability controls and instrument correction

Root independently prechecked exact isolated instrument bytes before execution. First `export-mutate.mjs` SHA256 `065586FD99BE16A78A5796ED6D714FB9BBADBBFFC7519C546B09DEDD36698AF1` was a setup failure: copied app/lib lacked scanner input `test/`, so baseline child exited 1 with ENOENT and zero executed tests. No mutant ran. Error/signal were absent, uncertainty false, files restored and shared source unchanged. This failed setup is retained as `export-baseline.*`, `export-mutation-receipts.json` and `export-mutation-final.json`; it is not a mutation kill or candidate failure.

Corrected independently accepted instrument `export-mutate-r2.mjs` SHA256 `45E294C7F054EF8B35D848DB3D05C1BCA475128E8AEFA04958F1B82317517AA4` uses a new isolated directory/output prefix. It includes tracked app/lib/test plus middleware and all new manifest app paths, validates the full **2191-file JS scanner universe** against the actual tree, and records hashes for every copied file (`export-universe-r2.json`, `export-copy-proof-r2.json`). It rejects missing or unknown untracked/nonmanifest scanner inputs. Original uncertainty and restored bytes were checked before reuse of any prior evidence. Before execution, actual CIM inventory included current Node PID 113312 as a positive canary, with no prior owned process. Shared source was never mutated.

The installed Node runner actually executes one scanner file with Vitest/JSON for each case; exact arguments/times/changed hashes are in `export-mutation-receipts-r2.json` and case logs. Baseline/no-op/restored require exactly 50 passed, not zero-test success. All child outcomes were terminal, with no error/signal/timeout. A hypothetical uncertain child leaves the isolated files/lock untouched until termination reconciliation; that branch was not claimed exercised.

| Isolated case | Actual result | Oracle |
| --- | --- | --- |
| `export-baseline-r2` | exit 0, 50 passed | Current full scan and existing planted-defect controls |
| `export-noop-r2` | exit 0, 50 passed | Actual harmless helper comment changed bytes without changing behavior |
| `export-mutant-orphans-r2` | exit 1, 48 passed, 2 failed | Restored public dimension exports cause exact orphan census failure; failed assertions retained |
| `export-mutant-pin-r2` | exit 1, 49 passed, 1 failed | Restored incorrect 451 test-only count fails exact TR-1 oracle |
| `export-restored-r2` | exit 0, 50 passed | Both mutated files exactly restored and scanner positive again |

Actual controls ran 21:01:11.303Z–21:01:39.861Z. Final isolated receipt records uncertainty false, lock released, both files restored and all 32 shared inputs unchanged. Earlier N175 runtime/control evidence and independently authored camera runtime/control evidence remain separate referenced measurements; this report does not fabricate having executed another verifier's tests or physical camera behavior. The current full application run includes the final source bytes.

## Resource release and remaining delivery

All gate/fixture/mutation handles are terminal and reconciled. Final `resource-release.json` SHA256 `E7D52400AB77BC6240B16F103A36247554E87410B6B20EAE0217AF428FE8C850` records 2026-10-17T21:16:06.1371197Z, a 17-Node inventory and zero owned Vitest/gate/export/Next-build/ESLint processes. No unrelated processes were terminated. Exclusive workspace/cache ownership is released.

Local mandatory gates pass for the bound candidate. Remaining coordinator obligations: independent report acceptance; scoped normal main commit/push and fresh exact remote delivery guard; deployed candidate containment; actual affected live N175 confirmation/cancel and N166 camera flows; independent evidence review and current engine live report. Build, mocked/local OCR or fixtures do not establish physical camera access, production scheduled tailoring, real provider/mail delivery or live behavior. Actual live limitations must remain pending rather than inferred from these local passes. This verifier performed no Git/browser/deployment/state/provider action.
