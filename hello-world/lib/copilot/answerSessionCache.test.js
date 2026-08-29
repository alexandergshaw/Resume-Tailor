import { afterEach, describe, expect, it, vi } from "vitest";
import { codeLanguageCache, companyFactsCache, createTtlCache, settleWithin } from "./answerSessionCache";

// AC-V5.2 / AC-V4.5. The per-session cache that stops /api/copilot/answer
// re-running the same four Supabase queries on every question of an
// interview.
//
// Measured from the session the user recorded on 2026-08-25: the route runs
// `supabase.auth.getUser()` and then a Promise.all of `fetchApplicationDocs`,
// `fetchPostingDescription`, `listPages` and `listAttachmentsByPage` BEFORE
// the model call starts — on every question, for data that does not change
// during a session. That is latency the candidate feels while sitting in
// front of an interviewer.
//
// This module is pure: no clock, no Supabase, no network. `now` arrives as an
// argument, exactly as lib/copilot/questionPin.js's resolvePin already
// requires of its callers, so the whole thing is testable with no timers.

const TTL = 10 * 60 * 1000;

function makeCache(overrides = {}) {
  return createTtlCache({ ttlMs: TTL, maxEntries: 4, ...overrides });
}

describe("createTtlCache — hit, miss, stale (AC-V5.2)", () => {
  it("runs the loader once for a repeated key and serves the stored value", async () => {
    const cache = makeCache();
    const load = vi.fn(async () => ({ resume: "R1" }));

    const first = await cache.get("u1::app1", load, { now: 0 });
    const second = await cache.get("u1::app1", load, { now: 1000 });

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ resume: "R1" });
    expect(second).toBe(first);
  });

  it("never lets one user's entry answer another user's request", async () => {
    // The key includes the user id and the key is only ever computed after
    // auth resolves. This is the assertion that has to be exhaustive rather
    // than illustrative: serving user A's résumé to user B is the worst thing
    // this module could do, and it would look exactly like a cache working.
    const cache = makeCache();
    const load = vi.fn(async (key) => ({ resume: key }));

    const a = await cache.get("u1::app1", () => load("u1::app1"), { now: 0 });
    const b = await cache.get("u2::app1", () => load("u2::app1"), { now: 0 });

    expect(load).toHaveBeenCalledTimes(2);
    expect(a).toEqual({ resume: "u1::app1" });
    expect(b).toEqual({ resume: "u2::app1" });
  });

  it("treats the same user's different applications as different entries", async () => {
    const cache = makeCache();
    const load = vi.fn(async () => ({}));

    await cache.get("u1::app1", load, { now: 0 });
    await cache.get("u1::app2", load, { now: 0 });

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("caches the no-application case too", async () => {
    // An empty applicationId is a real, common state (no posting selected) and
    // still worth caching: listPages and listAttachmentsByPage are scoped to
    // the user alone and run regardless.
    const cache = makeCache();
    const load = vi.fn(async () => ({}));

    await cache.get("u1::", load, { now: 0 });
    await cache.get("u1::", load, { now: 500 });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("deletes a stale entry and reloads, never serving the stale value once", async () => {
    // "Stale" and "miss" are deliberately the same event. Serving a stale
    // résumé while refreshing in the background is the pattern someone
    // reaches for by reflex, and it is exactly what V5.2's correctness clause
    // forbids: a résumé the user has since edited must not outlive its TTL,
    // not even for one request.
    const cache = makeCache();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ resume: "old" })
      .mockResolvedValueOnce({ resume: "new" });

    await cache.get("u1::app1", load, { now: 0 });
    const after = await cache.get("u1::app1", load, { now: TTL });

    expect(load).toHaveBeenCalledTimes(2);
    expect(after).toEqual({ resume: "new" });
  });

  it("keeps an entry that is one tick short of the TTL", async () => {
    // The boundary asserted from both sides, so an off-by-one in either
    // direction fails rather than merely shifting the expiry.
    const cache = makeCache();
    const load = vi.fn(async () => ({}));

    await cache.get("u1::app1", load, { now: 0 });
    await cache.get("u1::app1", load, { now: TTL - 1 });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("evicts oldest-first past maxEntries so a long-lived instance cannot grow without bound", async () => {
    const cache = createTtlCache({ ttlMs: TTL, maxEntries: 2 });
    const load = vi.fn(async () => ({}));

    await cache.get("k1", load, { now: 0 });
    await cache.get("k2", load, { now: 1 });
    await cache.get("k3", load, { now: 2 });
    // k1 is gone; k3 is present.
    await cache.get("k3", load, { now: 3 });
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get("k1", load, { now: 4 });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("does not cache a rejected load", async () => {
    // A failed fetch cached for ten minutes turns one bad round trip into ten
    // minutes of answers built from nothing, with no error the user can see.
    const cache = makeCache();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ resume: "R1" });

    await expect(cache.get("u1::app1", load, { now: 0 })).rejects.toThrow("network");
    const second = await cache.get("u1::app1", load, { now: 1 });

    expect(second).toEqual({ resume: "R1" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("collapses two concurrent requests for one key into a single load", async () => {
    // Two questions detected within a second of each other is not
    // hypothetical here — before AC-V1 landed, every spoken question produced
    // exactly that. A cache that stores the promise serves both from one
    // round trip; a cache that stores the resolved value runs the load twice.
    const cache = makeCache();
    let release;
    const load = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ resume: "R1" });
        }),
    );

    const a = cache.get("u1::app1", load, { now: 0 });
    const b = cache.get("u1::app1", load, { now: 0 });
    release();

    expect(await a).toEqual({ resume: "R1" });
    expect(await b).toEqual({ resume: "R1" });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("createTtlCache#peek (AC-V4.6)", () => {
  it("reports a fresh entry without running the loader", async () => {
    const cache = makeCache();
    await cache.get("u1::app1", async () => ({ resume: "R1" }), { now: 0 });
    expect(cache.peek("u1::app1", { now: 1000 })).toEqual({ resume: "R1" });
  });

  it("reports nothing for a missing or stale key, and starts nothing", () => {
    const cache = makeCache();
    expect(cache.peek("nope", { now: 0 })).toBeNull();
  });
});

describe("codeLanguageCache — its own instance, its own TTL (AC-C10, AC-C10b)", () => {
  afterEach(() => {
    codeLanguageCache.clear();
    companyFactsCache.clear();
  });

  it("is a distinct instance from companyFactsCache, in its own Map", async () => {
    // The two share the `${userId}::${applicationId}` key space by design
    // (AC-C10) — safe only because they are different Maps. A write to one
    // key in companyFactsCache must be invisible to codeLanguageCache for
    // that same key, or a language entry would read back through the facts
    // peek as an object it is not, and vice versa.
    const key = "u1::app1";
    expect(codeLanguageCache).not.toBe(companyFactsCache);

    await companyFactsCache.get(key, async () => ["a fact"], { now: 0 });

    expect(codeLanguageCache.peek(key, { now: 0 })).toBeNull();
    expect(codeLanguageCache.size()).toBe(0);
  });

  it("has a 30-minute TTL, matching companyFactsCache rather than answerContextCache's 10", async () => {
    const THIRTY_MIN = 30 * 60 * 1000;
    const load = vi.fn(async () => ({ language: "Go", resolvedAt: 0 }));

    await codeLanguageCache.get("u1::app1", load, { now: 0 });
    // One tick short of 30 minutes: still fresh, no reload.
    await codeLanguageCache.get("u1::app1", load, { now: THIRTY_MIN - 1 });
    expect(load).toHaveBeenCalledTimes(1);

    // At 30 minutes exactly: stale, same rule `isFresh` applies everywhere
    // else in this file — reloads.
    await codeLanguageCache.get("u1::app1", load, { now: THIRTY_MIN });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("settleWithin — a deadline that does not need a fake clock (AC-V4.6)", () => {
  it("returns the value when the promise settles inside the deadline", async () => {
    const timers = [];
    const timerImpl = (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    };
    const result = await settleWithin(Promise.resolve("facts"), 2000, {
      timerImpl,
      clearImpl: () => {},
    });
    expect(result).toBe("facts");
  });

  it("returns null when the deadline fires first, and does not reject", async () => {
    // The honest failure: a question about the employer waits for the facts,
    // but only so long. Past the deadline the answer is drafted WITHOUT them
    // rather than arriving late — a candidate mid-interview cannot use a
    // correct answer that shows up after they have already spoken.
    let fire;
    const result = await settleWithin(new Promise(() => {}), 2000, {
      timerImpl: (fn) => {
        fire = fn;
        queueMicrotask(() => fire());
        return 1;
      },
      clearImpl: () => {},
    });
    expect(result).toBeNull();
  });

  it("returns null rather than throwing when the promise rejects", async () => {
    // A failed lookup must degrade to "no facts", which the prompt already
    // has an honest instruction for. It must never become a 500 on an
    // otherwise perfectly answerable question.
    const result = await settleWithin(Promise.reject(new Error("search failed")), 2000, {
      timerImpl: () => 1,
      clearImpl: () => {},
    });
    expect(result).toBeNull();
  });

  it("clears its timer on the winning path so nothing is left pending", async () => {
    const clearImpl = vi.fn();
    await settleWithin(Promise.resolve("facts"), 2000, {
      timerImpl: () => 42,
      clearImpl,
    });
    expect(clearImpl).toHaveBeenCalledWith(42);
  });
});
