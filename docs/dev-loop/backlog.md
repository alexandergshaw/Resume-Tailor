# Active implementation obligations

- **main-delivery**: Independently verify the delivery guard/wrapper, accept the
  final prepublication report, commit the authorized port/control changes on main,
  push origin/main normally, and inspect a live exact-commit delivery receipt.
  Owner: user. Requirements: D1-D5 in `items/main-delivery/contracts.md`.

Prior port local acceptance is historical; it does not prove publication. Runtime
publication receipts stay ignored to avoid commit identity self-reference. Product
obligations remain authoritative in `docs/backlog.yml` and are not being drained.
