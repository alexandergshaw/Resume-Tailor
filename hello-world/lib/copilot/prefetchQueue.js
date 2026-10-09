// THE SHARED THROTTLE FOR "WARM THE EXPANDER BEFORE IT IS CLICKED".
//
// The copilot's per-bullet "More detail" and per-buzzword explanation are asked
// for as soon as they come up on screen, so that opening one is instant. A
// rendered answer carries up to six bullets plus a handful of terms, so without a
// brake a single render would fire a dozen model requests in one tick. This queue
// is that brake, and the ONLY one: the server-side caps on both routes were
// removed on purpose (an owner ruling), so what keeps a render from bursting is
// that at most PREFETCH_CONCURRENCY warms are in flight at any moment.
//
// MODULE SCOPE, LIKE THE STORES. One singleton is shared by every expander on
// every surface, so bullets, buzzwords and any later expander draw from the same
// in-flight budget rather than each bringing its own. It also survives the
// copilot's transcript-region remount, which unmounts every card's React state.
//
// A CLICK NEVER COMES THROUGH HERE. toggle() and retry() call the store's begin*
// directly, so a real click is never stuck behind a queue of background warms:
// the queue throttles prefetch issuance only.
//
// TWO LAYERS OF DEDUPE, deliberately. `pendingKeys` stops a duplicate TASK piling
// up while a warm waits or runs; the store's own loading-record guard stops a
// duplicate NETWORK CALL once a task does run. A key leaves `pendingKeys` when its
// task settles, so a later re-enqueue is allowed and, finding a settled record in
// the store, costs nothing.
//
// NOTHING ESCAPES. A task that throws or rejects is swallowed here: a failed warm
// is silent by design (the store has already recorded the failure, and the item
// stays retryable on click), and a rejection leaking out of a background warm
// would surface as an unhandled rejection with no reader to show it to.
//
// No React in this file, so it is node-testable and reusable by any expander.

/** How many warms may be in flight at once. Tunable, not load-bearing: three
 * warms a six-bullet answer in about two waves while leaving a browser
 * connection free for a real click. */
export const PREFETCH_CONCURRENCY = 3;

export function createPrefetchQueue({ concurrency = PREFETCH_CONCURRENCY } = {}) {
  let active = 0;
  const waiting = []; // Array<{ key, run }>
  const pendingKeys = new Set(); // keys waiting OR in flight

  function pump() {
    while (active < concurrency && waiting.length > 0) {
      const { key, run } = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(run)
        .catch(() => {})
        .finally(() => {
          active -= 1;
          pendingKeys.delete(key);
          pump();
        });
    }
  }

  return {
    /** Run `run` under `key` when a slot is free. A key already waiting or in
     * flight, an empty key, or a non-function `run` is ignored. */
    enqueue(key, run) {
      if (!key || typeof run !== "function" || pendingKeys.has(key)) return;
      pendingKeys.add(key);
      waiting.push({ key, run });
      pump();
    },
    /** Warms currently in flight. Introspection for tests. */
    activeCount: () => active,
    /** Warms waiting for a slot. Introspection for tests. */
    pendingCount: () => waiting.length,
  };
}

export const copilotPrefetchQueue = createPrefetchQueue();
