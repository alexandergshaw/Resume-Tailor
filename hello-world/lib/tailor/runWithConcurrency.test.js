// Contract for the shared concurrency-limited batch runner.
//
// This logic already shipped inside app/page.js as a closure over the batch
// tailor's progress state; the multi-posting Job Description tab needs the
// same runner, so it moves here as a plain function with the progress
// callback injected. These tests exist so the extraction is provably faithful
// AND so the properties both callers depend on -- every item runs, the cap is
// respected, one failure never kills the batch -- are pinned somewhere they
// can actually fail.

import { describe, it, expect, vi } from "vitest";
import { runWithConcurrency } from "./runWithConcurrency.js";

const byNumber = (a, b) => a - b;

// A worker whose promises the test resolves by hand, so "how many are in
// flight at once" is observable rather than a matter of timing luck.
function deferredWorker() {
  const started = [];
  const pending = new Map();
  const worker = (item) => {
    started.push(item);
    return new Promise((resolve, reject) => {
      pending.set(item, { resolve, reject });
    });
  };
  return {
    worker,
    started,
    inFlight: () => pending.size,
    settle: async (item) => {
      const handle = pending.get(item);
      pending.delete(item);
      handle.resolve();
      // Let the runner's `while` loop pick up the next item.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("runWithConcurrency", () => {
  it("runs every item exactly once", async () => {
    const seen = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort(byNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never runs more than `limit` items at the same time", async () => {
    const d = deferredWorker();
    const items = ["a", "b", "c", "d", "e"];
    const run = runWithConcurrency(items, 2, d.worker);

    await Promise.resolve();
    expect(d.inFlight()).toBe(2);
    expect(d.started).toEqual(["a", "b"]);

    await d.settle("a");
    expect(d.inFlight()).toBe(2);
    expect(d.started).toEqual(["a", "b", "c"]);

    await d.settle("b");
    await d.settle("c");
    await d.settle("d");
    await d.settle("e");
    await run;
    expect(d.started).toEqual(items);
  });

  it("keeps going after a worker throws, and still finishes the rest", async () => {
    const done = [];
    await runWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("worker exploded");
      done.push(n);
    });
    expect(done.sort(byNumber)).toEqual([1, 3]);
  });

  it("resolves rather than rejecting when a worker throws", async () => {
    await expect(
      runWithConcurrency([1], 1, async () => {
        throw new Error("worker exploded");
      }),
    ).resolves.toBeUndefined();
  });

  it("reports one settlement per item, naming the item, including the ones that threw", async () => {
    const onSettled = vi.fn();
    await runWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("worker exploded");
    }, onSettled);
    expect(onSettled).toHaveBeenCalledTimes(3);
    expect(onSettled.mock.calls.map(([item]) => item).sort(byNumber)).toEqual([1, 2, 3]);
  });

  it("does not require an onSettled callback", async () => {
    await expect(runWithConcurrency([1, 2], 2, async () => {})).resolves.toBeUndefined();
  });

  it("handles an empty list without calling the worker", async () => {
    const worker = vi.fn();
    await runWithConcurrency([], 3, worker);
    expect(worker).not.toHaveBeenCalled();
  });

  it("handles a limit larger than the number of items", async () => {
    const seen = [];
    await runWithConcurrency([1, 2], 10, async (n) => {
      seen.push(n);
    });
    expect(seen.sort(byNumber)).toEqual([1, 2]);
  });

  // A limit of 0 runs NOTHING (Promise.all([]) resolves instantly having done
  // no work), and NaN throws RangeError out of `new Array(NaN)` — so the
  // clamp cannot be `Math.max(1, limit)` alone, which leaves NaN as NaN.
  it.each([[0], [-3], [NaN], [undefined], ["3"]])(
    "clamps a limit of %s to something that still runs every item",
    async (limit) => {
      const seen = [];
      await runWithConcurrency([1, 2, 3], limit, async (n) => {
        seen.push(n);
      });
      expect(seen.sort(byNumber)).toEqual([1, 2, 3]);
    },
  );
});
