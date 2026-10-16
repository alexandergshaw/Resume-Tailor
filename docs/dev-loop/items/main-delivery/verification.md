# Independent main-delivery verification

Verifier `/root/main_verify`, fresh context, authored no implementation. Verdict:
prepublication implementation verification passes; actual repository delivery is
pending commit, normal push and an independently checked live receipt. This report
requires independent acceptance before downstream finalization.

Inputs: accepted contract SHA256
`56F1B182CC84F2E453177553553D88AF5DC262FA74E9C50CE757F8174E9C5552`,
`contracts.check.md`, `implementation.check.md` and accepted
`implementation.check.r2.md`; actual source, tests, root scripts and guidance.
Base HEAD: `6c4befea900a4ac239eb95f258c6a708a3708e8c`. Node observed
`v22.14.0`; Windows/PowerShell. Tests required host execution outside the restricted
sandbox for Node ancestor metadata access; no installation, provider dispatch,
main-checkout Git mutation, push or network test was performed by this verifier.

## Candidate identities

SHA256, measured before and after the mandatory suite:

| Object | SHA256 |
| --- | --- |
| `tools/main-delivery.mjs` | `CC3C18B61211D0DE288B119C12DA3B3D0C926188A0C41B23A85A0CFC97DCB3B5` |
| `tools/loop.mjs` | `1085366A9DBD5C97BF2FB6DAA938D36836E59DC20A484BDDFCEF941564DEE637` |
| `tools/agnostic-loop/main-delivery.test.ts` | `B012F2DDB7819E0B03E7BDD636246DEC38B2947B8FDBEB50C82C1029A01982FC` |

Root package SHA256 `228E6B30BD9131D9146D61D885B5D68DDE1C5DF1E7D5B461D1B50E2F66CCD79B`;
AGENTS SHA256 `512D20E67A81C4868D3B8B431B32DC9CCC86A236426E452C0600DDA94CCAE44B`;
ignore SHA256 `55CEB733E9772BCBB85149CFA04235597CB4756DDD76F83BCF075B6A491CEAE6`.
These match the accepted implementation review bytes. Runtime evidence directory:
`.agnostic-loop/main-delivery-verification/` (ignored).

## Measured commands

| Command | Observed result |
| --- | --- |
| `npm.cmd run loop:test` | Exit 0; 20 files passed; 151 tests passed, 2 skipped (153); start 09:12:40 local 2026-10-16, duration 356.37s. `loop-test.log` and `loop-test.exit`. Includes all 22 delivery/composition cases. |
| `npm.cmd run loop:delivery` | Exit 1 as expected before commit; structured `ok:false`, `complete:false`, error says tracked, staged or nonignored untracked changes remain; `dirty-guard.log` and `.exit`. The dirty condition prevents any live remote query. |
| `node --experimental-strip-types --experimental-default-type=module --experimental-loader ./tools/resolve-ts-hook.ts .agnostic-loop/main-delivery-verification/wrapper-probe.ts` | Exit 0 for probe assertions. The probe invokes actual `node tools/loop.mjs handoff STORE ITEM` in subprocesses. Synthetic ready-to-build item: exit 2, `localComplete:false`, `complete:false`, remote skipped. Synthetic shipped item: exit 2, `localComplete:true`, repository guard rejects actual dirty repository, `complete:false`. Unknown item: exit 1, `complete:false`. All fixture state bytes unchanged. `wrapper-ready-to-build.json`, `wrapper-shipped.json`, `wrapper-unknown.json`. |
| `git check-ignore .claude/settings.local.json .agnostic-loop/main-delivery-verification/loop-test.log` | Both exact paths ignored. |
| `git diff --name-only -- docs/loop hello-world docs/backlog.yml docs/BACKLOG.md` | Empty output: no tracked historical, application or backlog changes. |

The wrapper store was explicitly synthetic, written only under ignored evidence
storage; its shipped marker proves wiring, not valid engine acceptance. Positive
both-gate behavior is established by the passing composition fixture, not a live
production delivery claim.

The runner reported two skips. Inspection of the included test sources identifies
the only runtime skip branch in `store.test.ts`: `escaped rejects after hit and
restoration revalidates` and `symlink rejects after hit and restoration revalidates`
skip on Windows symlink EPERM after restoring the backup. Those privileged
observations remain unproven. The static search's positive canary was that explicit
`context.skip()` branch; the other `describe.skip` occurrence is an excluded
dispatch-diagnostic file. No delivery test is skipped.

## Criterion evidence

| Criterion | Examined object, oracle, observed result |
| --- | --- |
| D1 | AGENTS, USAGE, WORKFLOW and README independently reviewed; persistent policy requires verification, scoped main commit, normal origin/main push and live guard, and distinguishes historical/local engine completion. Pass for implemented policy. |
| D2 | Actual guard uses fixed production workspace/origin, structured bounded Git argv, optional locks disabled, live ls-remote strict parsing/equality and ending snapshot. Passing real-Git fixture accepts matching clean attached main and preserves refs/config/status; timestamp-touch case compares actual index bytes without intervening status and passes. Production dirty rejection measured. Pass for implementation/offline behavior; successful real remote observation pending release. |
| D3 | Passing isolated Git cases reject tracked/staged/nested untracked dirt, wrong/detached branch, wrong/default destination, multiple push URLs, missing/unavailable remote/ref, unpublished local HEAD, actual remote advance behind stale tracking ref, and HEAD change during query. Dirt recovery passes. Exact ending snapshot code also rechecks branch, cleanliness and all destinations; separate runtime branch/status/destination drift injections were not run. Strict output regex rejects ambiguity by source inspection. Pass within these stated static/runtime evidence limits. |
| D4 | Actual root wrapper subprocess probes establish pending/unknown nonzero and synthetic locally complete plus real guard failure remains incomplete. Passing composition cases establish skipped verifier, thrown-verifier failure and both-success truth table. Actual generic manual-handoff tests retain local shipped success semantics; wrapper source preserves generic engine APIs. Pass. |
| D5 | Exact private ignore confirmed, private bytes unchanged across verifier execution: SHA256 `753EE55BE3D27AB1ED5B996442B93C5B14E1FF49166047D02C2E7B669488C2BD`. Historical/product tracked paths unchanged. Ignored receipt design avoids self-referential commit. Preservation implementation passes; actual scoped commit, push and receipt acceptance remain pending coordinator/release checker. |

Mutation controls ran within the mandatory suite: each source needle is asserted
present, isolated mutant bytes differ and are read back; disabling equality,
cleanliness or ending-snapshot checks causes the deliberately invalid fixture to
be accepted, showing the corresponding rejection oracle detects that defect.
Production source is compared to its original bytes afterwards. No shared source
mutation or restoration occurred.

Security, reliability and operations concerns are addressed by accepted source
review and measured destination/failure/freshness/read-only cases. CLI-only scope
introduces no visual/accessibility path. The concrete advantage is executable
rejection of unpublished local work through both delivery and handoff commands;
structured diagnostics expose the failed condition. This is a time-bound live
observation mechanism, without atomic locking of remote writers.

The accepted contract exempts repeat expensive unchanged app gates and offline
supervisor diagnostics for this isolated Git/control/docs delta. Prior accepted
port evidence remains historical; no fresh application, supervisor, live-provider,
production, process-tree-isolation or privileged-symlink result is claimed here.

Pending D2/D5 release measurement belongs to the coordinator and independent release
checker: independently accept current reports, commit only authorized source and
records on main, push normally to origin/main, run `npm.cmd run loop:delivery`,
retain exact commit/push/live JSON evidence under ignored runtime storage, verify
clean main and actual remote equality, and independently inspect that receipt.
No overall shipped/delivered claim is authorized by this prepublication report.
