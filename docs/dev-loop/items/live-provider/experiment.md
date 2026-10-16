# Experiment handoff

Prepared by independent provider-inventory worker. This is authored preparation,
not accepted measurement. No live calls have been made.

Owned writes: ignored `.agnostic-loop/live-provider/experiment.mjs` and its future
fixtures, specs, ledger and captures; this versioned record only. Existing source,
provider routing and product files remain outside this assignment's writes.

Harness SHA256 at handoff:
`CE57DB2A1C566043184A21DA4CCF43C1A98A912FC0CB950645746E9D3F076867`.
It imports the actual provider buildInvocation, normalizeResult and outcomeSchema;
its commands are separate prepare/status/run, with no automatic live execution.
Preparation creates six frozen synthetic specs and records exact source,
executable, configuration, schema and fixture identities. A durable ledger never
resets on rerun, requires serial calls, caps eight attempts, and binds a thirty
minute absolute deadline at first admission. One running/failed/unknown attempt
blocks later admissions. Time/output failures remain uncertain. No shell or
credential dump is used for provider execution.

Preparation command from repository root:

```powershell
node --experimental-strip-types --experimental-default-type=module --experimental-loader ./tools/resolve-ts-hook.ts .agnostic-loop/live-provider/experiment.mjs prepare
```

Observed default-sandbox outcome: Node v22.14.0 failed before evaluating JS with
`EPERM: operation not permitted, lstat 'C:\Users\alexa'`. No ledger or fixture
generation and no live generation occurred. Root coordinator must run this exact
preparation with authorized filesystem access, then admit a fresh checker for
actual fixture/oracle/harness bytes before invoking `run ID` with the same Node
flags. A command-line startup failure is not a conformance verdict.

The harness implements semantic calls 1–6 only. Critical-review explanation is
retained for independent semantic judgment; an automatic matching verdict alone
cannot qualify critical quality. Mutation controls and cancellation are pending
separate independently checked harness work. `promotion:false` and
`cancelStatus:pending-real-supervisor-store` are intentional; no qualification or
production dispatch is emitted.

Cancellation recipe found in `supervisor-fixtures.ts` and
`supervisor-lifecycle.test.ts`: create an isolated real LoopStore policy and
selection; configure an explicitly test-only one-job route; drive bootstrap and
scope activity without provider calls; retain the third drive/launch promise;
observe journal running/PID, use real controlDispatch cancel; wait actual return.
The supervisor reports unknown after forced kill and fences publication. Observe
actual descendants and fixture side effects, then independently judge before any
reconcile acknowledgement. A temporary qualification permitting this isolated
cancellation experiment must explicitly identify its experiment-only authority,
never claim final role/profile promotion, and bind measured calls 1–6. The root
coordinator requested this path; exact cancellation packet/store grant and code
still need independent acceptance before call 7.

