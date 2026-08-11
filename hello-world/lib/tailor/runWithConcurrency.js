// Concurrency-limited batch runner, extracted verbatim from the closure that
// used to live at app/page.js's `runWithConcurrency` (the only caller was
// `startBatchTailor`, with limit 3). Moved here so the multi-posting Job
// Description queue (app/hooks/useManualPostings.js) can share the exact
// same runner instead of growing a second copy.
//
// Three differences from the in-page version:
//   1. the progress side-effect (`setBatchTailorState(...)`) is not baked
//      in here -- it becomes the injected `onSettled(item)` callback, called
//      once per item, including items whose worker threw;
//   2. `limit` is defensively clamped: `Math.max(1, NaN)` is still `NaN`,
//      and `new Array(NaN)` throws, so a nonsensical limit (0, negative,
//      NaN, undefined, a numeric string) must be coerced to a number FIRST,
//      then clamped to a sane positive integer;
//   3. `onSettled` is optional.

function clampLimit(limit) {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.floor(n)) : 1;
}

export async function runWithConcurrency(items, limit, worker, onSettled) {
  const queue = items.slice();
  const runnerCount = Math.min(clampLimit(limit), queue.length);
  const runners = new Array(runnerCount).fill(null).map(async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      try {
        await worker(next);
      } catch {
        // The worker is responsible for surfacing its own errors (e.g. via
        // updateTailoringJob / a per-entry status); swallow here so one
        // item's failure never kills the rest of the batch.
      }
      onSettled?.(next);
    }
  });
  await Promise.all(runners);
}
