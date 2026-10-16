# Main delivery contract

Item `main-delivery`; author `/root/main_contract`; independent acceptance pending.
Owner ruling: "always push to main. tighten that control". Scope is the authorized
loop port plus repository delivery control; no force push, deployment, provider
activation, installation, login, spending or messages.

| ID | Acceptance criterion and instrument |
| --- | --- |
| D1 | Persistent instructions require applicable verification, commit on main, normal push origin/main and live delivery guard before claiming overall delivery. Engine shipped remains local acceptance. Independent documentation review verifies this distinction. |
| D2 | Production `loop:delivery` is read-only and succeeds only for attached clean main, intended origin fetch URL and every push URL, and live `git ls-remote origin refs/heads/main` equal to HEAD. No production relaxation flags. Git integration tests and live post-push guard establish results. |
| D3 | Wrong/detached branch; tracked/staged/nonignored untracked dirt; missing, wrong, unavailable or ambiguous origin/ref; remote inequality; startup-to-ending HEAD, branch, cleanliness or destination drift fail nonzero with useful diagnostics. Stale tracking refs cannot pass. Isolated negative fixtures verify failure and recovery. |
| D4 | Root `loop:handoff` composes local completion and repository delivery: expose `localComplete` and `repositoryDelivery`; local incomplete skips network verification, local complete plus failed remote guard yields `complete:false`/nonzero, and only both passing permit `complete:true`/zero. Composition tests and wrapper review verify this; generic engine local semantics stay intact. |
| D5 | Preserve historical local reports and private `.claude/settings.local.json` bytes, ignore that exact private file, commit authorized candidate and normal-push main. Store independently checked release receipt under ignored runtime storage with actual commit/push/live-guard evidence. No self-referential receipt commit. Candidate and release review verify this. |

The advantage over a chat promise is machine rejection of unpublished local work,
including through the repository's user-facing handoff. Diagnostics identify the
failed condition and commit IDs without credentials. Security, reliability and
operations review apply to destination authority, subprocess failure and freshness;
no UI/accessibility work is triggered.

Implement a standalone Node guard with structured Git argv, bounded waits and
fail-closed parsing. Verify the fixed production origin
`https://github.com/alexandergshaw/Resume-Tailor.git`, including all effective push
URLs. Recheck initial HEAD, branch, status and destinations after live query. This
is a time-bound observation, not atomic remote locking. Reuse guard logic from a
repository-specific handoff wrapper; preserve generic engine APIs. Tests may inject
fixture destinations or verifier functions through internal interfaces, never
production CLI relaxation flags.

Exact implementation paths are finalized in the coordinator's bounded packet:
new delivery guard/wrapper and tests, root package script and ignore, AGENTS.md and
relevant dev-loop delivery guidance/reports. No product source changes. Serialize
Git writes and workspace gates. First independently accept this contract, then
implement and independently review current bytes, independently verify, check the
final report, commit/push, and independently inspect the ignored release receipt.

Oracle: disposable Git repositories and local bare remotes only; no test network.
Positive control is clean attached main with matching remote. Independently inspect
fixture refs/status. Mutate one condition per negative case, including staged,
tracked and nested untracked dirt, detached/wrong branch, destination mismatch,
multiple push URLs, missing/unavailable remote, missing ref, unequal remote, and
stale origin/main while another fixture clone advances the actual bare remote.
A controlled subprocess seam changes HEAD during live query; prove old/new IDs
differ and reject the stale answer. Compare refs/config/status before and after
ordinary calls to detect mutation. Repair failed fixtures and confirm success.
Composition tests inject harmless verifiers to prove skipped checks and both-gate
truth table. Isolated source mutation controls disable equality, cleanliness and
ending HEAD checks; corresponding tests must detect each actual mutation, then
restore fixture bytes.

Run mandatory `npm.cmd run loop:test` plus isolated delivery/wrapper tests. Existing
accepted unchanged port evidence remains historical; no expensive app or offline
diagnostic rerun is needed solely for this Git/control/docs delta. A changed port
or app source requires affected gates again. Verifier maps D1-D5 to actual evidence;
independent checker accepts verification/final reports. No claim of live delivery
until normal push and real live guard succeed. If blocked, report exact pending
handoff. Host notes remain manual coordination, not fabricated engine acceptance.
