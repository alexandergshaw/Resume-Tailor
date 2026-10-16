# Read-only grant diagnosis and proposed bounded correction

No new generation calls were made during this diagnosis. Call 3 remains failed
and consumed; its ledger, frozen harness and fixtures were not rewritten.

Observed native call 3 transport: the model declared read-only policy before its
first tool, read input/nonce, returned correct proposed output content but status
failed, and never attempted an actual write syscall. Thus execution qualification
failed; this does not prove an operating-system write-denial event.

Safe user-config projection showed `[windows] sandbox = "elevated"`. The adapter
uses `--ignore-user-config`, which skips that file. Installed debug prompt-input
supports config overrides but not --ignore-user-config (global attempt rejects
the flag), so an exact exec reproduction through debug is unavailable.

An escalated no-generation differential diagnostic used a new empty ignored
CODEX_HOME, with no copied credentials/config/model cache, fixed synthetic CWD,
fixed `sandbox_mode="workspace-write"` and fixed requested gpt-6.1-sol:

| Diagnostic | Only varying setting | Exit | Rendered policy |
| --- | --- | --- | --- |
| empty-home baseline | windows.sandbox absent | 0 | read-only |
| empty-home control | windows.sandbox="elevated" | 0 | workspace-write |

Only sanitized field summaries were retained in ignored
`permission-empty-home-result.json` and
`permission-empty-home-elevated-result.json`; full prompts/private contexts were
not saved. A normal-user-config render with explicit elevated selection also
showed workspace-write for the synthetic CWD. A separate non-model
`codex sandbox --include-managed-config --permission-profile :workspace` invocation
with explicit elevated selection wrote/read `synthetic-write-proof` in dedicated
permission-probe/write-proof.txt, exit zero. No sandbox setup/install, login,
privilege bypass or mandatory-policy override was used.

These observations establish that this installed CLI's missing Windows backend
selection changes model-visible grant to read-only despite workspace-write, and
that the existing elevated backend can actually write in a managed synthetic
workspace. They strongly explain the failure when --ignore-user-config drops the
user's elevated selection. The empty-home debug is a controlled config mechanism
test, not exact authenticated exec reproduction or proof that a new live call
will succeed.

Official OpenAI documentation fetched on 2026-10-16 supports the intended
semantics: [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
documents workspace-write for edits and ignore-user-config skipping user config;
[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
documents the explicit elevated legacy backend; [permissions](https://learn.chatgpt.com/docs/permissions)
explains legacy sandbox precedence and managed restrictions. The diagnostic used
documented config selection and retained managed requirements.

## Proposed amendment, not admission

Keep the original stop in force pending fresh independent acceptance. Correct only
the experiment provider prefixArgs to `['-c','windows.sandbox="elevated"']`, keeping
the existing actual adapter, --ignore-user-config, least-privilege role sandbox,
model, reasoning effort, schemas, grants and all existing limits. No production
source edit is necessary. This changes the provider/target fingerprint; old
qualification cannot be silently reused for the new fingerprint.

Exactly five possible remaining calls fit the original eight consumed-attempt
limit: two fresh execution fixtures, the blind defective/clean critical pair, and
the real-supervisor cancellation experiment. Keep call 3 failed as environmental
configuration failure, never a pre-generation mechanical retry. Use a separate
amended harness/packet path with its own reviewed identity, referencing the same
authoritative ledger and original absolute deadline; do not reset it or overwrite
the original evidence. This is a proposed measured correction, not repeated
prompting to hide a semantic failure.

Analysis carryover requires independent acceptance of a precise evidence mapping:
calls 1/2 used read-only roles, and the sole correction changes Windows backend
selection, not their model/task/schema/oracles. A separate no-generation
read-only A/B permission control can support equivalence, but only the independent
checker may accept those old observations for the new fingerprint. Without that
mapping, eight calls cannot establish every required profile and cancellation;
leave analysis unqualified and automatic dispatch disabled. Do not invent a new
budget/deadline or lower a quality threshold to fit the remaining calls.

Before any resumed generation, independently check amended artifacts, frozen
fixtures/oracles, exact correction, ledger accounting and deadline. Then require
the original actual artifacts, mutation controls, independent role judgments,
session/token observations, cancellation and final evidence acceptance. A failure
or unknown operation again stops admission. This document itself grants no call.
