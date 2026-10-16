# Remaining obligations

- **live-provider**: Bounded qualification is independently accepted and recorded
  through the operator-attestation CLI for analysis, execution and critical profiles.
  Implementation was published and live-verified at `b3cb828`. Production dispatch needs a separate exact
  grant and fresh manifest comparison; automatic dispatch remains disabled.
- **N97**: Implementation and independent verification are complete, including
  original Gemini template recovery and fact-derived versions. N97, N89 and N101
  were reconciled in the authoritative backlog; generated backlog checks pass
  with 156 remaining items. Implementation was published and live-verified at
  `b3cb828`. Live RLS, browser
  and Word measurements retain their explicit receivers in `state.json`.

Offline recovery verification is complete and independently accepted in
`items/recovery/verification.md` and `items/recovery/final.md`. Its implementation
was normal-pushed and independently live-verified at `cd38b60`. No offline recovery
implementation obligation remains. Any bookkeeping HEAD still requires its own
normal push and live exact-commit delivery guard.

Automatic provider dispatch remains disabled. The qualification-only configuration
expires at 2026-10-17T18:15:33.318Z; relevant drift invalidates its measured basis.
Existing privileged symlink and application skipped-coverage obligations
retain their owners and instruments in `state.json`.

N163-N165 were added to the authoritative product backlog and published in
`e1689cf`. The later instruction to start working through the backlog authorizes
product work in the existing priority order, without moving those additions ahead
of earlier items. The source of truth remains `docs/backlog.yml`.

Historical local shipped statuses and old receipts never prove current remote
publication. Current HEAD requires a new live `npm.cmd run loop:delivery` check.
