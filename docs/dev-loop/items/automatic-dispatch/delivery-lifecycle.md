# Automatic-item publication and later bookkeeping

This procedure preserves the existing whole-candidate evidence boundary. It adds
no candidate exclusions, engine transitions, gates or authority. Root alone owns
Git delivery, backlog/host records and publication receipts; workers cannot expand
their product grant.

## Actual guard semantics

`engine.ts:item.advance` validates current artifacts and, for shipped, verifyFinal:
the final and verification reports and required passing gate evidence must match
the actual current candidate. This is a live transition check, not a future
guarantee. `store.load` later checks stored/reference integrity without recapturing
the current candidate.

`manual-handoff.ts:assessManualHandoff` examines recorded shipped status, retained
assignments, outstanding operations, owner-needed activities and item needs. Its
CLI calls store.load only. Root `loop:handoff` then invokes the live clean-main/
exact-origin delivery check. Thus handoff can still return complete after an
unrelated metadata edit has made the old whole-candidate evidence stale. That
structural result must not be described as fresh candidate verification.

Even normal status's staleArtifacts list is insufficient: store.observeArtifacts
checks each artifact's own current output bytes, not report/gate whole-candidate
equality. A report's bytes can remain intact while its candidate is historical.

## Two publications per completed item

1. Before bootstrap, independently check, commit and push the control/backlog/host
   baseline and pass `npm.cmd run loop:delivery`. Otherwise a later product-only
   commit could leave preexisting host changes dirty. Keep this metadata fixed for
   the entire item, including gaps between jobs; queue new additions until whole
   item completion and quiescence.
2. At actual engine shipped, inspect the full source diff and independent final
   acceptance. Capture an immutable ignored receipt with store snapshot/event and
   artifact/report/evidence hashes, current candidate, accepted policy/tool/
   environment identities, workflow/grant identity and no outstanding ownership,
   operations or blocking needs. Independently establish current candidate equality
   with the accepted final report, verification report and each required successful
   gate evidence candidate. Status/shipped text alone cannot establish this.
3. Stage only the verified product chunk, commit on main, push normally and run
   `npm.cmd run loop:delivery` plus `npm.cmd run loop:handoff -- STORE ITEM`.
   Git metadata is already excluded; verify candidate bytes remain unchanged across
   publication. Freeze the actual source commit, exact live remote identity and
   successful receipts under ignored runtime storage. No tracked receipt commit
   should recursively alter its own candidate identity.
4. Only now reconcile completed backlog obligations, render generated Markdown,
   apply queued additions and update host documentation. Bind those records to the
   immutable SOURCE commit/candidate/engine proof. Independently inspect the exact
   metadata-only path list and mechanically prove every other candidate file is
   identical to the source candidate, with policy/tool/environment identities
   unchanged. Run the actual backlog validation for YAML/generated Markdown and
   any other instrument triggered by the actual metadata change. Changes to gates,
   policy or executable behavior are outside this metadata-only procedure.
5. Commit that accepted bookkeeping separately, push normally, and pass the live
   delivery guard again. Record its parent/source mapping. Do not claim the prior
   engine store is fresh for this new candidate; a post-bookkeeping handoff may
   return structural complete without proving freshness. Full app regression is
   not repeated merely to cover a proven unrelated metadata-only delta; relevant
   changed behavior or unresolved mapping requires its real applicable checks.
6. Start the next independently scoped item only after both publications pass
   their guards. Select from the latest owner-prioritized backlog and record a new
   finite grant; do not reset the completed item's evidence, review counts or budget.

Final reporting distinguishes engine acceptance for the SOURCE candidate from the
latest repository HEAD containing independently checked bookkeeping. Both exact
commits and their relationship must be recoverable, while only the latest clean
main/live origin equality establishes current repository delivery. Historical
engine acceptance is not silently upgraded to new whole-candidate acceptance.
