# Corrected experiment actual-byte handoff

Prepared offline only; actual code/fixtures/packet need fresh independent acceptance
before root launches any remaining call. No generation was performed by author.
Accepted plan/check references supplied by root: source 4795F775, check 3CDA962;
the coordinator retains their full identities. Prior analysis mapping is narrow,
explicitly accepted by root after independent read-only equivalence checking.

Owned writes are separate ignored corrected-experiment.mjs,
corrected-cancellation.mjs, their builder recipes, new corrected fixtures/specs,
corrected cancellation packet and append-only correction metadata in the shared
ledger. Original harness, specs, fixtures, failed call3 capture/status/usage,
original identity, consumed attempts and absolute deadline were preserved.

Actual SHA256 identities:

| Object below .agnostic-loop/live-provider | SHA256 |
| --- | --- |
| corrected-experiment.mjs | 3CC80776234E41327510449027952CA4844878B789C3678B481769F4D26E212A |
| corrected-cancellation.mjs | 0E85551AD24D1E2A4E62756E35888D960EB784791E72CB3E3FA034133CDDA867 |
| corrected-cancellation/packet.json | 4510BCB4D0FD7B759FCE7BF662C387E51C58A6394C18245C4C959E1CC18C841C |
| corrected-spec-4.json | E9101E02A32E78EF75C8916DF4347AF1B880715E19E5386353857ADEBD95C3DA |
| corrected-spec-5.json | 9C276719847C696CB9D8224E26E0F5C49A1DA36F54C6F1DE001EF8B2F33EE997 |
| corrected-spec-6.json | 96C7A35C58C4D1C5093F8E7E86D6B9524C7F4203D7F09F84624C54A6BC36D591 |
| corrected-spec-7.json | 3E80C1A3DED2AE0D01CE01824120D1D6B1FCFDCD02DCF16E6398CCB085709B6C |

The ledger also records canonical spec hashes; these differ from raw file hashes
because canonicalization excludes pretty-print whitespace. Its original deadline
remains 1792173529349; attempts remain 1 passed, 2 passed, 3 failed. New cases are
pending 4/5 execution, 6 seeded-defect review, 7 clean review; cancellation is 8.
No spare mechanical retry remains. Any new failure/unknown blocks subsequent calls.

Both corrected providers add only prefix arguments
`-c windows.sandbox="elevated"` before the existing adapter-generated exec command.
No application or provider-runtime source changed. Corrected semantic identity
records live in ledger.correction, retaining ledger.identity and admission-only
supersession of failed3. Separate output names preserve original native evidence.
Quality promotion remains false; independent semantic judgment remains pending.

Offline generation/preparation commands completed with authorized filesystem
access and no model calls:

```powershell
node .agnostic-loop/live-provider/build-correction.mjs
node --experimental-strip-types --experimental-default-type=module --experimental-loader ./tools/resolve-ts-hook.ts .agnostic-loop/live-provider/corrected-experiment.mjs prepare
node .agnostic-loop/live-provider/build-corrected-cancellation.mjs
node --experimental-strip-types --experimental-default-type=module --experimental-loader ./tools/resolve-ts-hook.ts .agnostic-loop/live-provider/corrected-cancellation.mjs prepare
```

Root-controlled live commands, only after actual-byte acceptance, use the same
Node flags with corrected-experiment.mjs run 4, then 5, 6, 7 serially, followed by
corrected-cancellation.mjs run. They share ledger/admission.lock and original
deadline. Full required profile/mutation/cancellation independent verification is
still outstanding; a successful harness assertion alone does not qualify.

Cancellation uses the actual isolated engine/supervisor. Before cancelling it
requires a running provider plus an owned live descendant with a delay marker
(Start-Sleep/time.sleep/setTimeout/timeout.exe/ping.exe) in its command line.
Only the already mapped descendant PID is queried; output stores a boolean and
PID/parent/name/creation time, never command-line contents. Final session comes
from actual supervisor capture; absence is unproven. The helper leaves unknown
and performs no reconcile or final promotion. Root owns inspecting full workspace,
actual process tree and any exact owned survivor cleanup, followed by independent
reconciliation acceptance. No blanket kill or missing-PID inference is authorized.
