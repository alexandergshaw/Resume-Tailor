import getRedisClient from "./redisClient";

const DEFAULT_TTL_SECONDS = 1800; // 30 minutes

/**
 * Retrieve a cached value by key. Returns null on miss or if Redis is unavailable.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
export async function getCached(key) {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

/**
 * Store a value in the cache with an optional TTL (seconds).
 * Silently no-ops if Redis is unavailable.
 * @param {string} key
 * @param {any} value
 * @param {number} [ttl]
 */
export async function setCached(key, value, ttl = DEFAULT_TTL_SECONDS) {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(key, value, { ex: ttl });
  } catch {
    // Cache write failure is non-fatal
  }
}
