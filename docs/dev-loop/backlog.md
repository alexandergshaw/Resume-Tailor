# Active implementation obligations

- **recovery**: Complete the exhaustive offline supervisor/recovery diagnostic and
  mandatory regression, independently accept source-bound evidence and final report,
  reconcile tests and remaining qualification limits, then normal-push main and
  pass the live exact-commit delivery guard. Owner: user. Criteria C1-C8 are in
  `items/recovery/contracts.md`. Provider templates remain disabled.

N163-N165 were added to the authoritative product backlog and published in
`e1689cf`; this request does not authorize implementing those features or draining
other product work. Existing product priorities remain in `docs/backlog.yml`.

Historical local shipped statuses and old receipts never prove current remote
publication. Current HEAD requires a new live `npm.cmd run loop:delivery` check.
