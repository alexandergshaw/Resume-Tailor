# Bounded backlog dispatch setup proposal

This is an author proposal, not a configured store or grant. **Admission blocker:
the existing supervisor's assignment deadline cannot accommodate the required
repository gates. Do not consume the startup recipe until the deadline prerequisite
below is independently resolved.** The owner's current
request authorizes enabling automatic backlog dispatch and pushing each verified
chunk to main. The later priority instruction selects N166 (camera-sourced live
and practice interview questions) before N92. Root owns backlog intake and the
exact N166 source/test inventory; this document does not fabricate those paths.

## Fixed execution boundary

Use repository `C:/Users/alexa/OneDrive/Documents/Projects/Resume-Tailor`, actor
`operator`, a new ignored store `.agnostic-loop/backlog-dispatch/N166/state`,
setup files in `.agnostic-loop/backlog-dispatch/N166/setup`, and generated role
artifacts in `.agnostic-loop/backlog-dispatch/N166/artifacts`. Never reuse or
mutate qualification experiment stores. Root records the actual start time and
sets both policy and routing deadline to that time plus 7,200,000 ms, bounded
also by qualification expiry 1792260933318. Maximum 32 provider jobs and 32
assignments, concurrency 1, provider timeout 180,000 ms. Gates have a separate
1,800,000 ms timeout; they must fit the remaining overall run budget and a correctly
admitted assignment lifetime. The existing engine does not yet establish that
assignment lifetime (see prerequisite below). No automatic
renewal, retry budget reset, expiry extension or replacement grant is permitted.

This bounded session uses the existing signed-in ChatGPT CLI and account quota.
No API-key billing, login, installation, deployment, provider API calls outside
that CLI, external messages or worker Git writes are authorized. Null cost remains
unknown. Routing must use `mode: unbounded`, `maxMicroUsd: null`,
`allowUnavailableUsage: true` because the transport has no dollar enforcement;
"unbounded" describes monetary accounting, not the finite job/time limit.

Copy provider, target and qualifications byte-equivalent as JSON values from the
already attested `.agnostic-loop/live-provider/qualification-proposal/routing.qualification-only.json`.
Do not change provider settings, environment-key ordering, timeout, executable,
model, enabled bits, context size or target settings, as their canonical fingerprint
is qualified. Requested model is gpt-6.1-sol, low effort, elevated Windows backend,
64k context. Actual model/settings and monetary cost remain unobserved.

Keep the existing role profiles: criteria, architect, specialist, planner, checker
and test-designer critical; implementer and transcriber execution; verifier and
finalizer analysis. Every profile threshold stays 100 and requireObservedModel
false. Every dispatched role has a fresh real instance/context; no author reviews
its own artifact. Default repository templates are broader than this proposal and
must not be admitted unchanged.

## Policy and grant construction

Use `repositoryPolicy` as the command-registration source, then narrow explicitly:

- Owner/operator and absolute workspace as above; actions read, write, review,
  run and import only; concurrency 1; maxAssignments 32; deadline as above.
- Node executable `C:/Program Files/nodejs/node.exe`. Each gate executable is
  that absolute path, arguments `[absolute tools/repository-gate.mjs, selector]`,
  resource `[workspace]`. Register engine→engine, verification→test,
  regression→test, lint→lint, build→build, backlog→backlog. The runner launches
  from repository root; this wrapper explicitly selects hello-world cwd and the
  installed app instruments. No separate application typecheck exists.
- Environment names: PATH, SYSTEMROOT, WINDIR, COMSPEC, TEMP, TMP, USERPROFILE,
  HOME, CODEX_HOME, APPDATA, LOCALAPPDATA. Scope HOME/USERPROFILE to the existing
  user's home and CODEX_HOME to the existing Codex directory in the host launch
  environment; do not copy authentication bytes into the workspace. No API-key
  names or secret values enter policy/docs. NODE_ENV is production by the runner.
- Candidate exclusions: .git, node_modules, .next, .agnostic-loop,
  dispatch-artifacts, hello-world/node_modules, hello-world/.next,
  hello-world/coverage, hello-world/public/mediapipe/wasm, and the exact private
  .claude/settings.local.json. Explicitly add the artifactDirectory string itself
  to exclusions because configureDispatch requires exact membership. Inventory
  other generated output before init; do not hide source directories to avoid drift.
- externalFiles is empty unless a separately checked verification input requires
  otherwise. Source/evidence/EXE freshness below remains a host preflight obligation.
- Grant allowConfigure and allowLocalDelivery true only after independent setup
  acceptance and root admission. Gate names are all six registered names.
  pathPrefixes is the exact accepted N166 source/test file list plus its generated
  artifact directory; never use hello-world, docs or tools as blanket prefixes.
  Exclude backlog, host state, provider/engine source, configuration, credentials,
  .git and private settings from worker writes. Root alone reconciles backlog and
  host records and performs Git delivery.

The authoritative backlog has null owns/verify. Root must first obtain checked
N166 intake with exact production/test files, observable requirement IDs, exclusion
and security/privacy boundaries. Then freeze `workflow.json` with exactly
`schemaVersion:1, id:N166, objective, owns:[exact accepted files], verify:null,
requirements:[accepted IDs]`. `verify:null` does not waive gates: independently
checked scope must name all six gates, and item.configure records them. Include
the full accepted objective and binding prior product decisions, without resetting
any prior substantive activity review counts. The engine intake itself does not
select/reorder backlog items. N92 is next only after N166 delivery and a new checked
explicit intake. Do not grant arbitrary future backlog files now.

Backlog and generated Markdown remain inside the execution candidate. Root queues
new backlog additions until BEFORE initial bootstrap or AFTER the WHOLE current
item has completed and all its operations/assignments are quiescent. A gap between
two jobs is insufficient: changing these files then would stale whole-candidate
gate/report evidence even though artifact output bytes might remain unchanged.
No new candidate exclusions are introduced. Before bootstrap, root independently
checks and publishes the control/backlog/host-document baseline, then passes the
live delivery guard. After whole-item completion, publish the verified product
source first; only then apply queued additions and completed-obligation
reconciliation as a separately checked metadata-only commit. Both publications
require normal push and live delivery guard. Only then may root select the next
item from the latest owner-prioritized backlog and freeze its independently checked
intake. The precise two-publication procedure is in [delivery-lifecycle.md](delivery-lifecycle.md).
This rule also governs later proposal/grant wording; "no active assignment" alone
is not the backlog-edit admission condition.

## Mandatory no-generation freshness preflight

Before configure and before **each** bounded drive invocation, root performs and
records an independent-checkable projection under the ignored setup directory:

1. Rehash the exact evidence-manifest file and match qualification.evidenceHash.
   Verify all 22 source-map entries and every manifest evidence entry against
   current bytes, not mutable ledger status. Check the frozen ledger separately.
2. Hash raw executable bytes and compare manifest executable.sha256. Independently
   run the real installed-version/help probe and compare its executableHash with
   qualification.executableHash. These hashes intentionally differ: probe hash is
   SHA256(canonical({absoluteExecutablePath: rawSHA256})), including absolute prefix
   file hashes if any; raw executable SHA256 is not that aggregate fingerprint.
3. Match canonical outcome schema, provider/target fingerprint, adapter version,
   all qualification profiles, score, expiration and accepted final/review evidence.
   Check launch environment names and existing login status without reading secrets.
4. Match checked workflow/grant exact paths; trusted config/policy hashes; clean or
   explicitly accounted current source candidate; no live/unknown assignments in
   any store touching these paths/caches; root's measured remaining job/time budget.
   Source mutations/tests/docs edits are serialized with dispatch and gates.
5. A mismatch stops admission. Do not re-attest changed measurements, bump expiry,
   rewrite manifest hashes or label cached receipts fresh. Route affected evidence
   to measurement/review. Root owns this procedural source guard; current engine
   does not transitively rehash the qualification manifest's source/evidence maps.

The engine additionally rereads qualification evidenceHash and probes executable
identity during launch, but this does not replace the transitive host preflight.
Use drive maxSteps 1, inspect its actual job/result/diff and repeat preflight before
the next call; this prevents a long multi-launch drive silently outliving a host
freshness observation. No provider source changes are required by this setup plan.

## Blocking prerequisite: gate-bearing assignment lifetime

Actual `supervisor-process.ts:79` creates every assignment with deadline
`min(policy.deadline, budget.deadline, now + provider.timeoutMs + 30000)`. Keeping
the measured provider timeout180000 means only210000 ms for the entire assignment.
Verification and final-report run all required gates serially **before** spawning
the model (`:83`), while implementation waves run their gates **after** the model
(`:145`). Both consume that same admitted lifetime. The already measured full
engine gate358s and full app gate245s individually exceed210s, before adding other
gates or the model call. This is a concrete incompatibility, not hypothetical risk.

`runner.ts` can observe operation termination after expiry, but
`engine.ts:evidence.record` calls liveAssignment for a zero exit code and rejects
expired assignment evidence. Artifact/review/report publication and assignment
finish also require liveAssignment. `store.ts:createAssignmentMonitor` currently
checks status only, so a command running past the deadline is not automatically
fenced by that monitor. Raising policy.commandTimeout to30minutes does not extend
assignment authority and cannot make this execution valid.

No existing config-only independent assignment-lifetime control was found. Raising
provider.timeoutMs changes the qualified provider fingerprint and misstates the
180-second child bound; dropping gates or substituting host pretests would weaken
the accepted workflow. Splitting these exact registered full gates is not a
config-only remedy either, and cannot assert equivalent whole-suite evidence.

Recommended receiver is a **separate scoped engine deadline repair**, authored,
independently checked and tested before any gate-bearing production stage. Its
contract should keep the provider invocation bound180s and the current target
fingerprint, while admitting assignment time for the actual serialized registered
gate plan plus bounded provider execution/import, clamped to existing fixed
policy/run/qualification deadlines. Define whether the sum of per-gate maxima can
fit the remaining run; reject impossible admission rather than silently extending
it. Gate execution should be bounded by remaining assignment/run authority and
the command timeout, with honest unknown-operation recovery. Test slow successful
gate followed by model/import, failed-gate repair, expiry rejection, cancellation,
insufficient-budget admission and meaningful defect controls. Never patch live
assignment deadlines or reset a store after timeout to bypass the enforcer.

This repair changes qualification-manifest-bound supervisor/runner/store source
if implemented there. It therefore also needs independently accepted exact source
delta/executed-path mapping and refreshed affected recovery/live qualification
evidence before production dispatch; copying new hashes into the old manifest is
not qualification. Root decides and admits that bounded repair. Preparation and
reversible product work may continue through the honest manual protocol meanwhile,
but no full automatic verification/finalization claim is supported. A limited
artifact-only automatic stage could be separately admitted after its own checked
scope, but does not cure this overall blocker or authorize later gate stages.

## Startup recipe after prerequisite acceptance and supervised continuation

After root writes and checks the concrete files, from repository root:

```powershell
node tools/loop.mjs dispatch configure --state .agnostic-loop/backlog-dispatch/N166/state --config .agnostic-loop/backlog-dispatch/N166/setup/routing.json --policy .agnostic-loop/backlog-dispatch/N166/setup/policy.json --workspace C:/Users/alexa/OneDrive/Documents/Projects/Resume-Tailor --actor operator
node tools/loop.mjs dispatch status --state .agnostic-loop/backlog-dispatch/N166/state --config .agnostic-loop/backlog-dispatch/N166/setup/routing.json --workflow .agnostic-loop/backlog-dispatch/N166/setup/workflow.json --item N166 --actor operator
node tools/loop.mjs dispatch drive --state .agnostic-loop/backlog-dispatch/N166/state --config .agnostic-loop/backlog-dispatch/N166/setup/routing.json --workflow .agnostic-loop/backlog-dispatch/N166/setup/workflow.json --item N166 --max-steps 1 --actor operator
```

Configure probes but does not generate. Retain actual handles, JSON, exit codes,
source hashes, packets, native outputs and usage. A successful command or completed
worker is not semantic acceptance. Inspections must confirm current artifacts,
two-round constraints, actual role independence, criterion coverage, mutation
detection and all mandatory gates; a scoped author cannot redefine its grant.
The engine drives design/test/implementation/check/verification/final stages; root
remains present to inspect transitions and independent current evidence.

At engine complete, independently audit the final report and whole source diff.
Before any metadata edits, capture immutable engine evidence and prove the current
candidate equals the accepted verification/final-report and required gate
candidates. Publish the product-only commit, pass live delivery and handoff, and
retain its exact commit/candidate receipts ignored. Then independently check the
metadata-only bookkeeping delta, its unchanged-source mapping and backlog gate;
publish that second commit and pass live delivery. Do not portray the old store as
fresh for the metadata candidate: handoff is a recorded-state assertion and does
not rerun candidate checks. See the linked lifecycle note for actual semantics.
Never start the next chunk before both required publications are verified.

## Stop and recovery boundaries

The supervisor is a foreground controller, not a wakeup scheduler. Ending this
chat cannot establish continued execution. No automation or detached daemon is
created. Stop admission on exhausted budget, owner-needed decision, failed/stale
mandatory evidence, unknown operation, path drift, private output or expired
qualification. Preserve locks and consumption. Do not use maxSteps stops as a
reason to replace a store or reset review counts.

Current monitors call child.kill and deliberately mark timeout/cancel uncertain;
they do not establish all descendants stopped. Observe owned PID/creation-time
trees and side effects, including delayed writers, before explicit recovery
acknowledgement. Never kill unrelated processes, remove locks, restore shared
files or publish a late result while ownership is uncertain. Controlled prior
cancellation evidence is not universal hostile-process confinement.

Known instrument limits remain visible: provider child output cap 1 MiB; gate
output cap 1 MiB; a cap/timeout is failed or uncertain measurement, not pass. Full
app gates may exceed a provider child's 180-second generation timeout; supervisor
runs verification/final-report gates before the worker and implementation-wave
gates after worker completion, with the gate timeout and admitted assignment bounds.
Candidate scanning includes nonexcluded files, not merely Git tracked files;
prepare exclusions and inspect candidate before init. No live camera/browser,
privacy, accessibility, authenticated app/provider integration or production
behavior is established by engine fixtures or qualification smoke tests. N166
scope must name its actual instruments and honest residuals.

No configure, dispatch, grant file or provider call was executed by this author.
