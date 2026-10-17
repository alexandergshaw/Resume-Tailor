# Reachability integration repair — independent plan check, round 1

Checker `/root/wave_report_checker`, independent of coordinator author `/root`. Reviewed exact plan SHA256 `E796C8F04624F3460A88EC47C463DB6E438C62D514387CD427FAE7310D12377E`, actual helper/route/test imports, sweep pins, ledger instructions and terminal app-gate receipt/log. No tests, source edits, state, Git mutation or external operation. Model observation and usage unavailable.

Verdict: **CHANGES REQUESTED**, one bounded scope/documentation finding. Stopping point: coordinator plan correction before author admission. This does not dispute the measured repair mechanism or reopen previously accepted implementation classes.

## NEW — REACHABILITY-HISTORY-LOCATION, blocking for the proposed exact write set

Actual exportReachability.ledger.md states that sections 4 and 5 append-only movement notes live in `exportReachability.ledger.history.md` and directs new deltas there. The proposed three paths omit that history file while requiring named TR-1 and total movement documentation in ledger.md. Following that plan literally would put the new movement in a location the current authoritative ledger explicitly says is no longer used, or leave the required append-only history absent.

Required correction: name `hello-world/lib/sourceScan/exportReachability.ledger.history.md` as the fourth exact path, append the named `screenshotOcr.js#ocrImage` test-only-to-shipping movement in section 4 and corresponding total movement in section 5, and update ledger.md current summary/identity to 450+65=515. Preserve history. State the two dimension exports become private without adding orphan exemptions. If the coordinator deliberately relocates history instead, that is a broader documentation change needing explicit scope; the narrow recommendation is the fourth-path addition. Actual source write total would become 23 distinct paths rather than 22.

## Accepted mechanism and review-cap ruling

Terminal app receipt is actual exit 1. Log shows exactly two failed assertions, 20661 passes and nine skips: orphan census adds MAX_CAMERA_HEIGHT/MAX_CAMERA_WIDTH, and TR-1 observed 450 versus pinned 451. Existing count65 need not change after removing those unused export modifiers. Actual helper uses both dimensions internally; route consumes existing ocrImage. Therefore private dimension constants plus accurately accounted movement are appropriate integration repairs, not blanket exemptions or deleted canaries. Values, bounds, auth, timeout, capture and OCR semantics must remain byte-equivalent apart from export visibility. Exact scanner pins and planted-defect assertions remain active.

This is a newly measured cross-repository export/accounting class. Prior R2 parse/lint/composed-sink issues were resolved; their corrective rules do not address this export census. A separate bounded integration activity is legitimate and does not reset or evade those prior review limits. This first plan finding concerns a newly inspected ledger convention. No third substantive source round is requested for the prior classes. Fresh focused/full app verification and independent actual-diff check remain necessary; source-relevance can justify reuse of engine evidence only with explicit binding and explanation, never by silently treating old receipts as current.

All prior failed receipts must remain. Gate status is failing/pending until actual current passes. No live, deployed containment, provider or Git publication success is established by this plan. Preserve fixed deadline and serialized resources; no automatic renewal or source admission is supplied by this check.
