# N175 independent selected verification

Verifier: native `/root/email_checker`, distinct from implementer `/root/email_contract`. Base HEAD examined: `757b05fbda0254e7048c9a96a202c79b7c8eb235`. This report binds the four exact source/test hashes in `implementation.check.md` (SHA256 `DA7FDCA4FD8D099EB70585DAC7083F88B544C13130A385F18DF26376EC0FCF87`); all four matched before/after focused and isolated mutation runs. Concurrent camera source work was disjoint. This is selected N175 verification, not a whole-candidate gate or live completion claim. Report requires independent acceptance by another instance.

## Criteria and evidence

| Criterion | Instrument and observed result | Status / limit |
| --- | --- | --- |
| C1 independent auto availability and confirmation | Production composed LiveFeedTab wiring, actual labelled controls, pending/unavailable/error matrix, exact confirmed patch and cancellation/no-write, both opt-outs | Local pass; deployed observation pending coordinator |
| C2 email-specific availability and diagnostic | Same rendered matrix, configured enable control, existing-on opt-out, exact separate email patch, delayed status recovery with no preference write | Local pass; actual unavailable-message inspection pending |
| C3 preserved controls and safety | Actual whole N175 diff/callers, existing confirmation, cadence/stored-interval and recipient class guards | Selected local pass; no auth/backend contract changed |
| C4 no-email auto orchestration | Real exported cron POST, mocked deterministic dependencies; no-opt-in/refused/sent modes each queue one item and record notification/run; positive mail control; existing pause/decouple/mailConfig/spend/run-log cases | Local orchestration pass; real cron/provider/mail not exercised |
| C5 verified publication and live candidate | No Git, deployment or browser action performed by this verifier | Pending coordinator: mandatory broad gates, deployed containment, affected live flow, independent evidence review and exact remote delivery |

## Focused command

From `hello-world/`, actual `npm.cmd test -- app/components/feed/FeedAutomation.wiring.test.js app/components/feed/FeedAutomationCard.cadence.test.js app/components/feed/FeedAutomationCard.storedInterval.test.js app/components/feed/FeedEmailAlerts.wiring.test.js app/api/cron/tailor/route.autoWithoutEmail.test.js app/api/cron/tailor/route.mailConfig.test.js app/api/cron/tailor/route.pause.test.js app/api/cron/tailor/route.decouple.test.js app/api/cron/tailor/route.spendWiring.test.js app/api/cron/tailor/route.runLog.test.js --reporter=json --outputFile=../.agnostic-loop/backlog-N166-camera/N175/focused.json` exited **0: 79 passed, 0 failed, 0 pending**. UTC interval: 2026-10-17T20:13:26.2438753Z–20:14:21.0252996Z. Actual JSON, log and exit receipt: ignored `.agnostic-loop/backlog-N166-camera/N175/focused.*`.

An initial log/receipt path was accidentally based on app cwd and produced two nonignored files under `hello-world/.agnostic-loop/`. Root identified this, preserved/moved the closed original files into root ignored `N175/accidental-log-location/`; correctly located copies and root JSON remain. This was a verifier path mistake, not app source or test-data modification. Do not stage app-local logs.

## Isolated mutations and controls

Root independently reviewed the instruments before execution. Initial `mutate.mjs` SHA256 `140B59D86294D3DF6295CE657E1DC4DDF95986A9B63CFDF0EEC819309D343C3D`; continuation `mutate-continue.mjs` SHA256 `B4AE9BF795551B598499782A25336FF10BB69B5EBF5957BFE249240410566CBF`. Both ran through installed Node, copying tracked app/lib inputs plus the exact new cron test into an ignored isolated directory with its own dependency junction. Shared source was never mutated. Raw JSON/logs, full failed assertions, mutation hashes and exit/timing receipts remain under the same ignored N175 evidence directory.

| Command / case | Actual result | Intended oracle |
| --- | --- | --- |
| Initial instrument: baseline two test files | exit 0, 26 pass | Production wiring and no-email POST work in copied harness |
| Initial instrument: actual harmless Card comment | exit 0, 2 pass, 21 filtered | Changed hash with equivalent behavior; positive nonzero selection |
| Initial instrument: reintroduce email-based auto disable | exit 1, 2 fail, 21 filtered | Explicit enabled-auto and existing-on opt-out assertions fail |
| Initial instrument: add email opt-in to confirmed auto patch | child exit 1, 1 fail, 1 pass, 21 filtered | Exact callback equality at wiring test line 415 fails |
| Continuation: insert EMAIL_FROM readiness return before cron auto branch | exit 1, 2 fail, 1 pass | No-opt-in/refused cases reach reservation assertion line 102 with expected 1, actual 0; configured-mail control passes |
| Continuation: restored two files | exit 0, 26 pass, 0 fail | Restored Card/route byte hashes and behavior both match baseline |

The initial instrument itself exited 1 after the patch mutant: its message matcher expected literal `emailOnNewJobs`, but Vitest abbreviated the object as `…(2)`. This is an instrument exception, separate from the intended child test failure. It did not reach cron/restored cases. Its `finally` restored both isolated files and proved all four shared hashes unchanged. Root-reviewed continuation validated the exact failed test/source line, reconstructed the patch-mutant bytes and matched their recorded hash (`F4F3F278E740D3B031EF4A0B916B5692AE8F3824E6B14D58899537A28B74F2CE`), then ran only the outstanding cron/restored cases. Existing histories were preserved; no assertion was weakened. `patch-mutation-byte-proof.json` records that binding.

Actual initial interval: 20:15:17.288Z–20:16:14.893Z. Actual continuation interval: 20:20:03.372Z–20:20:37.465Z on 2026-10-17 UTC. Continuation process exited 0. No timeout or uncertain child termination occurred. Both final receipts confirm isolated Card and route restored and all four shared source hashes unchanged. Separate `process-release.json` at 20:20:53.2783865Z found 15 Node processes as inventory canary and zero processes matching the N175-owned path; unrelated processes were preserved. Test resource released to coordinator.

## Remaining obligations and limits

No implementation findings were discovered. Practical advantage and diagnostics are supported locally: email service availability no longer prevents explicitly confirmed document queue automation; mail unavailability remains visible and mail-only. Actual auth/ownership filters, caps/reservations, no-submission behavior, queue-before-mail order and mail refusal/unsubscribe controls are unchanged.

Root must measure all required broad gates against the final combined frozen candidate, obtain current deployed candidate identity and independently checked live confirmation/cancel observation, and normal-push/check exact clean main remote delivery. Existing optimistic setter means changed UI state cannot prove persistence; any actually changed preference needs reload/readback and reconciled disposable data. This report neither authorizes nor establishes unattended provider spend, actual live cron execution, login, email sending, deployment commands, camera behavior or full-loop shipped state.
