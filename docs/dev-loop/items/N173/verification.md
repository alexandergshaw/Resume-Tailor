# N173 — Explain rejected search saves

Candidate: base main `4299ec0555bdb2068098f24c7d10bf95722eb609` plus the five paths in joined source freeze `10E15B6101F9307E9BE010C42B3246FBB1BFCF750C32D47BEBB2835DFE3DD563`. Two production files changed: the apply route and existing chat hook. Remaining paths are the new save-error tests and bounded additions to existing route/panel tests. This explicit owner request uses the manual workflow; no automatic dispatch grant is renewed.

The supplied activity log establishes chat POST 200 followed by apply POST 400 at 2026-10-17T14:49:56Z. It omits response bodies, so the exact failed field in that production attempt remains unknown. Actual source showed the hook replacing all non-schema rejection reasons with generic copy. The fix adds stable known response codes and displays status-consistent fixed explanations, reachable next steps and retained-draft guidance. Exact existing legacy messages are recognized for older route deployments. Unknown responses state that no specific reason was supplied and show the HTTP status; raw server/database text is not echoed.

## Criteria and independent evidence

| Criterion | Actual evidence | Result and limit |
|---|---|---|
| E1 actionable known rejection | Real route tests, actual-hook tests, root CUA rendering and deliberate retry | Missing name, unsupported documents, sign-in, search limit and schema setup have distinct fixed guidance. Definite rejections retain the proposal and permit retry. |
| E2 honest unknown/uncertain handling | Status-mismatch and hostile-body tests; malformed rejected versus successful response tests; transport/missing-ID controls | Unknown responses cannot fabricate a cap/name/schema diagnosis. Malformed non-OK bodies retain definite HTTP rejection; malformed/lost successes retain the uncertainty lock. |
| E3 safe diagnostics | Actual activity singleton assertions with private account/draft/server canaries; exact event-key oracle | `feed-config` / `save.failed` contains only fixed normalized reason and bounded numeric status, alongside ordinary ledger metadata. Uncertain events use a fixed outcome code. No draft, names, keywords, IDs or raw errors are added. |
| E4 preserved behavior | Existing route security guards, callback and Panel lifecycle tests, actual-hook success/retry | Auth-owned sanitized writes, explicit save, single-flight and account/stale callback fences remain unchanged. Full regression and remaining mandatory gates are separate below. |

Independent plan, implementation and measurement judgments are adjacent checked artifacts. Five actual focused files passed 54 assertions with numeric exit zero. The first invocation incorrectly used repository root without the app Vitest configuration and collected zero assertions with exit one; it is preserved as setup failure, not a product failure or test pass. Root corrected the working directory, retained the initial evidence and reconciled process closure before rerunning.

The isolated mutation instrument copied only the hook and its new test, imported actual repository configuration/setup, and pinned the source inputs. Baseline/no-op passed; replacing the actionable missing-name message with the former generic mask caused the named guidance assertion to fail with exit one; exact restoration passed. The first pre-use review caught a mismatched test full name before execution; its corrected Round 2 instrument was accepted. No third substantive review or masked failed assertion occurred.

Root CUA drove the actual local Panel/hook/components with synthetic API/account responses: successful proposal, missing-name 400, limit 409, auth 401, schema 409 and unknown 400; each showed its distinct safe explanation and kept Save available. A final explicit success retry created one synthetic row, showed Saved and disabled duplicate Save. The actual screenshot and observations received independent artifact review. The synthetic missing-name scenario proves representation, not the cause of the owner's production 400. Actual route behavior is separately exercised against the existing mocked Supabase boundary; no live database/provider/authentication or deployed-fix verification is claimed.

Root retained actual handles and positive Node canaries, reconciled mutation/browser-owned processes and released their resources before full regression. Raw logs, numeric receipts, policies, hashes and screenshots live under ignored `.agnostic-loop/backlog-dispatch/N166/runtime/N173/`. No user attachment or raw private search content is committed.

## Gates and delivery

All registered application gates passed serially against the unchanged candidate. `node tools/repository-gate.mjs test` exited zero: 1,318 files passed/one skipped, 20,607 assertions passed/nine skipped, 564.28 seconds. `lint` exited zero (81.26 seconds); `build` exited zero (33.14 seconds); `backlog` exited zero (159 items, zero violations, generated Markdown matches). The build emitted its existing middleware-convention deprecation warning. Exact stdout/receipts and admissions are retained in runtime. The full test used only the independently checked process-local `VITEST_MAX_WORKERS=4` resource control; no test filters or timeout increases. Engine evidence is narrowly reused through the adjacent independent engine check: 76 unchanged source/config inputs, accepted prior 154 passes/two Windows skips, and the unchanged backlog identity covered by the refreshed N171 selected-case pass. This is not a fresh full-engine run.

After the actual final gate handle completed, root ran a positive Node canary and reconciled owned processes; none remained. All five frozen paths were rehashed with zero drift. The original focused setup failure remains preserved and is not a passed execution. No mandatory failure is waived.

Final independent report acceptance, scoped main commit/push and live `npm.cmd run loop:delivery` are required before repository delivery. Exact remote identity belongs in the ignored receipt and owner response, avoiding a receipt commit that invalidates itself. N172's separate template/rendering-dependent resume repair remains pending and is not changed by this bug fix.

