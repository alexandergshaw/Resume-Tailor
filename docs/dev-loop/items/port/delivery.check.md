# Independent delivery review

Reviewer: fresh-context `/root/delivery_check`, independent of implementation and verification authorship. Review remains open pending final verification and final-report bytes; no final delivery verdict is issued.

## Round 1 finding — NEW: inherited gate-name acceptance (P2)

`tools/repository-gate.mjs` selects `commands[process.argv[2]]` from a plain object. Inherited names bypass the unknown-command branch and spawn Node with undefined arguments. A bounded `spawnSync` control with closed stdin and a 2000ms timeout observed `unknown` exiting 1 with the expected diagnostic, while `constructor`, `toString` and `__proto__` each exited 0 with no output. This gives an unregistered operator gate name a false successful outcome. Trusted generated policy uses constant legitimate names; the probe establishes false acceptance, not arbitrary command authority.

Required correction: own-key validation of the exact registered gate names and negative controls for inherited/unknown names. Stopping need: implementation correction and independent delivery delta check; do not claim local delivery before refreshed affected verification. No unrelated implementation findings are reopened.

Observed command: `node -e` calling `spawnSync(process.execPath, ['tools/repository-gate.mjs', name], {timeout:2000,input:'',encoding:'utf8'})` for the four names above; exited 0 as a probe, each child status separately observed. Host escalation was required for Node ancestor realpath EPERM.

## Round 1 finding — NEW: backlog example requires an undisclosed dispatch store (P2)

The explicit backlog section of `USAGE.md` presents `dispatch status` using the manual setup's `.agnostic-loop/run`. Code inspection establishes that this command calls `dispatchStatus`, then `loadJournal`, which reads `dispatch-config.json` and `dispatch-journal.json`. Manual `init` does not create these; separate `configure` requires a fixed dispatch grant intentionally absent from this workflow. Thus the advertised example cannot inspect an eligible ID after the preceding authorized manual setup.

Required correction: explicitly label this as a reference for a separately authorized, configured fixed-grant dispatch store with a distinct example path; identify manual `item.create` as the authorized path in this guide. No new engine feature or dispatch grant is requested. This is an operator-contract mismatch, not evidence that the adapter library or its rejection tests fail. Stopping need: documentation correction and independent delta check.

## Round 2 delta and final-report acceptance

Verdict: **accepted for bounded local manual delivery**. Stopping need: **nothing for independent delivery review**. Both round-1 defect classes are resolved; there are no remaining blockers in this review. The coordinator must still execute and record its manual completion audit before advancing the host item to shipped. This verdict neither ships an engine-store item nor grants provider enablement.

Exact accepted SHA256 bytes:

- `verification.md`: `724f4fdc126f5db3065ebf63839f376ea3be326db7b1c0c9818c40e3e8f40771`
- `final.md`: `c88206bb536f3fa44f2e9ea3c4ad2d194972ef853c0fe70b01643da9927bb029`
- `../../USAGE.md`: `772a87de1c70fc4f56f452c5d39b71bd12f276b704ca3e24eb77ec29428eb3a5` (actual repository path `docs/dev-loop/USAGE.md`)
- `tools/repository-gate.mjs`: `7d591b6092fc12cf93a20f526f2a481b899e7a576afedc18d5a177440acbbedf`
- `tools/agnostic-loop/repository.test.ts`: `87ba8b3d335772fbdd4fefe50ddc210a686fe735cb95ba9aca4d2fe5347493bf`
- ignored final tools manifest: `ddd0adbabfcbdeeb650e81bc5634eaafc627e33d7c188206b38f717313f20a89`

### Delta judgments

Inherited gate acceptance: resolved by exact `Object.hasOwn` admission before lookup. Final test control checks unknown and inherited names for exit 1, no stdout, corrective stderr and no timeout. Independent verifier's actual `repository-final.log` records 1 file/15 tests passing in 2.78s; positive backlog output records 156 items/0 violations. No gate command or shell authority was added.

Undisclosed dispatch prerequisites: resolved by labeling the example reference-only for a separately authorized already-configured dispatch store, using a distinct store path, and stating that manual init/no-grant setup does not suffice. Manual operators are directed to checked exact scope and `item.create`. This does not expand authorization.

### Evidence and report audit

Read actual final reports, accepted contract/review chain, relevant implementation/tests, source manifest, operator workflow and generated disabled setup. Independently computed every tools-manifest path hash: final manifest has zero mismatches; initial manifest differs at exactly `repository.test.ts` and `repository-gate.mjs`, matching the recorded final affected rerun. Checked current report/hash identities with `Get-FileHash -Algorithm SHA256`.

Actual app/backlog/build/targeted-test logs support the reported outcomes. Dispatch log contains startup only, consistent with an incomplete diagnostic and no invented failure/count verdict. Recorded process inventory identifies the exact diagnostic tree. Termination/reconciliation observations are the independent verifier's measurement record, not a newly executed process-tree test by this checker. Full mandatory-suite quantities are attributed to the independent verifier's executed command record; this checker did not duplicate the broad suite. Existing app source/configuration/backlog preservation is consistent with the inspected working tree.

P1–P9 each have an examined-object/instrument mapping. The final report preserves the mandatory engine/manual gate pass, final affected gate-name rerun, separate application regression outcomes, isolated mutation controls, host EPERM/skipped cases, incomplete supervisor diagnostic, and live-provider limitations. It does not turn fixture shipment into delivery of this port or recorded status inspection into execution. The independent implementation review covers the prior candidate, and this review accepts the two current corrections and exact final documentation/report bytes.

Residuals identify owners, settling instruments and measurement conditions for privileged symlinks, full offline supervisor/repair diagnostics, live provider/accounting/process/service observations, and existing application skips. These do not excuse a failed mandatory manual gate; no such unresolved failure is reported. Automatic dispatch remains disabled/unqualified. Security/reliability/operations triggers and CLI-only omission of visual/accessibility/live-service seats are addressed within the bounded capability.

At review time manual `state.json` is still revision 3/verifying, active backlog still contains port, and no engine-store shipment is claimed. Coordinator completion must reconcile the active obligation and retain the residual registry/status pointers, append its observed transition, and preserve these exact accepted report bytes. These are mechanical host bookkeeping steps after acceptance, not another substantive review round.

