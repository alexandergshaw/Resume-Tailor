/**
 * The in-process counter store behind `lib/rateLimit`.
 *
 * WHAT THIS IS: a `Map` of bucket key -> { count, expiresAt }, with the same
 * shape as `lib/copilot/answerSessionCache.js`'s `createTtlCache` (injected
 * `now`, bounded entries, oldest-first eviction) because that is this repo's
 * established idiom for per-instance TTL state.
 *
 * WHAT THIS IS NOT: a bound on a distributed fleet. This process is one
 * serverless instance; Vercel runs as many as it likes and recycles them
 * freely. Two requests from the same user routed to two instances see two
 * independent counters, so the REAL ceiling this store enforces is
 * `limit x instanceCount`, not `limit`. `answerSessionCache.js` makes the
 * same admission about its own per-instance state -- the difference is that
 * a cache miss is merely wasteful, whereas a missed rate-limit decision is a
 * cost and abuse control that did not fire. That is why the store interface
 * below is exactly what Redis can do ATOMICALLY, so the shared-store swap is
 * a real option and not an aspiration (see the header of ./index.js).
 *
 * THE INTERFACE IS DELIBERATELY TINY -- two operations:
 *
 *   increment(key, ttlMs) -> Promise<number>   the count AFTER incrementing
 *   peek(key)             -> Promise<number>   the count now, 0 if absent
 *
 * `increment` returns the post-increment value rather than taking a
 * read-then-write pair, because that is the ONLY shape that survives
 * concurrency. A `get`/`set` interface cannot be implemented race-free
 * against Redis (two callers read the same value and both write it back),
 * and it cannot be implemented race-free here either the moment an `await`
 * lands between the read and the write. Redis's `INCR` returns the new value
 * for exactly this reason, and so does this. The test
 * "loses no increments when many requests land at once" is what pins it:
 * it fires 50 concurrent checks and fails against any read-then-write store.
 *
 * `size()` and `entries()` exist for tests and diagnostics only. Nothing in
 * the request path should read them.
 */

/**
 * @param {{ now?: () => number, maxKeys?: number }} [options]
 *   `now` is injected (never `Date.now` captured at module load) so tests
 *   drive the clock and nothing in the suite sleeps.
 *   `maxKeys` bounds memory: an address-keyed limiter is otherwise a
 *   remote-controlled `Map.set` loop, and a single host spraying forged
 *   addresses could grow this without limit. Pinned by the test
 *   "bounds its own memory so an address-keyed limiter cannot be made to leak".
 */
export function createMemoryStore({ now = Date.now, maxKeys = 10_000 } = {}) {
  /** @type {Map<string, { count: number, expiresAt: number }>} */
  const buckets = new Map();

  /** Read a live bucket, dropping it if its TTL has passed. */
  function live(key, t) {
    const bucket = buckets.get(key);
    if (!bucket) return null;
    if (bucket.expiresAt <= t) {
      buckets.delete(key);
      return null;
    }
    return bucket;
  }

  /** Drop every expired bucket. O(n), so only called when we are at capacity. */
  function sweep(t) {
    for (const [key, bucket] of buckets) {
      if (bucket.expiresAt <= t) buckets.delete(key);
    }
  }

  function makeRoom(t) {
    if (buckets.size < maxKeys) return;
    sweep(t);
    // Still full: everything is live, so evict whatever expires soonest --
    // it is the entry closest to being worthless anyway.
    while (buckets.size >= maxKeys) {
      let soonestKey = null;
      let soonestAt = Infinity;
      for (const [key, bucket] of buckets) {
        if (bucket.expiresAt < soonestAt) {
          soonestAt = bucket.expiresAt;
          soonestKey = key;
        }
      }
      if (soonestKey === null) break;
      buckets.delete(soonestKey);
    }
  }

  return {
    /**
     * Increment `key` and return the count AFTER the increment. Creates the
     * bucket with a `ttlMs` lifetime if absent; an existing bucket keeps its
     * original expiry, so a bucket's window cannot be extended by traffic
     * (which would let a busy caller hold a bucket open indefinitely).
     *
     * There is NO `await` between reading and writing -- that is what makes
     * this race-free on a single-threaded event loop, and it is load-bearing.
     *
     * @param {string} key
     * @param {number} ttlMs
     * @returns {Promise<number>}
     */
    async increment(key, ttlMs) {
      const t = now();
      const existing = live(key, t);
      if (existing) {
        existing.count += 1;
        return existing.count;
      }
      makeRoom(t);
      buckets.set(key, { count: 1, expiresAt: t + ttlMs });
      return 1;
    },

    /**
     * The current count for `key`, or 0 if it is absent or expired.
     * @param {string} key
     * @returns {Promise<number>}
     */
    async peek(key) {
      const bucket = live(key, now());
      return bucket ? bucket.count : 0;
    },

    /** Live bucket count. Diagnostics and tests only. */
    size() {
      sweep(now());
      return buckets.size;
    },

    /** `[key, count]` for every live bucket. Diagnostics and tests only. */
    entries() {
      const t = now();
      sweep(t);
      return [...buckets].map(([key, bucket]) => [key, bucket.count]);
    },
  };
}
