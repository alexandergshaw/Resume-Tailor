import { createMemoryStore } from "./memoryStore";

/**
 * The shared rate-limiting primitive. Before this module there was NO rate
 * limiting anywhere under `app/api/` -- every route authenticates, none of
 * them counts. Two model-calling features (ask-AI, sub-bullet expansion) are
 * queued behind this, and each would otherwise have invented its own bound.
 * This file is the contract they both import.
 *
 * This module is WIRED INTO NOTHING. Adoption is each feature's own change.
 *
 * ---------------------------------------------------------------------------
 * HOW TO ADOPT -- and the one way to get it catastrophically wrong.
 *
 * Build the limiter at MODULE scope, never inside the handler:
 *
 *     // top of app/api/<feature>/route.js
 *     const limiter = createRateLimiter({ limit: 20, windowMs: 60_000, prefix: "askai" });
 *
 *     export async function POST(request) {
 *       const { userId } = await getAuth();               // lib/experience/apiAuth.js
 *       const decision = await limiter.check(identify(request, { userId }));
 *       if (!decision.allowed) {
 *         return Response.json(
 *           { error: "Too many requests. Try again shortly." },
 *           { status: 429, headers: rateLimitHeaders(decision) },
 *         );
 *       }
 *       ...
 *     }
 *
 * A limiter constructed INSIDE the handler gets a brand-new store on every
 * request, so every caller is always on their first request and the limiter
 * silently permits everything. It will look like it works, it will pass a
 * smoke test, and it will count nothing. Module scope is load-bearing.
 *
 * Derive the key only AFTER `auth.getUser()` resolves, and never from the
 * caller's access token -- the same rule `lib/copilot/answerSessionCache.js`
 * documents for its own per-user keys.
 *
 * ---------------------------------------------------------------------------
 * 1. ALGORITHM: sliding window counter (two fixed buckets, weighted).
 *
 * A plain fixed window is one `INCR` and is the obvious choice, but it lets a
 * caller spend its whole allowance at the end of one window and its whole
 * allowance again at the start of the next -- 2x the intended rate, in as
 * little as two milliseconds, triggered by nothing more sophisticated than
 * bad luck with the clock. On an endpoint whose per-request cost is a model
 * call, that is a doubling of the worst-case bill and it is free to exploit.
 * The test "does NOT let a caller burst at 2x the limit across a window
 * boundary" is that defect written down; a fixed window fails it.
 *
 * A sliding window LOG (timestamps per caller) is exact but stores one entry
 * per request, which is unbounded per-caller memory driven by request volume.
 * A TOKEN BUCKET is the other classic answer, but refilling it is a
 * read-modify-write of (tokens, lastRefill), which cannot be done atomically
 * with a plain Redis `INCR` -- it needs a Lua script or a CAS retry loop, and
 * a limiter that is racy in the shared-store case is worse than a slightly
 * approximate one.
 *
 * The sliding window counter keeps the single-atomic-increment property (so
 * the Redis swap below stays honest), costs one extra read of the previous
 * bucket, holds exactly two counters per caller, and bounds the boundary
 * burst. It over-counts slightly when traffic is bursty inside the previous
 * window -- it assumes that window's requests were spread evenly -- which
 * errs toward denying. For a spend control, erring toward deny is correct.
 *
 * A DENIED REQUEST STILL INCREMENTS. This is deliberate and has a real
 * consequence: a caller that keeps hammering after a 429 pushes its own
 * recovery further out. That is an anti-abuse property, not a bug -- but it
 * also means the limit is "at most `limit` ATTEMPTS per window", not "at most
 * `limit` successes". The alternative (increment only on allow) requires
 * check-then-increment, which lets two concurrent requests both observe
 * `limit - 1` and both proceed. Race-free beats exact here.
 *
 * ---------------------------------------------------------------------------
 * 2. KEY: authenticated user id first; the proxy-attested address second;
 *    refuse to identify third. NEVER a raw caller-supplied header.
 *
 * `identify()` prefers `userId` -- the value the route already has from
 * `supabase.auth.getUser()` (see `lib/experience/apiAuth.js`'s `getAuth()`).
 * All seven copilot routes authenticate, so in practice this is the path that
 * matters and the address path is a backstop for any future anonymous route.
 *
 * The address path is where this gets dangerous. `x-forwarded-for` is a
 * caller-supplied header. A client can send `x-forwarded-for: 9.9.9.9` and a
 * Vercel-style proxy APPENDS the address it actually observed, producing
 * `9.9.9.9, <real>`. So the LEFTMOST entry -- the one the near-universal
 * `xff.split(",")[0]` reaches for -- is exactly the attacker-controlled one,
 * and using it hands every attacker an unlimited supply of fresh buckets by
 * incrementing a number. We therefore count in from the RIGHT:
 * `trustedProxyHops` (default 1) says how many proxies WE control appended to
 * the chain, and we take the entry just left of them. Pinned by "takes the
 * RIGHTMOST forwarded-for entry" and "gives an attacker no fresh bucket by
 * rotating the forged left-hand entries".
 *
 * If the trusted position does not exist -- a chain shorter than
 * `trustedProxyHops` -- we return null rather than falling back to a
 * shallower entry, because every shallower entry is forgeable. `x-real-ip` is
 * deliberately NOT consulted at all: it is a single unpositioned value, so
 * there is no way to tell a platform-set one from a client-set one, and
 * accepting it would reintroduce the whole problem through a side door.
 * `app/api/health/route.test.js` already pins this repo's posture that no
 * caller-controlled header unlocks anything.
 *
 * `trustedProxyHops` MUST be re-checked against the deployment. It is 1 here
 * because Vercel's edge is the single proxy in front of these routes. Adding
 * a CDN in front of Vercel makes the correct value 2, and leaving it at 1
 * silently starts trusting a forgeable entry.
 *
 * Keys are namespaced (`u:` / `ip:`) so a user id that happens to look like an
 * address cannot land in that address's bucket.
 *
 * ---------------------------------------------------------------------------
 * 3. STORE: in-process now, shared store droppable in later.
 *
 * `createMemoryStore()` is per-instance and evaporates when the instance
 * recycles. Stated honestly: on serverless this bounds a caller to
 * `limit x instanceCount`, NOT `limit`. It is worth having anyway -- it turns
 * an unbounded loop against an expensive endpoint into a bounded one, and it
 * is the difference between a runaway client costing thousands of model calls
 * and costing a few -- but it is not a fleet-wide guarantee and must not be
 * described as one.
 *
 * The store interface is two operations, `increment(key, ttlMs) -> newCount`
 * and `peek(key) -> count`, chosen because they map 1:1 onto `INCR` + `EXPIRE`
 * and `GET`. `lib/cache/redisClient.js` already ships an Upstash client (it
 * returns null when `KV_REST_API_URL`/`_TOKEN` are unset), so the shared
 * implementation is a small file that satisfies this same two-method shape --
 * no caller changes, no signature changes. That is the whole reason
 * `increment` returns the post-increment count instead of exposing get/set:
 * see ./memoryStore.js's header.
 *
 * ---------------------------------------------------------------------------
 * 4. RESPONSE: a plain object. An ordinary denial NEVER throws.
 *
 * A 429 is a routine outcome, not an exceptional one; making callers wrap
 * every check in try/catch would guarantee some route eventually forgets and
 * 500s instead of 429ing. `check()` returns a discriminated result the same
 * way `lib/oauth/state.js`'s `verifyOAuthState` does, carrying everything
 * needed to build the response: `limit`, `remaining`, `resetSeconds`,
 * `retryAfterSeconds`/`retryAfterMs`, `degraded`, and a `reason`.
 * `rateLimitHeaders()` turns that into the header bag.
 *
 * ---------------------------------------------------------------------------
 * 5. STORE FAILURE: degrade to the in-process store. Neither fully open nor
 *    fully closed.
 *
 * Fail-open on a store error is the industry default for rate limiting, and
 * for a pure abuse control it is right: a Redis blip should not take the API
 * down. But these endpoints spend money per call, and fail-open during an
 * outage means the spend ceiling disappears at exactly the moment nobody is
 * watching. Fail-closed has the opposite problem -- a Redis blip becomes a
 * total outage of the feature.
 *
 * So neither. When the configured store throws, we retry the same decision
 * against a process-local `createMemoryStore()` and set `degraded: true`. The
 * feature stays up AND stays bounded (per instance). The caller can surface
 * or alert on `degraded` without having to handle an exception. This is the
 * one place this module deliberately does NOT follow
 * `lib/drive/oauthState.js`'s "no silent degradation" ruling -- that rule
 * exists because the replay layer there had no non-store fallback and
 * degrading meant NOT CHECKING AT ALL. Here there is a real fallback, so the
 * control keeps operating rather than switching off, and it announces that it
 * has weakened. What we must never do is silently return `allowed: true`.
 *
 * Note the one wart: if `increment` succeeds against the primary store and
 * the subsequent `peek` throws, the decision is recomputed from scratch on
 * the fallback and the primary's increment is left behind. The primary is
 * already failing at that point, so the stray count is harmless.
 */

/** Namespace prefixes keep user-id keys and address keys from ever colliding. */
const USER_KEY_PREFIX = "u:";
const IP_KEY_PREFIX = "ip:";

/**
 * Longest plausible textual address (an IPv4-mapped IPv6 is 45 characters).
 * Anything longer is not an address, and must never become a store key --
 * that is how a header turns into unbounded key cardinality.
 */
const MAX_ADDRESS_LENGTH = 45;

/** Read one header from a `Headers`, or from a `Request`/`NextRequest`. */
function headerValue(source, name) {
  if (!source || (typeof source !== "object" && typeof source !== "function")) return null;
  let bag = null;
  if (typeof source.get === "function") bag = source;
  else if (source.headers && typeof source.headers.get === "function") bag = source.headers;
  if (!bag) return null;
  try {
    const value = bag.get(name);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reduce one forwarded-for entry to a usable address, or null.
 *
 * This is a SHAPE check, not a validity check: the goal is to stop arbitrary
 * attacker-chosen text from becoming a store key, not to verify the address
 * is routable. Strips an optional port (`1.2.3.4:5678`, `[2001:db8::1]:443`).
 */
function normalizeAddress(raw) {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) return null;

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) {
    value = bracketed[1];
  } else if ((value.match(/:/g) || []).length === 1) {
    // Exactly one colon means IPv4 + port; more than one means bare IPv6.
    value = value.slice(0, value.indexOf(":"));
  }

  if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH) return null;
  if (!/^[0-9a-fA-F.:]+$/.test(value)) return null;
  if (!value.includes(".") && !value.includes(":")) return null;
  return value.toLowerCase();
}

/**
 * The client address as attested by our own proxy, or null when there is no
 * trustworthy one.
 *
 * @param {Headers|Request|null|undefined} source
 * @param {{ trustedProxyHops?: number }} [options] number of proxies WE
 *   operate that append to `x-forwarded-for`. 1 for a plain Vercel deploy.
 * @returns {string|null}
 */
export function clientIpFromHeaders(source, { trustedProxyHops = 1 } = {}) {
  const raw = headerValue(source, "x-forwarded-for");
  if (!raw) return null;

  const hops = Number.isInteger(trustedProxyHops) && trustedProxyHops >= 1 ? trustedProxyHops : 1;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const index = parts.length - hops;
  // No fallback to a shallower entry: everything left of the trusted position
  // is caller-controlled, so "not enough hops" must mean "unidentified".
  if (index < 0 || index >= parts.length) return null;

  return normalizeAddress(parts[index]);
}

/**
 * Derive the bucket identity for a request. Never throws.
 *
 * @param {Headers|Request|null|undefined} source
 * @param {{ userId?: string|null, trustedProxyHops?: number }} [options]
 * @returns {{ ok: true, key: string, source: "user"|"ip" }
 *          | { ok: false, reason: "unidentified" }}
 */
export function identify(source, { userId = null, trustedProxyHops = 1 } = {}) {
  if (typeof userId === "string" && userId.trim().length > 0) {
    return { ok: true, key: `${USER_KEY_PREFIX}${userId.trim()}`, source: "user" };
  }

  const address = clientIpFromHeaders(source, { trustedProxyHops });
  if (address) {
    return { ok: true, key: `${IP_KEY_PREFIX}${address}`, source: "ip" };
  }

  return { ok: false, reason: "unidentified" };
}

/**
 * Accept either a bare key string or an `identify()` result. Anything else --
 * null, a number, `{}`, an array, a rejected identity -- yields null, which
 * `check()` turns into a denial.
 */
function resolveKey(identity) {
  if (typeof identity === "string") {
    const trimmed = identity.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (identity && typeof identity === "object" && !Array.isArray(identity)) {
    if (identity.ok === true && typeof identity.key === "string" && identity.key.trim().length > 0) {
      return identity.key.trim();
    }
  }
  return null;
}

/**
 * Build a limiter.
 *
 * @param {{
 *   limit: number,
 *   windowMs: number,
 *   store?: { increment: (key: string, ttlMs: number) => Promise<number>,
 *             peek: (key: string) => Promise<number> },
 *   now?: () => number,
 *   prefix?: string,
 * }} options
 * @returns {{ check: (identity: unknown) => Promise<RateLimitDecision> }}
 *
 * @typedef {{
 *   allowed: boolean,
 *   limit: number,
 *   remaining: number,
 *   resetSeconds: number,
 *   retryAfterSeconds: number,
 *   retryAfterMs: number,
 *   degraded: boolean,
 *   reason: "ok"|"over-limit"|"unidentified",
 * }} RateLimitDecision
 */
export function createRateLimiter({ limit, windowMs, store, now = Date.now, prefix = "rl" } = {}) {
  // Configuration errors are a boot-time problem, not a per-request one --
  // the same posture as lib/oauth/state.js's import-time invariant check.
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`createRateLimiter: limit must be a number >= 1, got ${limit}`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`createRateLimiter: windowMs must be a positive number, got ${windowMs}`);
  }

  // Buckets must outlive their own window, because the CURRENT window reads
  // the PREVIOUS one. 2x is the minimum that is always sufficient.
  const bucketTtlMs = windowMs * 2;

  const primaryStore = store ?? createMemoryStore({ now });
  let fallbackStore = null;
  let warnedAboutStore = false;

  function getFallbackStore() {
    if (!fallbackStore) fallbackStore = createMemoryStore({ now });
    return fallbackStore;
  }

  async function readCounts(target, currentKey, previousKey) {
    const current = await target.increment(currentKey, bucketTtlMs);
    const previous = await target.peek(previousKey);
    return { current, previous };
  }

  return {
    /**
     * @param {unknown} identity a key string, or an `identify()` result.
     * @returns {Promise<RateLimitDecision>}
     */
    async check(identity) {
      const t = now();
      const key = resolveKey(identity);

      if (key === null) {
        // Denied WITHOUT touching the store. There is deliberately no
        // "anonymous" bucket: a shared one either lets everybody through on
        // one allowance or lets one attacker exhaust it and lock everybody
        // out. Both are worse than refusing to serve a caller we cannot
        // attribute. Pinned by "never pools unidentifiable callers".
        const waitMs = Math.max(1, Math.ceil(windowMs));
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetSeconds: Math.ceil(windowMs / 1000),
          retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
          retryAfterMs: waitMs,
          degraded: false,
          reason: "unidentified",
        };
      }

      const windowIndex = Math.floor(t / windowMs);
      const windowStart = windowIndex * windowMs;
      const windowEnd = windowStart + windowMs;
      // Fraction of the PREVIOUS window still overlapping the trailing
      // `windowMs` that ends now: 1 at the window's start, 0 at its end.
      const weight = (windowEnd - t) / windowMs;

      const currentKey = `${prefix}:${key}:${windowIndex}`;
      const previousKey = `${prefix}:${key}:${windowIndex - 1}`;

      let degraded = false;
      let counts;
      try {
        counts = await readCounts(primaryStore, currentKey, previousKey);
      } catch (error) {
        degraded = true;
        if (!warnedAboutStore) {
          warnedAboutStore = true;
          console.warn(
            `Rate limit store unavailable (${error?.message ?? error}); falling back to per-instance counting. ` +
              "Limits are still enforced, but only within this instance.",
          );
        }
        counts = await readCounts(getFallbackStore(), currentKey, previousKey);
      }

      const { current, previous } = counts;
      const estimate = previous * weight + current;
      const allowed = estimate <= limit;
      const remaining = Math.max(0, Math.floor(limit - estimate));
      const resetSeconds = Math.max(0, Math.ceil((windowEnd - t) / 1000));

      let retryAfterMs = 0;
      if (!allowed) {
        retryAfterMs = earliestRetryMs({
          t,
          windowEnd,
          windowMs,
          limit,
          current,
          previous,
        });
      }

      return {
        allowed,
        limit,
        remaining,
        resetSeconds,
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
        retryAfterMs,
        degraded,
        reason: allowed ? "ok" : "over-limit",
      };
    },
  };
}

/**
 * How long until a retry would actually be allowed.
 *
 * The retry ITSELF increments, so we solve for the moment the estimate
 * including that increment drops to `limit`. Answering with a lazy "end of the
 * window" would be wrong in both directions -- too early at a boundary (where
 * the previous window still counts at full weight) and needlessly late in the
 * middle of one. Pinned by "computes Retry-After as the moment the caller
 * would actually be allowed again", which waits exactly this long and then
 * asserts the next call succeeds.
 */
function earliestRetryMs({ t, windowEnd, windowMs, limit, current, previous }) {
  // Case A: a point later in the CURRENT window, where `previous` still
  // applies but at a lighter weight.
  if (previous > 0) {
    const targetWeight = (limit - current - 1) / previous;
    if (targetWeight > 0) {
      const at = windowEnd - targetWeight * windowMs;
      return Math.max(1, Math.ceil(at - t));
    }
  }

  // Case B: not achievable in this window. In the NEXT window the current
  // count becomes the previous count, and the retry is the only request in
  // the new bucket.
  const nextWindowEnd = windowEnd + windowMs;
  if (current > 0) {
    const targetWeight = (limit - 1) / current;
    if (targetWeight > 0) {
      const at = nextWindowEnd - targetWeight * windowMs;
      return Math.max(1, Math.ceil(Math.max(windowEnd, at) - t));
    }
  }

  return Math.max(1, Math.ceil(windowEnd - t));
}

/**
 * Header bag for a decision. `RateLimit-*` follow the IETF draft
 * (`RateLimit-Reset` is delta-seconds, not a date); `Retry-After` is present
 * only on a denial, and is always a whole number of seconds >= 1 because
 * `Retry-After: 0` is meaningless to a client.
 *
 * @param {RateLimitDecision} decision
 * @returns {Record<string, string>}
 */
export function rateLimitHeaders(decision) {
  if (!decision || typeof decision !== "object") return {};
  const out = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(decision.resetSeconds),
  };
  if (!decision.allowed) {
    out["Retry-After"] = String(decision.retryAfterSeconds);
  }
  return out;
}
