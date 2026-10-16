# Codex Windows sandbox adapter compatibility plan

Status: authored plan requiring fresh independent acceptance before production
source edits. No generation, ledger reset, extra budget or provider enabling is
authorized by this plan. Two failed live write attempts remain consumed failures.

## Problem, scope and observable criteria

With --ignore-user-config the installed Windows CLI loses the user's elevated
sandbox backend selection. Supplying it as a global prefix does not reliably
survive command-local config overrides: actual no-generation A/B controls rendered
read-only when windows.sandbox was global and reasoning/sandbox config local,
and workspace-write when all were command-local. Both retained restricted network.
This makes an owned-file worker return failure despite requested workspace-write.
Persisted invocation arguments, native result and actual filesystem manifests make
the mismatch diagnosable. The practical benefit is reproducible owned-file worker
execution through the existing supervisor, beyond a direct chat returning text.

- W1: optional Codex setting windowsSandbox accepts only literal elevated; invalid
  strings, including empty string, fail closed. Absence leaves existing behavior.
- W2: selected backend is emitted as `-c windows.sandbox="elevated"` after exec,
  in the same command-local argument region as reasoningEffort, before final stdin
  marker. Coexistence cannot push it into prefix/global arguments.
- W3: checker/read roles retain read-only, implementers retain workspace-write;
  explicit allowed sandbox selection retains existing semantics. No bypass,
  approval weakening, network enabling or sandbox provisioning flag is introduced.
- W4: unsupported windowsSandbox settings on Claude/Gemini remain rejected by
  their existing allowlists. Generic command adapter extensibility is unchanged.
- W5: default invocations without the setting preserve their exact argument
  vector. Existing Codex reasoning values/validation, fresh/session/schema/output
  handling and all unrelated providers remain unchanged.

## Exact ownership and interface impact

Implementation owns only tools/agnostic-loop/providers.ts and
tools/agnostic-loop/providers.test.ts. Documentation owns only a narrow operator
note in docs/dev-loop/USAGE.md; repository.md needs no change unless the note must
be indexed there. This plan and subsequent item evidence stay in this directory.
No dispatch-example/template defaults, routing schema, provider probe, outcome
normalizer, runtime ledger, app source or product-backlog changes are planned.

Existing settings are Record<string,string>, validated as a string map by
routing-validation.ts for ProviderConfig and ModelTarget. No type/schema change
is needed. mergedSettings already applies target settings over provider settings;
windowsSandbox uses that same merge and validates the resulting value. Add it
only to the Codex allowlist and emit/validate inside the Codex branch. Check
presence using undefined rather than truthiness so empty strings fail.

Actual production caller is supervisor-process.ts launchTask, which passes the
configured provider/target to buildInvocation. providers.test.ts imports the same
API; providers.ts reexports probe/normalize/schema APIs unchanged. dispatch-example.ts
creates empty settings and remains byte-for-byte unaffected. Routing target
fingerprints already include provider/target settings, and worker requested
settings/packet metadata already copy merged settings; no caller modification is
needed. A changed windowsSandbox value changes fingerprint and must requalify.

## Independent test design and gates

Use existing providers.test.ts request helper and actual buildInvocation:

1. Pin a complete expected default Codex argument vector (paths from request),
   proving optional omission preserves legacy behavior; keep existing providers'
   smoke assertions.
2. Set windowsSandbox elevated with reasoningEffort low and assert the exact
   config pair appears after the exec index, before final `-`, alongside local
   reasoning config; neither pair appears in prefix/global region.
3. Cover provider-level setting and target override using existing merge rules;
   invalid empty/unelevated/mxc/danger-full-access or arbitrary values reject.
4. For checker and implementer assert sandbox role grant remains read-only and
   workspace-write respectively when the backend is set. Existing unsupported
   sandbox values still reject. Explicit allowed sandbox selection remains valid.
5. Assert rejected setting for Claude/Gemini and unchanged generic-command
   behavior. Verify no dangerously-bypass, yolo, approval suppression, network
   enabling or setup flags occur in positive invocations.

Relevant mutation: move the new -c pair before exec, or omit it; the local-index
and exact-pair tests must fail. Another isolated mutation accepts an invalid
backend; negative tests must fail. Confirm actual changed bytes and restore them.
Serialize mutation with all gates; preserve app worker files and caches.

Run focused provider tests with the repository's existing root Vitest instrument,
then mandatory npm.cmd run loop:test. Record npm.cmd run loop:test:dispatch as
separate offline diagnostics; reuse previously accepted unaffected default-path
diagnostic evidence only with explicit source-delta/executed-path mapping. New
windowsSandbox branch needs fresh targeted evidence and live qualification.
Root owns shared gate resources and full mandatory/local delivery integration.
Independent verifier executes/verifies implementation; author is not verifier.

No-generation A/B argument-placement evidence remains an integration oracle:
permission-argument-placement.json SHA256
3273211A1C164A307E6C9D858E5FA9AF4E6E83B2CA8509739F7861DAE26846C4.
Inspect new actual buildInvocation arguments against that control. Unit tests
establish construction, not live execution. A safe no-generation render or
synthetic sandbox write may confirm current CLI grant without consuming a model
call, but cannot replace required measured role quality/cancellation.

## Documentation and specialist triage

Add an optional Windows operator note: set provider or target
settings.windowsSandbox to elevated only when that backend is already configured;
adapter emits command-local config because ignore-user-config omits user config.
It does not install/provision the sandbox, grant new path access or prove model
access. Other platforms omit the optional setting. Requalification is required
when bound settings/runtime bytes change. No config template is enabled by docs.

Security/reliability review is triggered by command argument authority and
fail-closed backend validation. Operations review covers already-provisioned
backend and evidence freshness. No new UI/data path/browser/accessibility change;
those specialist seats are omitted with that reason.

## Handoffs and live-budget boundary

Fresh checker accepts this plan, then implementer authors exactly scoped source,
tests and operator note. Fresh checker/verifier checks actual diff and runs
targeted/core gates, mutations and whole-change review. Final report receives
independent acceptance. Root then commits/pushes scoped verified main changes and
passes loop:delivery; a fixed adapter alone is not completed live qualification.

Before any further live calls, prepare a concrete separately checked qualification
amendment using settings.windowsSandbox elevated with no global-prefix workaround,
fresh fingerprints and affected source identity. Four attempts are already
consumed; five required measurements remain (two execution, critical defect/control,
real-supervisor cancellation), so total would be nine. Original maximum eight and
deadline remain binding. A later explicit owner budget decision is necessary;
do not dispatch, reset ledger or extend time now. Preserve both failed write
attempts and identify requested versus observed model/cost honestly.
