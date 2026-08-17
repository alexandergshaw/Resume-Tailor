// The shared cache in front of the public feeds. Written before
// lib/techwatch/cache.js exists.
//
// These feeds are identical for every user, so caching them is what keeps a
// briefing that watches a dozen technologies from becoming a dozen outbound
// requests per page load. The cache must degrade in every direction - no
// Redis configured, Redis erroring, Redis holding junk - because a caching
// layer that can take the feature down is worse than no caching at all.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/cache/redisClient", () => ({ default: vi.fn() }));

import getRedisClient from "@/lib/cache/redisClient";
import { cached, __resetMemoryCache } from "./cache.js";

beforeEach(() => {
  __resetMemoryCache();
  vi.mocked(getRedisClient).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cached", () => {
  it("calls the producer on a miss and returns its value", async () => {
    getRedisClient.mockReturnValue(null);
    const producer = vi.fn().mockResolvedValue({ hello: "world" });
    await expect(cached("k1", 600, producer)).resolves.toEqual({ hello: "world" });
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("serves the second call from memory when Redis is not configured", async () => {
    getRedisClient.mockReturnValue(null);
    const producer = vi.fn().mockResolvedValue({ n: 1 });
    await cached("k2", 600, producer);
    await expect(cached("k2", 600, producer)).resolves.toEqual({ n: 1 });
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("keys entries separately", async () => {
    getRedisClient.mockReturnValue(null);
    const a = vi.fn().mockResolvedValue("A");
    const b = vi.fn().mockResolvedValue("B");
    await expect(cached("k-a", 600, a)).resolves.toBe("A");
    await expect(cached("k-b", 600, b)).resolves.toBe("B");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("re-runs the producer once the memory entry has expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T15:00:00.000Z"));
    getRedisClient.mockReturnValue(null);
    const producer = vi.fn().mockResolvedValue("v");
    await cached("k3", 60, producer);
    vi.setSystemTime(new Date("2026-08-17T15:00:59.000Z"));
    await cached("k3", 60, producer);
    expect(producer).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-08-17T15:01:01.000Z"));
    await cached("k3", 60, producer);
    expect(producer).toHaveBeenCalledTimes(2);
  });

  it("reads through Redis when the client hands back a JSON string", async () => {
    const get = vi.fn().mockResolvedValue(JSON.stringify({ cachedValue: true }));
    const set = vi.fn().mockResolvedValue("OK");
    getRedisClient.mockReturnValue({ get, set });
    const producer = vi.fn();
    await expect(cached("k4", 600, producer)).resolves.toEqual({ cachedValue: true });
    expect(producer).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith("k4");
  });

  it("reads through Redis when the client hands back an already-parsed object", async () => {
    // This is what actually happens in production: @upstash/redis ships with
    // automaticDeserialization on, so `get` returns an object, not a string.
    // `JSON.parse(object)` parses "[object Object]" and throws, so a
    // string-only implementation treats EVERY Redis hit as a miss - Redis
    // becomes write-only, the memory Map does all the work, nothing ever
    // errors, and nobody notices.
    const get = vi.fn().mockResolvedValue({ cachedValue: true });
    const set = vi.fn().mockResolvedValue("OK");
    getRedisClient.mockReturnValue({ get, set });
    const producer = vi.fn();
    await expect(cached("k4b", 600, producer)).resolves.toEqual({ cachedValue: true });
    expect(producer).not.toHaveBeenCalled();
  });

  it("writes a freshly produced value back to Redis with the requested ttl", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const set = vi.fn().mockResolvedValue("OK");
    getRedisClient.mockReturnValue({ get, set });
    await cached("k5", 600, async () => ({ fresh: 1 }));
    expect(set).toHaveBeenCalledTimes(1);
    const [key, value, options] = set.mock.calls[0];
    expect(key).toBe("k5");
    expect(JSON.parse(typeof value === "string" ? value : JSON.stringify(value))).toEqual({ fresh: 1 });
    expect(options).toMatchObject({ ex: 600 });
  });

  it("falls through to the producer when Redis throws on read", async () => {
    const get = vi.fn().mockRejectedValue(new Error("upstash down"));
    const set = vi.fn().mockResolvedValue("OK");
    getRedisClient.mockReturnValue({ get, set });
    await expect(cached("k6", 600, async () => "produced")).resolves.toBe("produced");
  });

  it("falls through to the producer when Redis holds a value that will not parse", async () => {
    const get = vi.fn().mockResolvedValue("{not json");
    const set = vi.fn().mockResolvedValue("OK");
    getRedisClient.mockReturnValue({ get, set });
    await expect(cached("k7", 600, async () => "produced")).resolves.toBe("produced");
  });

  it("still returns the produced value when Redis throws on write", async () => {
    const get = vi.fn().mockResolvedValue(null);
    const set = vi.fn().mockRejectedValue(new Error("write refused"));
    getRedisClient.mockReturnValue({ get, set });
    await expect(cached("k8", 600, async () => "produced")).resolves.toBe("produced");
  });

  it("lets a producer's own error propagate and caches nothing", async () => {
    getRedisClient.mockReturnValue(null);
    const boom = vi.fn().mockRejectedValue(new Error("source down"));
    await expect(cached("k9", 600, boom)).rejects.toThrow("source down");
    const good = vi.fn().mockResolvedValue("recovered");
    await expect(cached("k9", 600, good)).resolves.toBe("recovered");
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("survives getRedisClient itself throwing", async () => {
    getRedisClient.mockImplementation(() => {
      throw new Error("missing env");
    });
    await expect(cached("k11", 600, async () => "produced")).resolves.toBe("produced");
  });

  it("does not cache a falsy result", async () => {
    getRedisClient.mockReturnValue(null);
    const producer = vi.fn().mockResolvedValue(null);
    await cached("k10", 600, producer);
    await cached("k10", 600, producer);
    expect(producer).toHaveBeenCalledTimes(2);
  });
});
