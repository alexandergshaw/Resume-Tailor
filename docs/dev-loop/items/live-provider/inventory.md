# Live provider inventory and proposed qualification

Author: fresh read-only provider-inventory worker, 2026-10-16. Source revision
observed by `git rev-parse HEAD`: `51b4f59bb6a1567c7c536936e324375bfa6a033f`.
This is a preparation artifact requiring independent acceptance, not live
qualification or authority to enable dispatch. No generation request was made.

## Observed inventory

- Installed executable:
  `C:/Users/alexa/AppData/Local/OpenAI/Codex/bin/9614f1d9b40d9c4f/codex.exe`.
  Direct `--version` returned `codex-cli 0.162.0-alpha.17.2`, exit zero.
- Direct `exec --help` exited zero and advertised `--model`, `--json`,
  `--ephemeral`, `--ignore-user-config`, `--output-schema`,
  `--output-last-message`, `--sandbox`, `-C`, and stdin prompt support. These
  match the existing Codex adapter's flag requirements. Help establishes syntax,
  not working authenticated model access or sandbox behavior.
- Unmodified `login status` failed before authentication observation:
  `Error loading configuration: Could not find home directory`. Environment-name
  inspection found USERPROFILE, HOMEDRIVE, HOMEPATH, APPDATA and LOCALAPPDATA;
  HOME and CODEX_HOME were absent. No credential values were inspected.
- A separate ProcessStartInfo child with USERPROFILE/HOME set to the known
  `C:/Users/alexa` profile and CODEX_HOME set to `C:/Users/alexa/.codex` ran
  `login status`, exited zero, and reported `Logged in using ChatGPT`.
  It also warned that stale arg0 temporary-directory cleanup and PATH-alias
  creation under `.codex/tmp/arg0` were denied. This proves an authentication
  status observation only. It does not prove model access or a generation.
- A scalar-only search for model, model_provider and model_reasoning_effort in
  `C:/Users/alexa/.codex/config.toml` returned no matches. Repository-local
  `.codex/config.toml` does not exist. Exact CLI target model remains unobserved.
- Projected nonsecret metadata from `C:/Users/alexa/.codex/models_cache.json`
  advertises visible `gpt-6.1-sol` at priority 1, default reasoning level low,
  context window 500000; `gpt-6-astra` follows at priority 2. This is cached
  advertised metadata, not a configured default or proof of live access.
- No login, install, provider enabling, routing changes, generation, deployment,
  backlog edits, or credential-file reads were performed by this worker.

## Existing contracts and limits

`provider-probes.ts` hashes the executable and absolute prefix arguments, checks
version/help, and recognizes the advertised flags. Its authentication field stays
unknown; Codex observedModel/nativeCostCap capabilities are always false. An
available probe is expressly not live conformance.

`providers.ts` constructs fresh `exec --json --ephemeral --ignore-user-config`
calls, supplies the exact target model, enforces read-only/workspace-write sandbox
names, and writes an outer strict `{outcomeJson:string}` schema. Read-only is the
default except for implementer tasks. `providerEnvironment` starts with NODE_ENV
and copies only configured environmentKeys; a routing configuration must preserve
the home and Windows runtime environment needed by the actual child. HOME values
must never be treated as credentials or printed from an untrusted response.

`provider-outcomes.ts` requires the final-response file, parses JSONL stdout,
checks WorkerOutcome shape, extracts thread ID and terminal token counts, and
rejects transport errors. Model/settings/cost can remain unavailable; requested
model is not an observed model. Current Codex probe cannot route a profile whose
requireObservedModel is true, regardless of potential future model event output.

`dispatch-configure.ts` qualification is operator attestation: any nonempty
evidence file plus explicit profiles/score/expiry creates a bound record and
returns liveModelAccess unverified. It does not run a quality evaluation.
`routing.ts` binds qualification to target, executable, adapter, evidence, expiry
and role threshold. Codex cannot use provider-enforced monetary cap mode. Unknown
prices cannot reserve finite monetary admission budgets; ChatGPT login does not
establish per-token monetary prices. Do not invent zero prices or observed costs.

`supervisor-process.ts` tracks handles, deadlines, output caps, operation records,
session reuse and publication tokens. On cancellation/time/output authority loss
it kills the direct child and leaves termination uncertain. This is cooperative
supervision, not proof of descendant confinement or reliable process-tree death.
The offline `conformance.test.ts` exercises public CLI fixture protocol; it is not
a live provider conformance suite.

## Proposed bounded conformance experiment

Keep routing disabled while independently checking this plan and fixing a trusted
bounded experiment grant. Use an isolated ignored `.agnostic-loop/` workspace and
store, synthetic input files, separate exact output paths, no product backlog
intake, no credentials in packets, and serial process/timeout ownership. Capture
source/config/executable hashes, exact argument arrays, environment names, output
hashes, process IDs, session observations and actual usage. Do not persist auth
status raw logs containing unexpected credential material.

Coordinator's proposed bound, received after initial inventory: at most eight live
calls and thirty minutes of aggregate invocation time, finite per-child timeouts,
using the existing ChatGPT login without paid API credentials, login or install.
Monetary usage remains unavailable and there is no hard monetary cap. No live call
is admitted by this preparation artifact; independent plan acceptance and an exact
model pin precede launch.

1. Reproduce version/help/auth status through the exact environment whitelist
   intended for dispatch. Stop on home/config/runtime errors. Compare executable
   identity to the qualified bytes; investigate temporary-directory permissions.
2. Run two fresh read-only structured tasks using the existing buildInvocation
   and normalizeResult APIs. Each reads a different synthetic nonce file and
   returns its content and exact packet bindings. Oracle: independently generated
   nonce bytes, valid strict outer schema, valid inner WorkerOutcome, no errors,
   distinct reported session IDs and unchanged workspace bytes. No-session
   observation leaves freshness unproven rather than manufacturing an identity.
3. Run a single implementer task transforming an owned synthetic file according
   to an independently specified deterministic oracle. Verify exact output and
   whole workspace diff. Then use a fresh checker context to judge a seeded
   defective version and a clean control, without disclosing which is defective.
   The checker must identify the real mechanism and accept the control; failures
   qualify neither execution nor critical judgment. Add analysis-role tasks only
   for the actual routed role requirements, with independent predeclared answers.
4. Exercise malformed schema/binding/session/candidate and out-of-scope-write
   rejection using isolated host-side tampered copies, not extra model requests.
   Positive controls must import; each designated mutation must be rejected.
5. Exercise one bounded cancellation only after a harmless successful round trip,
   retaining the handle and resources. Observe descendants and workspace writes
   before reconciliation. An unknown operation or late writer blocks enabling;
   a timeout is not successful cancellation proof. Do not use credentials or
   real external side effects as a test payload.
6. Independently review raw results, role-quality judgments and all limits. Assign
   profiles and score only from the approved rubric; record expiry and hashes.
   Qualify/configure only after the owner-authorized budget and every required
   observation hold. A clean offline fixture does not waive live failures.

## Decisions and remaining instruments

The coordinator must establish the exact model(s), role routing, settings,
context-capacity basis, profile thresholds/rubric, expiry, and accounting policy.
The installed executable and ChatGPT auth status are known; usable model access,
CLI-observed model identity, live role quality, token reporting and sandbox behavior
remain unproven. A finite job count/deadline and explicit unavailable-cost policy
are necessary if choosing subscription-backed Codex without a native monetary
cap. An arbitrary unbounded monetary mode must not be silently substituted for
an owner budget. Fix the maximum live requests and cancellation contingency before
launch; do not recursively dispatch to prove dispatch.

Required downstream handoff: independent plan acceptance; trusted grant and exact
target selection; supervised isolated live experiment; independent verification;
then evidence-bound qualification and configuration. Repository mandatory gates,
offline diagnostics, product-backlog scope and remote delivery are separate
obligations owned by the coordinator.
