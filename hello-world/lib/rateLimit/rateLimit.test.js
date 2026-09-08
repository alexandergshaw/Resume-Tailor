import { describe, it, expect } from "vitest";
import { createMemoryStore } from "./memoryStore";
import { createRateLimiter, identify, clientIpFromHeaders, rateLimitHeaders } from "./index";

/**
 * Tests for the shared rate-limiting primitive. Two model-calling features
 * (ask-AI, sub-bullet expansion) will import this module, so these tests are
 * the contract as much as they are a regression net.
 *
 * `now` is injected everywhere (lib/activityLog/appActivityLog.test.js's
 * idiom) so no assertion depends on the machine clock and nothing sleeps.
 *
 * Several tests exist specifically to fail against a plausible WRONG
 * implementation, and say so at the point of assertion:
 *   - "does NOT let a caller burst at 2x" fails against a fixed window.
 *   - "takes the RIGHTMOST forwarded-for entry" fails against the usual
 *     `xff.split(",")[0]`.
 *   - "loses no increments" fails against a read-then-write store.
 *   - "never pools unidentifiable callers" fails against a constant
 *     fallback key.
 */

/**
 * A controllable clock. Every test injects one -- nothing here sleeps, so the
 * whole file runs in milliseconds and cannot flake on a slow CI box.
 */
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    set(ms) {
      t = ms;
    },
  };
}

/** Minimal stand-in for the `Headers` object a Next.js Request carries. */
function headers(map) {
  return new Headers(map);
}

function setup({ limit = 3, windowMs = 1000, start = 0 } = {}) {
  const clock = makeClock(start);
  const store = createMemoryStore({ now: clock.now });
  const limiter = createRateLimiter({ limit, windowMs, store, now: clock.now, prefix: "test" });
  return { clock, store, limiter };
}

/** Total count held across every bucket -- used to prove no increment was lost. */
function totalCount(store) {
  return store.entries().reduce((sum, [, count]) => sum + count, 0);
}

describe("createRateLimiter -- allow/deny boundary", () => {
  it("allows requests below the limit and reports shrinking remaining", async () => {
    const { limiter } = setup({ limit: 3 });

    const first = await limiter.check("u:alice");
    expect(first.allowed).toBe(true);
    expect(first.limit).toBe(3);
    expect(first.remaining).toBe(2);

    const second = await limiter.check("u:alice");
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it("allows exactly `limit` requests -- the at-limit request is the last allowed one", async () => {
    const { limiter } = setup({ limit: 3 });

    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await limiter.check("u:alice"));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true]);
    // The at-limit request is allowed, and leaves nothing behind it.
    expect(results[2].remaining).toBe(0);
  });

  it("denies the request past the limit without throwing, and reports a usable Retry-After", async () => {
    const { limiter } = setup({ limit: 3, windowMs: 1000 });

    for (let i = 0; i < 3; i += 1) await limiter.check("u:alice");

    const denied = await limiter.check("u:alice");
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe("over-limit");
    expect(denied.remaining).toBe(0);
    // Retry-After must be a positive integer number of seconds -- a 0 or a
    // fractional value is not a legal HTTP header value here.
    expect(Number.isInteger(denied.retryAfterSeconds)).toBe(true);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("keeps denying while the caller keeps hammering inside the window", async () => {
    const { limiter } = setup({ limit: 2 });

    await limiter.check("u:alice");
    await limiter.check("u:alice");

    for (let i = 0; i < 5; i += 1) {
      const denied = await limiter.check("u:alice");
      expect(denied.allowed).toBe(false);
    }
  });
});

describe("createRateLimiter -- the window actually moves", () => {
  it("restores the full allowance once two windows have elapsed with no traffic", async () => {
    const { clock, limiter } = setup({ limit: 3, windowMs: 1000 });

    for (let i = 0; i < 3; i += 1) await limiter.check("u:alice");
    expect((await limiter.check("u:alice")).allowed).toBe(false);

    // A full two windows later the earlier traffic has aged out completely.
    clock.set(2000);

    const afterReset = await limiter.check("u:alice");
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(2);
  });

  it("recovers PARTIALLY mid-window -- proving the window slides rather than snapping", async () => {
    const { clock, limiter } = setup({ limit: 4, windowMs: 1000 });

    // Fill the allowance at the very start of window 0.
    for (let i = 0; i < 4; i += 1) await limiter.check("u:alice");

    // At the boundary the previous window still counts at full weight.
    clock.set(1000);
    expect((await limiter.check("u:alice")).allowed).toBe(false);

    // Half a window later the previous window counts at half weight, so some
    // -- but not all -- of the allowance is back. A fixed-window limiter
    // cannot produce this behaviour: it would have reset fully at t=1000.
    clock.set(1500);
    expect((await limiter.check("u:alice")).allowed).toBe(true);
  });

  it("does NOT let a caller burst at 2x the limit across a window boundary", async () => {
    // This is the whole reason the algorithm is not a fixed window. A fixed
    // window with limit=3 lets a caller spend 3 at t=999 and 3 more at
    // t=1000 -- 6 requests in 2ms. This must not happen.
    const { clock, limiter } = setup({ limit: 3, windowMs: 1000 });

    clock.set(999);
    for (let i = 0; i < 3; i += 1) {
      expect((await limiter.check("u:alice")).allowed).toBe(true);
    }

    clock.set(1000);
    const acrossBoundary = await limiter.check("u:alice");
    expect(acrossBoundary.allowed).toBe(false);
  });

  // Retry-After has to be pinned from BOTH sides. Asserting only that the
  // advice is long enough is satisfied by any over-estimate, including a lazy
  // "wait for the window to end" -- so the second test below probes one
  // millisecond early. Each runs its own scenario because a probe increments,
  // and a probe inside the shared scenario would change the answer.
  async function burstAcrossBoundary() {
    const { clock, limiter } = setup({ limit: 3, windowMs: 1000 });
    clock.set(999);
    for (let i = 0; i < 3; i += 1) await limiter.check("u:alice");
    clock.set(1000);
    const denied = await limiter.check("u:alice");
    expect(denied.allowed).toBe(false);
    return { clock, limiter, denied };
  }

  it("Retry-After is long enough -- waiting exactly that long succeeds", async () => {
    const { clock, limiter, denied } = await burstAcrossBoundary();

    clock.advance(denied.retryAfterMs);
    expect((await limiter.check("u:alice")).allowed).toBe(true);
  });

  it("Retry-After is not padded -- one millisecond earlier is still denied", async () => {
    const { clock, limiter, denied } = await burstAcrossBoundary();

    clock.advance(denied.retryAfterMs - 1);
    expect((await limiter.check("u:alice")).allowed).toBe(false);
  });
});

describe("createRateLimiter -- key isolation", () => {
  it("does not let one key's traffic consume another key's allowance", async () => {
    const { limiter } = setup({ limit: 3 });

    for (let i = 0; i < 5; i += 1) await limiter.check("u:alice");
    expect((await limiter.check("u:alice")).allowed).toBe(false);

    // Bob has spent nothing and must have his entire allowance.
    for (let i = 0; i < 3; i += 1) {
      const bob = await limiter.check("u:bob");
      expect(bob.allowed).toBe(true);
    }
    expect((await limiter.check("u:bob")).allowed).toBe(false);
  });

  it("keeps user-id buckets and IP buckets in separate namespaces", async () => {
    const { limiter } = setup({ limit: 2 });

    const viaUser = identify(headers({}), { userId: "1.2.3.4" });
    const viaIp = identify(headers({ "x-forwarded-for": "1.2.3.4" }), { userId: null });

    expect(viaUser.ok).toBe(true);
    expect(viaIp.ok).toBe(true);
    // A user whose id happens to look like an IP must not collide with that IP.
    expect(viaUser.key).not.toBe(viaIp.key);

    for (let i = 0; i < 2; i += 1) await limiter.check(viaUser);
    expect((await limiter.check(viaUser)).allowed).toBe(false);
    expect((await limiter.check(viaIp)).allowed).toBe(true);
  });
});

describe("createRateLimiter -- unidentifiable callers", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace", "   "],
    ["a number", 12345],
    ["a bare object", {}],
    ["an array", []],
    ["a rejected identity", { ok: false, reason: "unidentified" }],
  ])("denies a %s key instead of crashing", async (_label, badKey) => {
    const { limiter } = setup({ limit: 3 });

    const decision = await limiter.check(badKey);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("unidentified");
  });

  it("never pools unidentifiable callers into one shared bucket", async () => {
    const { limiter, store } = setup({ limit: 3 });

    // Hammer with unidentifiable callers far past the limit.
    for (let i = 0; i < 20; i += 1) {
      const decision = await limiter.check(null);
      expect(decision.allowed).toBe(false);
    }

    // No bucket was ever created: there is nothing to share, and nothing an
    // attacker could exhaust to lock legitimate callers out.
    expect(store.size()).toBe(0);

    // And a real caller still has their entire, untouched allowance.
    for (let i = 0; i < 3; i += 1) {
      expect((await limiter.check("u:alice")).allowed).toBe(true);
    }
  });
});

describe("createRateLimiter -- concurrency", () => {
  it("loses no increments when many requests land at once", async () => {
    const { limiter, store } = setup({ limit: 10 });

    const decisions = await Promise.all(
      Array.from({ length: 50 }, () => limiter.check("u:alice")),
    );

    const allowed = decisions.filter((d) => d.allowed).length;
    // Exactly the limit -- not 50 (lost counts), not 1 (a read-modify-write
    // race where every caller read the same stale count).
    expect(allowed).toBe(10);
    // Every one of the 50 attempts is accounted for in the store.
    expect(totalCount(store)).toBe(50);
  });

  it("keeps concurrent traffic for different keys independent", async () => {
    const { limiter } = setup({ limit: 5 });

    const decisions = await Promise.all([
      ...Array.from({ length: 20 }, () => limiter.check("u:alice")),
      ...Array.from({ length: 20 }, () => limiter.check("u:bob")),
    ]);

    const alice = decisions.slice(0, 20).filter((d) => d.allowed).length;
    const bob = decisions.slice(20).filter((d) => d.allowed).length;
    expect(alice).toBe(5);
    expect(bob).toBe(5);
  });
});

describe("identify -- key derivation", () => {
  it("prefers the authenticated user id over anything the caller can send", () => {
    const result = identify(headers({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" }), {
      userId: "user-abc",
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("user");
    expect(result.key).toContain("user-abc");
    // The caller-supplied address must not appear in the key at all.
    expect(result.key).not.toContain("9.9.9.9");
    expect(result.key).not.toContain("1.2.3.4");
  });

  it("takes the RIGHTMOST forwarded-for entry, so a forged prefix cannot pick the bucket", () => {
    // A client can send whatever it likes in x-forwarded-for; the proxy
    // APPENDS the address it actually saw. Only the right-hand end is
    // trustworthy.
    const forged = identify(headers({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" }), { userId: null });
    expect(forged.ok).toBe(true);
    expect(forged.key).toContain("1.2.3.4");
    expect(forged.key).not.toContain("9.9.9.9");
  });

  it("gives an attacker no fresh bucket by rotating the forged left-hand entries", async () => {
    const { limiter } = setup({ limit: 3 });

    // Same real client, 10 different forged prefixes.
    for (let i = 0; i < 10; i += 1) {
      const id = identify(headers({ "x-forwarded-for": `9.9.9.${i}, 1.2.3.4` }), { userId: null });
      await limiter.check(id);
    }

    // All ten landed in the one real bucket, so the limit still bites.
    const next = identify(headers({ "x-forwarded-for": "9.9.9.99, 1.2.3.4" }), { userId: null });
    expect((await limiter.check(next)).allowed).toBe(false);
  });

  it("refuses to identify when the trusted position does not exist", () => {
    // Only one entry, so with one trusted proxy hop the entry IS the one the
    // proxy appended -- fine. With two hops there is no trustworthy entry and
    // falling back to the forgeable one would be the bug.
    const oneHop = clientIpFromHeaders(headers({ "x-forwarded-for": "9.9.9.9" }), {
      trustedProxyHops: 1,
    });
    expect(oneHop).toBe("9.9.9.9");

    const twoHops = clientIpFromHeaders(headers({ "x-forwarded-for": "9.9.9.9" }), {
      trustedProxyHops: 2,
    });
    expect(twoHops).toBe(null);
  });

  it("honours a deeper trusted proxy chain", () => {
    const ip = clientIpFromHeaders(headers({ "x-forwarded-for": "9.9.9.9, 1.2.3.4, 10.0.0.1" }), {
      trustedProxyHops: 2,
    });
    expect(ip).toBe("1.2.3.4");
  });

  it.each([
    ["no headers at all", {}],
    ["an empty forwarded-for", { "x-forwarded-for": "" }],
    ["a comma-only forwarded-for", { "x-forwarded-for": " , , " }],
    ["a non-address value", { "x-forwarded-for": "not-an-ip" }],
    ["an injected key separator", { "x-forwarded-for": "1.2.3.4:evil, bad key" }],
  ])("returns unidentified for %s rather than inventing a key", (_label, hdrs) => {
    const result = identify(headers(hdrs), { userId: null });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unidentified");
  });

  // Every case above happens to be rejected by the "must contain a dot or a
  // colon" guard, which leaves the character-set guard untested. These all
  // DO contain a dot, so only the character-set check can reject them --
  // without it, arbitrary attacker-chosen text becomes a store key.
  it.each([
    ["an embedded space", "1.2.3.4 evil"],
    ["path traversal characters", "../../1.2.3.4"],
    ["percent-encoded control characters", "1.2.3.4%0d%0a"],
    ["a quoted injection attempt", '1.2.3.4","x'],
  ])("rejects %s even though it looks address-shaped", (_label, value) => {
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": value }))).toBe(null);
    expect(identify(headers({ "x-forwarded-for": value }), { userId: null }).ok).toBe(false);
  });

  it("does not crash on a missing or malformed headers object", () => {
    expect(identify(undefined, { userId: null }).ok).toBe(false);
    expect(identify(null, { userId: null }).ok).toBe(false);
    expect(identify({}, { userId: null }).ok).toBe(false);
    expect(identify(headers({}), undefined).ok).toBe(false);
  });

  it("rejects an absurdly long header value instead of making it a store key", () => {
    const huge = `${"1".repeat(5000)}, ${"2".repeat(5000)}`;
    const result = identify(headers({ "x-forwarded-for": huge }), { userId: null });
    expect(result.ok).toBe(false);
  });

  it("ignores a blank or non-string user id and falls through to the address", () => {
    const blank = identify(headers({ "x-forwarded-for": "1.2.3.4" }), { userId: "   " });
    expect(blank.ok).toBe(true);
    expect(blank.source).toBe("ip");

    const wrongType = identify(headers({ "x-forwarded-for": "1.2.3.4" }), { userId: 42 });
    expect(wrongType.ok).toBe(true);
    expect(wrongType.source).toBe("ip");
  });
});

describe("store failure policy", () => {
  it("degrades to the in-process store rather than failing open or shutting the door", async () => {
    const clock = makeClock();
    const brokenStore = {
      async increment() {
        throw new Error("redis unreachable");
      },
      async peek() {
        throw new Error("redis unreachable");
      },
    };
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 1000,
      store: brokenStore,
      now: clock.now,
      prefix: "test",
    });

    const first = await limiter.check("u:alice");
    expect(first.allowed).toBe(true);
    expect(first.degraded).toBe(true);

    // Crucially, the limit is still enforced -- a broken store must not mean
    // unlimited access to an endpoint that spends money per call.
    await limiter.check("u:alice");
    await limiter.check("u:alice");
    const denied = await limiter.check("u:alice");
    expect(denied.allowed).toBe(false);
    expect(denied.degraded).toBe(true);
  });

  it("marks a healthy store's decisions as not degraded", async () => {
    const { limiter } = setup();
    const decision = await limiter.check("u:alice");
    expect(decision.degraded).toBe(false);
  });
});

describe("rateLimitHeaders", () => {
  it("emits the RateLimit-* family on an allowed decision and no Retry-After", async () => {
    const { limiter } = setup({ limit: 3 });
    const decision = await limiter.check("u:alice");

    const out = rateLimitHeaders(decision);
    expect(out["RateLimit-Limit"]).toBe("3");
    expect(out["RateLimit-Remaining"]).toBe("2");
    expect(typeof out["RateLimit-Reset"]).toBe("string");
    expect(out["Retry-After"]).toBeUndefined();
  });

  it("adds Retry-After on a denial", async () => {
    const { limiter } = setup({ limit: 1 });
    await limiter.check("u:alice");
    const denied = await limiter.check("u:alice");

    const out = rateLimitHeaders(denied);
    expect(out["RateLimit-Remaining"]).toBe("0");
    expect(out["Retry-After"]).toBe(String(denied.retryAfterSeconds));
    // Every emitted value must be a string -- these go straight into Headers.
    for (const value of Object.values(out)) {
      expect(typeof value).toBe("string");
    }
  });

  it("is usable to build a real 429 Response", async () => {
    const { limiter } = setup({ limit: 1 });
    await limiter.check("u:alice");
    const denied = await limiter.check("u:alice");

    const response = new Response("Too many requests", {
      status: 429,
      headers: rateLimitHeaders(denied),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe(String(denied.retryAfterSeconds));
  });
});

describe("createMemoryStore", () => {
  it("counts up per key and expires a bucket once its TTL passes", async () => {
    const clock = makeClock();
    const store = createMemoryStore({ now: clock.now });

    expect(await store.increment("a", 1000)).toBe(1);
    expect(await store.increment("a", 1000)).toBe(2);
    expect(await store.peek("a")).toBe(2);

    clock.advance(1001);
    expect(await store.peek("a")).toBe(0);
    expect(await store.increment("a", 1000)).toBe(1);
  });

  it("reports 0 for a key it has never seen", async () => {
    const store = createMemoryStore({ now: makeClock().now });
    expect(await store.peek("never")).toBe(0);
  });

  it("bounds its own memory so an address-keyed limiter cannot be made to leak", async () => {
    const clock = makeClock();
    const store = createMemoryStore({ now: clock.now, maxKeys: 50 });

    for (let i = 0; i < 500; i += 1) {
      await store.increment(`ip:10.0.0.${i}`, 60_000);
    }

    expect(store.size()).toBeLessThanOrEqual(50);
  });
});
