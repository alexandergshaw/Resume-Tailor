// N153 — the shared, module-scope prefetch throttle (lib/copilot/prefetchQueue.js).
//
// RED on HEAD: the module does not exist yet, so the import below throws at
// collection time and every case in this file is red. Intended red: the
// primitive the two expanders (and N154's third) share is not built.
//
// This is a pure, node-testable primitive on purpose (no React, like the two
// stores): a render never fires a burst of warms, and a real click is never
// stuck behind them. The design (docs/loop/N153.design.r1.md §4c) fixes the
// contract this pins:
//   • createPrefetchQueue({ concurrency }) bounds how many run() callbacks are
//     in flight at once; the default queue copilotPrefetchQueue uses
//     PREFETCH_CONCURRENCY (3).
//   • a key already waiting OR in flight is ignored (queue-layer dedupe); once
//     its run settles the key is released and a later re-enqueue is allowed.
//   • enqueue ignores an empty key or a non-function run.
//
// The headline teeth: with concurrency 3 and six enqueues, exactly three run
// and three wait — a build that dropped the `active < concurrency` guard (ran
// all six at once) reds the concurrency case, and a build that dropped the
// pendingKeys guard reds the dedupe case.

import { describe, it, expect } from "vitest";
import {
  PREFETCH_CONCURRENCY,
  createPrefetchQueue,
  copilotPrefetchQueue,
} from "./prefetchQueue.js";

// A controllable task: a run() that records it ran and returns a promise the
// test resolves when it chooses, so "in flight" is a state the test holds open.
function deferredTask(onRun) {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const run = () => {
    onRun?.();
    return promise;
  };
  return { run, resolve: () => resolve(), promise };
}

// Drain the queue's chained microtasks (enqueue -> pump -> run -> finally ->
// pump). A macrotask boundary flushes all pending microtasks; two rounds cover
// the finally-then-pump cascade a settle triggers.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the shared throttle bounds how many warms run at once", () => {
  it("defaults the shared queue's concurrency to PREFETCH_CONCURRENCY, which is 3", () => {
    // The number is tunable, not load-bearing, but the shared singleton must use
    // it, and clicks (§P4) take none of this path — so three is the whole brake.
    expect(PREFETCH_CONCURRENCY).toBe(3);
    expect(typeof copilotPrefetchQueue.enqueue).toBe("function");
  });

  it("runs only `concurrency` tasks at once and leaves the rest waiting", async () => {
    const q = createPrefetchQueue({ concurrency: 3 });
    const tasks = Array.from({ length: 6 }, (_, i) => deferredTask());
    tasks.forEach((t, i) => q.enqueue(`k${i}`, t.run));

    // Three in flight, three queued — NOT six in flight. A build without the
    // `active < concurrency` guard shows activeCount 6 / pendingCount 0 here.
    expect(q.activeCount()).toBe(3);
    expect(q.pendingCount()).toBe(3);

    // Settling one in-flight task frees exactly one slot: the fourth starts.
    tasks[0].resolve();
    await flush();
    expect(q.activeCount()).toBe(3);
    expect(q.pendingCount()).toBe(2);

    // Drain so this test leaves no in-flight key in the module-scope singleton
    // pattern (createPrefetchQueue here is local, but the habit is the contract).
    tasks.forEach((t) => t.resolve());
    await flush();
    expect(q.activeCount()).toBe(0);
    expect(q.pendingCount()).toBe(0);
  });

  it("[control] a saturated queue still accepts a NEW key — it is throttled, not closed", async () => {
    // Distinguishes a throttle (holds extra work) from a cap that would drop it:
    // a build that rejected enqueues past concurrency would show pendingCount 0
    // here instead of 1.
    const q = createPrefetchQueue({ concurrency: 1 });
    const a = deferredTask();
    const b = deferredTask();
    q.enqueue("a", a.run);
    q.enqueue("b", b.run);
    expect(q.activeCount()).toBe(1);
    expect(q.pendingCount()).toBe(1);
    a.resolve();
    b.resolve();
    await flush();
    expect(q.activeCount()).toBe(0);
    expect(q.pendingCount()).toBe(0);
  });
});

describe("two-layer dedupe: a key waiting or in flight is ignored", () => {
  it("runs a key's task once while it is in flight, however many times it is enqueued", async () => {
    const q = createPrefetchQueue({ concurrency: 3 });
    let calls = 0;
    const task = deferredTask(() => {
      calls += 1;
    });
    q.enqueue("dupe", task.run);
    q.enqueue("dupe", task.run); // in flight -> ignored
    q.enqueue("dupe", task.run); // in flight -> ignored
    await flush();
    // One network-shaped call, not three. A build without pendingKeys shows 3.
    expect(calls).toBe(1);
    expect(q.activeCount()).toBe(1);

    task.resolve();
    await flush();
    expect(q.activeCount()).toBe(0);
  });

  it("releases the key once its task settles, so a later re-enqueue is allowed", async () => {
    const q = createPrefetchQueue({ concurrency: 3 });
    let calls = 0;
    const first = deferredTask(() => {
      calls += 1;
    });
    q.enqueue("again", first.run);
    await flush();
    expect(calls).toBe(1);

    first.resolve();
    await flush();

    // Settled -> key released -> a fresh enqueue runs (the store's own begin()
    // guard is what makes the repeat cheap, per the design; the queue allows it).
    q.enqueue("again", () => {
      calls += 1;
      return Promise.resolve();
    });
    await flush();
    expect(calls).toBe(2);
  });

  it("a rejected task still releases its key and never escapes the queue", async () => {
    // Prefetch failures must be silent (§P5): a throwing run cannot reject out of
    // the queue, and its key must free so the item stays retryable.
    const q = createPrefetchQueue({ concurrency: 3 });
    let calls = 0;
    q.enqueue("boom", () => {
      calls += 1;
      return Promise.reject(new Error("prefetch failed"));
    });
    await flush();
    expect(calls).toBe(1);
    expect(q.activeCount()).toBe(0);
    expect(q.pendingCount()).toBe(0);

    // The key is free again.
    q.enqueue("boom", () => {
      calls += 1;
      return Promise.resolve();
    });
    await flush();
    expect(calls).toBe(2);
  });
});

describe("enqueue refuses work it cannot run", () => {
  it("ignores an empty key and a non-function run", async () => {
    const q = createPrefetchQueue({ concurrency: 3 });
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.resolve();
    };
    q.enqueue("", run);
    q.enqueue(null, run);
    q.enqueue(undefined, run);
    q.enqueue("ok", null);
    q.enqueue("ok", undefined);
    q.enqueue("ok", 42);
    await flush();
    expect(calls).toBe(0);
    expect(q.activeCount()).toBe(0);
    expect(q.pendingCount()).toBe(0);
  });
});
