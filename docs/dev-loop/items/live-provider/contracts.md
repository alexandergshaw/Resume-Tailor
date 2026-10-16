# Bounded live qualification contract

Status: proposed; independent acceptance required before calls. Coordinator owns
admission and accounting. This grants no production dispatch or product writes.

## Fixed boundary

Use the existing installed Codex executable and existing ChatGPT login only. Pin
requested model `gpt-6.1-sol`, reasoningEffort `low`, conservative context capacity
64000 tokens. These are explicit coordinator selections informed by cached
metadata, not observed runtime identity or a discovered configured default.
Record executable/source/config/schema hashes before execution. Each invocation
uses the repository's actual buildInvocation, outcomeSchema and normalizeResult
APIs, retaining raw bounded native result bytes and JSONL for independent review.

Maximum eight model invocations, maximum thirty minutes overall from first live
admission, maximum 180 seconds per child; no retries beyond that total. Reserve
one invocation for cancellation. Run serially. Stop admissions when any limit is
reached, an operation becomes uncertain, authentication fails, or a mandatory
conformance assertion fails. No paid API credential, new login, installation,
deployment, external message, product/backlog task, or production configuration.
Quota consumption is authorized; dollar cost is unavailable with no hard dollar
cap. Do not fabricate zero cost. Configure allowUnavailableUsage only under this
explicit bounded policy; do not claim provider-enforced monetary accounting.

Use an ignored isolated workspace below `.agnostic-loop/`, synthetic fixtures,
separate state/results directories and exact owned paths. Never expose real
resume, repository source, private documents or credential bytes to the packets.
Pass the known operator USERPROFILE/HOME and CODEX_HOME to the child explicitly;
whitelist Windows runtime/PATH/TEMP names only as needed. Log names, not credential
values. Existing ChatGPT authentication resides outside the fixture and is used
only by the provider. A before/after manifest covers the complete fixture,
including canaries; compare the real repository diff separately. Sandbox flags
provide defense in depth, not hostile-worker or process-tree isolation proof.

## Packet and oracle contract

Every packet has independently generated IDs, worker instance/context,
publication token, accepted input hashes and candidate digest. Each expected
WorkerOutcome must reproduce those exact values and only declared artifacts.
Outer schema, inner shape and binding checks are mandatory. Normalization alone
does not establish exact packet binding; the harness independently compares all
bindings. A valid response cannot report completed while omitting the assigned
answer/artifact or including unsupported claims.

Freeze fixture answers before launch and keep an oracle copy outside the model's
readable fixture. Checker packets contain the proposed artifact and relevant
requirements but never the hidden clean/defective label or expected verdict.
Do not give the author or checker a future call's nonce. Different thread IDs are
required for successful completed calls; missing or reused session observation
leaves freshness unproven and blocks promotion. Model identity is separately
observed only when transport reports it. A reported mismatch fails immediately.

## Serial call inventory and exact rubric

| Call | Role/profile | Task and independent pass oracle |
| --- | --- | --- |
| 1 | architect / analysis | Read synthetic `analysis-a.json`: items A cost 3, B cost 5, C cost 8, budget 8; choose subset maximizing sum of independently listed values A=4, B=7, C=10. Return B+A, cost 8, value 11 and explain budget compliance. Exact answer, valid bindings, file-derived nonce and no writes required. |
| 2 | architect / analysis | Fresh context: analogous independent input A cost 4/value 5, B cost 6/value 9, C cost 7/value 10, budget 10. Return A+B, cost 10, value 14, current nonce; do not reproduce call 1 nonce. Exact answer, bindings and unchanged manifest required. |
| 3 | implementer / execution | Read `input.txt` containing `bravo\nAlpha\nbravo\n`; write only owned `output.txt` as `Alpha\nbravo\n` (case-sensitive unique lines sorted ascending). Return declared artifact and bindings. Exact output bytes, input/canary unchanged, no extra workspace writes required. |
| 4 | checker / critical | Blindly review a supplied transformation implementation claiming case-sensitive uniqueness but lowercasing each line before deduplication. Input contract explicitly retains case. Must return defective, identify destructive case folding and concrete counterexample `A\na\n`, with no fabricated execution or unrelated findings. Bind review to exact artifact hash. |
| 5 | checker / critical | Blind clean control implementing exact case-sensitive uniqueness and ordinal ordering with terminal newline. Must return clean, no blocking findings and correct artifact hash; no invented defects or execution claims. Use deterministic ASCII examples to avoid locale ambiguity. |
| 6 | implementer / execution | Fresh context: independent `input.txt` contains `z\na\nz\nB\n`; exact owned output is `B\na\nz\n`. Current nonce, exact bindings, input/canary unchanged and no extra writes. |
| 7 | supervised cancellation / no quality score | In a separate synthetic fixture, instruct a harmless bounded local delay without writes/network. Admit the existing real process supervisor, retain handle and operation record; cancel only after an observed running operation, then inspect direct/descendant process state and fixture manifest. See cancellation rule below. |
| 8 | reserved only | At most one mechanical replacement for a call that failed solely before model generation (prove no terminal generation/usage). No repair of failed semantic quality by repeated prompting. A consumed/uncertain request counts toward eight. |

Implementation details for the two blind review artifacts are frozen and hashed
by the harness before call 1. A clean candidate may use an explicit ASCII ordinal
sort; its artifact must have actually inspected semantics matching the stated
contract. The seeded mutation is actual lowercasing behavior, not a label in a
review prompt. An independent checker validates both fixtures and their oracle
before admission. Calls 1/2 test narrow file-based analysis; calls 3/6 test narrow
owned-file transformation; calls 4/5 test narrow defect discrimination. None
establishes broad software-engineering competence or calibrated model superiority.

Each quality profile has two required observations and a binary score: 100 only
if both pass every stated oracle, otherwise 0 and not qualified. Routing minimum
score is 100. No partial average, self-rating, author endorsement or post-hoc
threshold change. Critical profile needs both true-positive defect detection and
the clean-control true negative. Independent verification judges explanations
and actual artifacts; model-returned claims are data, never gate evidence.

## Accounting, failures, controls and cancellation

For each completed call require terminal turn.completed and integer nonnegative
input/output token counts as parsed by normalizeResult. Retain native transport
for comparison; any turn.failed/error, missing final file, malformed result,
unknown exit/termination, mismatch or extra workspace write fails conformance.
Missing monetary cost is an explicit residual, not a failure of token observation.
Unavailable model/settings observations remain null. Configure
requireObservedModel:false only because qualification is explicitly for the
requested target and pinned executable/configuration, with exact actual model
unproven; do not describe requested identity as actual. If the owner requires
actual model proof, that requirement remains blocking rather than weakening it.

Use host-side isolated copies of one successful response to mutate publication
token, packet hash, candidate digest, accepted input hash and session ID reuse,
and to corrupt outer/inner schema. Verify each changed byte exists and the proper
validator/import rejects it. The unchanged response is the positive control. Use
an actual unexpected fixture write as the out-of-scope manifest mutation, then
restore its bytes and prove the restored control passes. These need no live calls
and must never alter accepted source evidence or active worker files.

Cancellation success requires observed running admission, publication fenced,
no result import, actual process/descendant observations and unchanged write
manifest. The existing supervisor intentionally records uncertain termination on
kill; do not override it merely because the direct PID disappeared. If direct or
descendant termination cannot be established, retain reservations and unknown
operation, stop admissions and withhold automatic dispatch. If no running interval
can be observed before natural completion, cancellation is unproven; do not call
that success or use a dangerous forced-writer experiment. A fresh checker must
judge the retained observations before any reconciliation acknowledgement.

## Promotion and independent acceptance

No profile is promoted unless shared schema/binding/freshness/read-write/accounting
and cancellation conditions pass, both profile-specific oracles pass, required
host-side mutation controls pass, and an independent verifier accepts the actual
evidence. Independent checking of the final verification artifact is required.
Qualification expiry is at most 24 hours after the final successful measurement,
and never extends an executable/configuration/evidence identity change. Record
profiles individually; unavailable or failed evidence cannot qualify them.

Any generated qualification uses explicit operator-attestation semantics after
independent measured evidence acceptance; the existing command is not itself a
live evaluator. Keeping a provider enabled inside an isolated qualification file
is distinct from granting/configuring production automatic dispatch. Production
configuration, exact backlog item/path/gate grant, finite job/deadline budget and
repository delivery remain separate coordinator obligations. No `drive` on the
real repository is authorized by this document.

