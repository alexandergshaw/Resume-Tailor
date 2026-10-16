# Remaining obligations

Offline recovery verification is complete and independently accepted in
`items/recovery/verification.md` and `items/recovery/final.md`. Its implementation
was normal-pushed and independently live-verified at `cd38b60`. No offline recovery
implementation obligation remains. Any bookkeeping HEAD still requires its own
normal push and live exact-commit delivery guard.

Automatic provider dispatch remains disabled and unqualified. A concrete provider,
target, trusted grant and authorized live qualification are required before
enablement. Existing privileged symlink and application skipped-coverage obligations
retain their owners and instruments in `state.json`.

N163-N165 were added to the authoritative product backlog and published in
`e1689cf`; this request does not authorize implementing those features or draining
other product work. Existing product priorities remain in `docs/backlog.yml`.

Historical local shipped statuses and old receipts never prove current remote
publication. Current HEAD requires a new live `npm.cmd run loop:delivery` check.
