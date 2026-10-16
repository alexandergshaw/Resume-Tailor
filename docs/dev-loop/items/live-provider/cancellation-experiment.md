# Real supervisor cancellation helper handoff

Ignored helper: `.agnostic-loop/live-provider/cancellation.mjs`, SHA256
`E51DE4177F6D353B05D2C6220025EE61D81E7FF8367D3B53447C1F95281B6F81`.
Primary semantic harness, specs and frozen source identity were not edited.
This artifact needs independent acceptance of the actual helper and prepared
packet before live invocation. No live call was made by the author.

Commands from root, using the same authorized Node runtime/loader access as the
semantic harness:

```powershell
node --experimental-strip-types --experimental-default-type=module --experimental-loader ./tools/resolve-ts-hook.ts .agnostic-loop/live-provider/cancellation.mjs prepare
node --experimental-strip-types --experimental-default-type=module --experimental-loader ./tools/resolve-ts-hook.ts .agnostic-loop/live-provider/cancellation.mjs run
```

Prepare creates only the ignored synthetic canary/workspace/artifacts directory,
selection and exact packet. It does not start a model or configure a store.
The checker must inspect the packet's actual policy, target, provider, budget,
grant, selection/hash and original ledger deadline. The helper records its own
hash inside the packet and refuses drift. Runtime source hashes for the actual
supervisor path need independent mapping alongside the frozen semantic identity;
the existing primary identity must not be rewritten.

Run requires six passed recorded semantic calls and exactly six prior attempts,
an unused cancellation state directory and 180 seconds remaining under the
original thirty-minute deadline. It reserves call 7 in the same durable ledger
before configuring or generating. Test-only qualification is explicitly a
single-job launch grant based on those observations, not final profile promotion.
The real LoopStore/configureDispatch/drive/controlDispatch APIs are used. Two
drive steps establish item/activity with no job; the next single step retains
the actual launch promise. A real running PID is required before cancellation.

CIM snapshots include only process ID, parent ID, name and creation time. The
helper records the running tree, cancels through the real supervisor, awaits its
return, inspects survivors with creation-time comparison and records canary
bytes, actual jobs/operations/assignments and transport session observation.
The private supervisor does not expose incremental JSONL, so session observation
is available only in the completed cancellation capture. Missing session or
delay/tool evidence remains unproven and prevents promotion. Independent review
must inspect capture bytes and all workspace files, not merely the helper's
canary boolean. No direct-child disappearance is treated as tree termination.

The helper always leaves cancellation unknown pending independent review and
performs no reconciliation acknowledgement, reservation release, profile
promotion or production dispatch. It does not kill arbitrary descendants.
If snapshots, running interval, process observations, side-effect audit or
publication fencing cannot be established, preserve state/locks and report the
precise unproven obligation. The independent checker must assess error-path
ownership and overall deadline before admitting this experiment.
