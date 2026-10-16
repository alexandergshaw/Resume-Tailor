# Independent implementation review — round 1

Reviewer: fresh-context `/root/implementation_check`, 2026-10-16. The reviewer did not author implementation, tests, or usage documents. Reviewed accepted contract `contracts.md` and its round-2 acceptance, root manifest/launchers/loader/gate adapter, repository intake/policy/tests, candidate capture, manual handoff, related dispatch selection/admission boundaries, copied mutation-test module layout, and operator/workflow documents. Source provenance was inspected in `source-manifest.json`; this review does not authenticate upstream acceptance.

Verdict: **changes required**. Stopping need: **implementation correction, then independent delta check**. Findings are NEW defect classes; no prior implementation round exists.

## P1 — proof-bearing backlog intake cannot parse (NEW: incompatible proof representation)

Object: `tools/agnostic-loop/repository-backlog.ts` SHA256 `7c1790da544765c35f6e026d7a85e32e4e180cb42595cd48274a1b6520220e41`, plus `repository.test.ts` SHA256 `8aa5994144411b435657013c1b822b46b370f765c51c94e8f5c781c308055942`.

The adapter directly invokes existing `parseBacklogYaml`, whose scalar grammar permits only null, double-quoted strings and arrays. The validator requires `verify_proof` to be an object containing numeric exit observations. Therefore no non-null valid proof can traverse this intake. The positive repository fixture itself serializes its proof as `{...}`, which the parser rejects before contract validation. This defeats P7's positive scoped-intake path and makes stale-hash/zero-kill tests fail for the wrong reason.

Observed instrument: read-only Node parser probe with `verify_proof: {"command_sha256":"x"}` returned `yamlLite: unrecognized scalar at line 2: {"command_sha256":"x"}`. Default execution first hit host EPERM reading `C:\Users\alexa`; the same bounded read-only probe ran successfully after escalation. No broad suite was duplicated.

Required correction: provide a narrow adapter-local proof-object representation, preserving the existing product parser and validating reattached objects through existing `validateContract`. Add positive intake and independent invalid-proof controls that actually reach proof validation. Do not mutate product YAML to manufacture scope/proof.

## P1 — duplicate fields can erase blockers (NEW: overwrite-based constraint loss)

The reused parser assigns `current[key]` without duplicate detection. A malformed row containing `blocked_by: ["N1"]` then `blocked_by: []` silently loses its unconditional blocker. This violates P7's malformed-record rejection and unconditional dependency preservation. A duplicate ID field can similarly replace the primary identity. Rejecting only duplicate rows or duplicate `verify_proof` fields does not cover the mechanism.

Observed instrument: same read-only Node probe parsed `- id: "N999"\n  blocked_by: ["N1"]\n  blocked_by: []` as `[{"id":"N999","blocked_by":[]}]`.

Required correction: adapter preflight rejects every duplicate field within each item, including `id`, before reusing the parser or accepting any selection. Add a blocked-then-empty fixture and a normal no-op control. Do not change product parser behavior as unrelated scope.

## P2 — documented entry/recovery examples mismatch executable contract (NEW: operator contract mismatch)

`USAGE.md` documents `npm.cmd run loop -- help`, but neither the launcher nor CLI currently accepts `help`. Its recovery example supplies descriptive acknowledgement text, while the runner requires the literal `operations-stopped-and-side-effects-reconciled`. The coordinator independently identified these before this report and has committed to fixing them. Their correction remains part of the delta review.

Required correction: implement documented structured help or document a working discovery command; make reconciliation syntax executable while retaining the explicit obligation to observe actual termination and side effects before acknowledging.

## Other assessed boundaries and verification limits

Root launcher derives its checkout from `import.meta.url`, forces that cwd, uses an explicit local loader and `shell:false`. Gate wrapper retains the app's prebuild copy step and both backlog scripts; executable/argument arrays and common workspace locks are registered. Runtime candidate exclusions omit generated state/dependencies, retain source/configuration and include app-script inputs. The isolated core mutation copy imports manual CLI/demo modules; dispatch imports are lazy, so its absence of the product backlog parser does not itself break manual mutation instruments. Disabled provider template and explicit manual-host limitations are clearly stated.

These are static review conclusions, not executed gate passes. Root coordinator owns mandatory test execution; the independent verifier must execute affected instruments on the corrected candidate, inspect actual state retention, and measure mutation detection/restored controls. No live provider, hosted integration, process isolation or reliable unattended repair claim was established.
