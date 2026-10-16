# Read-only pause control contention analysis

Reviewer `/root/recovery_check`, 2026-10-16. Static inspection plus current verbose log only; no tests, source edits, lock removal or recovery actions. The log records non-gate paused failure after 153,560 ms with the store-lock message. Final stack and suite verdict remain pending.

Concrete candidate class: **fixture barrier mistakes child readiness for completed admission-lock release**. The repair gate writes `pause-ready` as soon as the subprocess reaches its barrier. `runner.ts` spawns that child while holding `store.locked`, then still captures context, persists `operation.running` and saves state before releasing the lock. The fixture can observe the ready file during this interval and immediately call `controlDispatch`. `controlDispatch` uses the same lock; `LoopStore.locked` intentionally rejects an existing lock rather than waiting. This requires no stale lock or broken runtime authority to occur.

The existing `supervisor-pause.test.ts` handles this same expected contention by retrying `Store locked` at 20 ms intervals. Its retry is unbounded and should not be copied literally into this bounded fixture. Proposed fixture-only correction: retry only the exact known store-contention error until the original finite absolute pause deadline, with a short delay, propagating all other errors. Preserve the gate-ready signal and gate-release finally block, eight-second barrier, ten-second gate timeout, original authority/deadline values, and all no-provider-spawn, rejected/reconciled assignment, accepted-wave and budget-preservation assertions. Do not unlink locks or invoke lock recovery. Exhausting contention retries is a setup failure, never a passing pause assertion.

Collect final stack before implementation: `finally { await running; }` can surface a background error and mask an earlier exception, so the current one-line log does not conclusively identify the throwing call. After active-run reconciliation and independent plan/code review, run the affected real pause case and preserve actual behavioral outcome. If bounded retries still fail, diagnose that actual result rather than silently widening barriers or production authority.

Reviewed SHA-256 identities:

- `supervisor-repair-fixtures.ts`: `8085f11e9ea8d601130cc93b09f0bcff3439f0d5773c0df10267f453c7113169`.
- `supervisor-pause.test.ts`: `dd100d2a92197279569de15c4fd7c67fe2d3a1a27201f8439c489dd7eedb300c`.
- `runner.ts`: `874444813d4d438cf6cf2039187b956fe52ac2bfc42648a55662835bb403382b`.
- `store.ts`: `e265e7df7a2ec256cff150d3443b4864c7fed708faadc53f9f7349be11fb75f0`.
- `supervisor.ts`: `eb34a346bce77df5ed9c056023378e240741adff82f48cfa207d1f6f6a39702d`.

All filenames above are under `tools/agnostic-loop/`. No runtime failure inference is accepted from this static analysis alone.
