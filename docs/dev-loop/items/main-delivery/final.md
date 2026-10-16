# Main delivery control — prepublication report

Owner instruction: **always push to main; tighten that control**. This explicitly
authorizes normal publication of the verified port and this control to origin/main.
It does not enable providers or authorize deployment commands.

The standing requirement is now first in root `AGENTS.md` and documented in the
operator workflow. Root `loop:delivery` verifies a clean attached main, the fixed
intended fetch/push destination, and live remote main equal to exact local HEAD;
it rejects unavailable, ambiguous or stale remote observations and local drift.
Git optional locks are disabled so the check does not refresh the index.

Root `loop:handoff` composes engine acceptance with this publication guard. Local
completion is separately exposed as `localComplete`; overall `complete:true` and
exit zero require both conditions. Pending local work skips remote verification.
Generic reusable engine shipment remains local, and old accepted port reports
remain historical records rather than remote-publication proof.

`verification.md` records independently executed gates and actual wrapper probes,
including explicit synthetic-state limitations. `contracts.check.md` and
`implementation.check.r2.md` identify accepted contracts and source. The final
prepublication check must accept current report bytes before committing. Applicable
prior application verification remains recorded in `../port/verification.md`;
this Git/wrapper/documentation delta does not change application source.

Publication is **not established by this tracked report**. After acceptance, the
coordinator must stage only authorized paths, commit on main, push origin/main
normally, run the live guard, and save its exact commit/remote observation under
ignored `.agnostic-loop/main-delivery-receipt.json`. Independent post-push review
checks that observation against live Git. Any bookkeeping commit must itself be
pushed and verified before completion. Receipts are never committed, avoiding
self-referential commit IDs. Neither a cached receipt nor local `shipped` status
can substitute for a new live guard observation.

The exact pre-existing private settings file is ignored and excluded from staging.
Provider dispatch remains disabled; prior supervisor and privileged-symlink
verification limits are preserved. A remote snapshot is a time-bound observation,
not an atomic lock on future GitHub updates. No force push or protection bypass
is authorized; an actual publication blocker must remain explicitly pending.
