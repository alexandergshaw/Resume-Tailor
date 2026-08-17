// The shared cache in front of the public feeds (Statuspage, OSV, KEV,
// endoflife.date). Those feeds are identical for every user, so this is what
// keeps a briefing that watches a dozen technologies from becoming a dozen
// outbound requests per page load, per user.
//
// The cache must degrade in every direction - no Redis configured, Redis
// erroring on read or write, Redis holding a value that will not parse - down
// to a plain in-memory Map, because a caching layer that can take the feature
// down is worse than no caching at all. Nothing in here throws on its own;
// only a producer's own rejection is allowed to propagate.

import getRedisClient from "@/lib/cache/redisClient";

// key -> { value, expiresAt } (epoch ms). Module-level so it survives across
// calls within one warm process, the same lifetime Vercel gives a lambda.
let memoryCache = new Map();

export function __resetMemoryCache() {
  memoryCache = new Map();
}

// getRedisClient() itself can throw (e.g. a malformed env var reaching the
// @upstash/redis constructor) - treat that exactly like "no client configured"
// rather than letting it take the whole request down.
function getRedisClientSafely() {
  try {
    return getRedisClient();
  } catch {
    return null;
  }
}

function readMemory(key) {
  const entry = memoryCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeMemory(key, value, ttlSeconds) {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cached(key, ttlSeconds, producer) {
  const memoryHit = readMemory(key);
  if (memoryHit !== undefined) return memoryHit;

  const redis = getRedisClientSafely();

  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw !== null && raw !== undefined) {
        try {
          // @upstash/redis ships with automatic deserialization ON: `get`
          // hands back an already-parsed object for a JSON value we stored,
          // not the JSON string itself. JSON.parse(anObject) stringifies it
          // to the literal text "[object Object]" and throws, so a
          // string-only implementation would treat every real Redis hit as a
          // miss - Redis silently becomes write-only, the memory Map quietly
          // does all the work, nothing ever errors, and nobody notices.
          const value = typeof raw === "string" ? JSON.parse(raw) : raw;
          writeMemory(key, value, ttlSeconds);
          return value;
        } catch {
          // Stored value will not parse - treat as a miss, not a fatal error.
        }
      }
    } catch {
      // Redis read failed - fall through to the producer below.
    }
  }

  // A producer's own throw is left to propagate uncaught: nothing here is
  // cached for a request that failed, so the very next call re-runs it.
  const value = await producer();

  // Only a truthy result is worth remembering; caching `null`/`""`/`0` would
  // make a source's own "nothing here" indistinguishable from a fetch we
  // never actually retried.
  if (value) {
    writeMemory(key, value, ttlSeconds);
    if (redis) {
      try {
        // Upstash's own write signature: set(key, value, { ex: seconds }).
        await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
      } catch {
        // Best-effort - the caller already has the value via the memory
        // cache and the function return; losing the Redis write only means
        // the *next* process has to pay for one more producer call.
      }
    }
  }

  return value;
}
