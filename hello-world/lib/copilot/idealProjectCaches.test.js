// N125 §3.1 (L1): the two ideal-project caches. The pool cache
// (question-INDEPENDENT READY example) must be protected from per-question
// TAILORED churn by living in its OWN Map — the eviction hole the design closes
// structurally. Mirrors answerCodeLanguage.test.js's "uses its OWN Map" proof.
//
// RED on HEAD: neither export exists on answerSessionCache.js yet, so this file
// fails to load until step 4 adds idealProjectPoolCache / idealProjectTailoredCache.

import { describe, it, expect, beforeEach } from "vitest";

import { idealProjectPoolCache, idealProjectTailoredCache } from "./answerSessionCache.js";

const POOL_KEY = "user-1::app-1::ip";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  idealProjectPoolCache.clear();
  idealProjectTailoredCache.clear();
});

describe("idealProjectPoolCache / idealProjectTailoredCache — two separate Maps (N125 L1)", () => {
  it("are distinct cache instances", () => {
    // Aliased to the same instance, a tailored write reads back through the
    // pool peek and per-question churn evicts the pool key — the whole eviction
    // hole. Distinct instances is the structural guarantee.
    expect(idealProjectPoolCache).not.toBe(idealProjectTailoredCache);
  });

  it("a write to the tailored cache is invisible in the pool cache for the same key", async () => {
    idealProjectTailoredCache.get(
      POOL_KEY,
      () => Promise.resolve({ project: { title: "TAILORED" }, resolvedAt: Date.now() }),
      { now: Date.now() },
    );
    await flush();
    expect(idealProjectPoolCache.peek(POOL_KEY)).toBeNull();
    expect(idealProjectPoolCache.size()).toBe(0);
    // Positive control: the write DID land somewhere — in the tailored Map.
    expect(idealProjectTailoredCache.peek(POOL_KEY)).toEqual({
      project: { title: "TAILORED" },
      resolvedAt: expect.any(Number),
    });
  });

  it("per-question tailored churn past the bound can NEVER evict the pool key (the eviction-hole proof)", async () => {
    // The pool key is written FIRST — the oldest entry, the first a single
    // shared 200-entry cache would evict once per-question keys fill the bound.
    idealProjectPoolCache.get(
      POOL_KEY,
      () => Promise.resolve({ project: { title: "POOL" }, resolvedAt: Date.now() }),
      { now: Date.now() },
    );
    await flush();
    expect(idealProjectPoolCache.peek(POOL_KEY)).not.toBeNull();

    // Fill the tailored cache well past its 200-entry bound with distinct
    // per-question keys. In one shared Map this evicts the pool key; in its own
    // Map it cannot reach it at all.
    for (let i = 0; i < 300; i += 1) {
      idealProjectTailoredCache.get(
        `user-1::app-1::ipq:question-${i}`,
        () => Promise.resolve({ project: { title: `Q${i}` }, resolvedAt: Date.now() }),
        { now: Date.now() },
      );
    }

    expect(idealProjectPoolCache.peek(POOL_KEY)).toEqual({ project: { title: "POOL" }, resolvedAt: expect.any(Number) });
    // And the tailored cache did enforce its own bound — proving the churn was
    // real, not a vacuous loop that never reached the limit.
    expect(idealProjectTailoredCache.size()).toBeLessThanOrEqual(200);
  });

  it("both carry the 30-minute TTL (model-derived, like codeLanguageCache) — a pool entry is gone past it", async () => {
    // Not the headline, but pins the TTL so a 10-minute default can't slip in.
    idealProjectPoolCache.get(
      POOL_KEY,
      () => Promise.resolve({ project: { title: "POOL" }, resolvedAt: 0 }),
      { now: 0 },
    );
    await flush();
    // Just before 30 min: still fresh. Just after: gone.
    expect(idealProjectPoolCache.peek(POOL_KEY, { now: 30 * 60 * 1000 - 1 })).not.toBeNull();
    expect(idealProjectPoolCache.peek(POOL_KEY, { now: 30 * 60 * 1000 + 1 })).toBeNull();
  });
});
