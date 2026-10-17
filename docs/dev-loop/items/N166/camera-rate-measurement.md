# N166 camera rate-limit mutation continuation

Independent verifier: `/root/camera_checker`; this is a separate measurement supplement, not another substantive implementation-review round. Accepted implementation report `66ED6DEB26DBC9D86051627D6944404A8424E612B291D315D83166522019337E` and its independent check remain unchanged. This measurement does not change the failing/pending status of any other mandatory gate.

The coordinator independently prechecked ignored instrument `.agnostic-loop/backlog-N166-camera/N166/mutate-rate.mjs`, SHA256 `63C925A44EA6820BDE3D9FB3F349FA4783F0A35AA81993AB8DEB2A0B16DFBC3E`, and admitted execution only after the previous whole-engine test process and descendants were reconciled. Command: installed `C:/Program Files/nodejs/node.exe .agnostic-loop/backlog-N166-camera/N166/mutate-rate.mjs`, cwd repository root. Actual host exit **0**.

The instrument binds exact camera manifest `CFE83D2437EA431F996DC40FFD6A08722E1A5A45A454E040101A47D3BBF63574`, verifies all 15 current camera files, and requires the existing ignored isolation's route and test bytes to match that manifest. No shared application source or test is mutated. The route's existing `counts ten authenticated attempts at module scope` test is selected in each child through installed Vitest with `--no-file-parallelism --maxWorkers=1`, JSON/report paths under ignored evidence, and actual child exit/error/signal capture.

| Control / defect | UTC interval, 2026-10-17 | Actual child exit | Observation |
|---|---|---|---|
| Baseline | 20:39:36.653–20:39:37.767 | 0 | Original limiter correctly rejects request eleven |
| Harmless comment change | 20:39:37.783–20:39:38.674 | 0 | Positive control survives an actual byte change |
| Fresh limiter constructed for every request | 20:39:38.703–20:39:39.628 | 1 | Intended assertion: `expected 200 to be 429` on request eleven |
| Exact restoration | 20:39:39.630–20:39:40.566 | 0 | Original module-scoped enforcement passes again |

The unique mutation replaces the decision's use of the module-scope limiter with a newly constructed `createRateLimiter({limit:10,windowMs:600000,prefix:"camera-question"})` on every request. This removes historical counting while retaining the surrounding authentication, body validation and OCR paths. The actual failing test and message establish that the registration/module-scope defect is detected; a generic nonzero process result alone was not accepted.

Original/restored route SHA256: `E199BB4A1B71152F5BB7645927DCA176E3C9B694285EA56A64FDFEF16F93A082`. Harmless control: `541E1DF1A2066C14325B71720D4C673D22B460CA7A908211FBBBCC0E5D93FFBF`. Actual mutant: `8092EA78D0A970B2475F69A13B2685FE4D238427BE6F1402D7ED41FB7974496A`. Raw evidence is retained under `.agnostic-loop/backlog-N166-camera/N166/`: `rate-mutation-receipts.json`, per-case JSON/logs, `rate-mutant-per-request.failures.json`, and `rate-mutation-final.json`. Final uncertainty is false, isolated route restoration is exact, and all 15 shared source files remain unchanged. The original ten-family mutation instrument and receipts were preserved.

Resource reconciliation at `2026-10-17T20:39:51.2243724Z` is in `rate-resource-release.json`. An owned hidden Node canary, PID 129916, was observed through CIM and actually exited. CIM found 16 other Node processes and zero owned rate/mutation-isolation processes; unrelated processes were retained. The direct host command and all child commands completed without timeout or signal. All 15 camera files still match the frozen manifest. Exclusive shared test/cache resources were returned to the coordinator at that time.

Result: **rate-enforcer oracle/control measurement passed**. This establishes local detection of the per-request-reset failure class; it does not establish distributed/fleet-wide rate enforcement, physical camera behavior, production live verification, successful whole-engine gates or Git delivery.
