# N171 — Setup chat visual overhaul

Candidate: eight paths in the accepted source freeze `AB41E3A37F5CE3A0B9106E3EEF3454A8A0B03101DD82D637BD68DAF6502A76DE`, based on main `265aee9ea5ca772524180d34869ab77d53427573`. This is a manual foreground item, not a renewed automatic-provider grant.

The three existing components now present a conversation workspace alongside an editable proposal on desktop, stacking on smaller screens. Context tools, starter prompts, speaker labels, a multiline composer, grouped settings and explicit save actions improve the previous dense form. The data path, saved-copy semantics and automatic-tailoring controls remain unchanged.

## Independent acceptance and measurements

The checked plan and its independent acceptance are adjacent files. The independent whole-source check accepted the actual three production components and three changed/new test files; two other granted tests remain unchanged. Runtime evidence lives under ignored `.agnostic-loop/backlog-dispatch/N166/runtime/N171/`.

| Criterion | Evidence | Measured boundary |
|---|---|---|
| V1 desktop hierarchy | Actual desktop screenshots, independent visual judgment, root browser measurements | Separate conversation and proposal columns at 1200/1440; integrated context tools and empty-state guidance. |
| V2 starter and transcript | Focused presentation tests, isolated starter mutation, root browser interaction | Starter prefills/focuses with zero requests; explicit submission makes one request. Long unbroken assistant text wraps. |
| V3 composer and feedback | Existing limit/wiring tests and actual keyboard/loading/error interactions | Enter adds newline; Ctrl+Enter submits once; loading disables input; 401/429/503 remain actionable. |
| V4 review | Existing real MUI tests, opened document/cadence menus, independently reviewed lower screenshots | Labels separated from controls; three existing document choices; cadence edit retained after follow-up; explicit save and Saved status. |
| V5 responsive layout | Root DOM geometry and actual scrolled screenshots | Long-message document/product client and scroll widths agree at 320/360/768/1440. Overflow canary changes the detector from false to true; restored layout fits. |
| V6 preserved semantics | Focused actual-hook/component tests and browser flow | Save, Automation callback, reopen as new proposal, schema error, uncertain-save lock/reconciliation, keyed account reset. No real provider call. |

Focused execution: eight files, 58 assertions passed, numeric exit zero. The independent verifier read the actual JSON. The starter instrument used an isolated two-file copy: baseline and no-op passed, adding implicit `onSend` caused the intended assertion to fail with exit one, and exact restoration passed. Root reconciled owned process identities before releasing the copy resource.

Browser execution was performed by root through CUA. A fresh independent worker could not access the browser; it judged the actual saved images, measurements, source and observations instead. The fixture imports actual components, hook, theme and globals, with synthetic account/fetch responses and Arial fallback. It does not prove production authentication, database/provider behavior, full-shell geometry or every font/device. Full-page capture failed; saved viewport/scrolled screenshots supply the visual evidence. A misleadingly framed desktop-review-footer image is excluded from desktop-footer claims; desktop-lower supplies that coverage.

Existing React/MUI forwarding warnings for inputProps/renderTags and the new InputLabelProps warning were observed. Rendered labels and keyboard controls were measured; these warnings are not evidence of a silent provider or persistence failure. No global MUI migration is included.

## Gate status and delivery

The registered full test retry passed: 1,317 files passed and one skipped; 20,579 assertions passed and nine skipped, 559.91 seconds, numeric exit zero. The actual wrapper command was `node tools/repository-gate.mjs test`, with process-local `VITEST_MAX_WORKERS=4`. Its receipt, raw log, admission and physical release are retained. Remaining registered gate results and independent final acceptance must be recorded before delivery. The first full run failed two default-timeout cases (20,577 passed, two failed, nine skipped). Both unchanged files subsequently passed standalone: 33 assertions, exit zero. Cause remains unknown. An independently checked retry changes only process-local `VITEST_MAX_WORKERS=4`, retaining all tests and default timeouts. Original failures remain preserved.

No deployment command or provider dispatch is authorized by this report. Repository delivery requires scoped main commit/push and a successful live `npm.cmd run loop:delivery` result for that exact commit.

## Final gate evidence

All commands ran serially against the unchanged frozen application source. `node tools/repository-gate.mjs lint` exited zero (75.60 seconds), `build` exited zero (44.21 seconds), and `backlog` exited zero (159 items, zero violations; generated Markdown matches). Build emitted the existing middleware-convention deprecation warning. Exact starts/finishes and output are retained in `final-*.receipt.json` and logs.

Engine verification narrowly reuses the independently checked prior 154 passes/two existing Windows skips: all 76 engine/configuration inputs match their accepted identities. The current backlog is a changed external input, so the exact repository test `reads the real backlog without mutating it and does not revive shipped rows` was refreshed using installed Vitest and `tools/vitest.config.mjs`: one pass, 14 filtered skips, exit zero, 2.12 seconds. The current backlog identity is `C9828F8D0E87E23163790F1B929005E75E56D2D42BEB2CF2622C26CDECD2257E`. This is not a new full-engine run. See adjacent independent engine check.

Root observed completion of the real process handles, ran a successful positive Node canary, checked for remaining owned gate processes and rehashed all eight frozen paths: no owned processes or source drift remained. Runtime receipts remain ignored. The authoritative product backlog is unchanged; this explicitly requested visual item used the bounded manual workflow. No unrelated backlog item is marked complete.

N172 is a separate, independently accepted structural diagnosis, not a repaired resume. Its corrected report and review are in the adjacent N172 directory. The exact template branch and rendered-page verification remain pending. Those limits do not block the independently deliverable presentation change.

Independent final review must accept the current report and scoped diff before root commits. After publication, the live remote identity is recorded in the ignored delivery receipt and owner-facing response, avoiding a self-invalidating receipt commit.

