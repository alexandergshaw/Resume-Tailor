// N150 Wave B — the client-side DETAIL content store (techTermDetailStore.js)
// and the one fetch that fills it (techTermDetailClient.js), mirroring
// expansionStore.js / expansionClient.js. RED on HEAD: neither module exists.
//
// The store is MODULE SCOPE and never persisted (I-10): the detail is general
// knowledge, but the store also carries nothing that should outlive the tab, and
// a hook-owned map would re-buy paid model calls on a tab flick the same way the
// expansion store documents. Content is keyed on techTermDetailKey, never on a
// component or entry.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TECH_TERM_DETAIL_STORE_MAX,
  beginTechTermDetail,
  getTechTermDetail,
  getSnapshot,
  resetTechTermDetailStore,
  subscribe,
} from "./techTermDetailStore.js";
import { fetchTechTermDetail } from "./techTermDetailClient.js";

const STORE_SRC = readFileSync(fileURLToPath(new URL("./techTermDetailStore.js", import.meta.url)), "utf8");
const CLIENT_SRC = readFileSync(fileURLToPath(new URL("./techTermDetailClient.js", import.meta.url)), "utf8");

const REQUEST = { term: "idempotency keys", question: "Tell me about retries.", applicationId: "app-1", engine: "embedded" };
const DONE = { detail: "Idempotency keys make a retried request safe.", empty: false };

beforeEach(() => {
  resetTechTermDetailStore();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the detail store's read side", () => {
  it("reports idle for a key nothing has ever asked about", () => {
    expect(getTechTermDetail("nothing")).toMatchObject({ status: "idle" });
  });

  it("returns the SAME snapshot reference when nothing changed, a new one after a write", async () => {
    const a = getSnapshot();
    expect(getSnapshot()).toBe(a);
    await beginTechTermDetail({ key: "k1", request: REQUEST }, async () => DONE);
    expect(getSnapshot()).not.toBe(a);
  });

  it("notifies subscribers on a write and stops on unsubscribe", async () => {
    let calls = 0;
    const off = subscribe(() => (calls += 1));
    await beginTechTermDetail({ key: "k2", request: REQUEST }, async () => DONE);
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    off();
    await beginTechTermDetail({ key: "k3", request: REQUEST }, async () => DONE);
    expect(calls).toBe(seen);
  });
});

describe("one detail, one request", () => {
  it("writes loading SYNCHRONOUSLY, before any await", () => {
    beginTechTermDetail({ key: "sync", request: REQUEST }, () => new Promise(() => {}));
    expect(getTechTermDetail("sync").status).toBe("loading");
  });

  it("dedupes: repeated calls while a key is loading issue ONE request (never cancel)", () => {
    const fetcher = vi.fn(() => new Promise(() => {}));
    beginTechTermDetail({ key: "dedupe", request: REQUEST }, fetcher);
    beginTechTermDetail({ key: "dedupe", request: REQUEST }, fetcher);
    beginTechTermDetail({ key: "dedupe", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves a settled record without going back to the network", async () => {
    const fetcher = vi.fn(async () => DONE);
    await beginTechTermDetail({ key: "cached", request: REQUEST }, fetcher);
    await beginTechTermDetail({ key: "cached", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getTechTermDetail("cached").detail).toBe(DONE.detail);
  });

  it("retry, and only retry, re-issues one request after a failure", async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error("nope"), { code: "http" });
    });
    await beginTechTermDetail({ key: "err", request: REQUEST }, fetcher);
    expect(getTechTermDetail("err").status).toBe("error");
    await beginTechTermDetail({ key: "err", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await beginTechTermDetail({ key: "err", request: REQUEST }, fetcher, { retry: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("records an honest empty as its own terminal state, not as an error", async () => {
    await beginTechTermDetail({ key: "empty", request: REQUEST }, async () => ({ detail: "", empty: true }));
    expect(getTechTermDetail("empty").status).toBe("empty");
  });

  it("never leaves a key stuck on loading, even on a shapeless throw", async () => {
    await beginTechTermDetail({ key: "throws", request: REQUEST }, async () => {
      throw new Error("boom");
    });
    expect(getTechTermDetail("throws").status).not.toBe("loading");
    await beginTechTermDetail({ key: "junk", request: REQUEST }, async () => null);
    expect(getTechTermDetail("junk").status).not.toBe("loading");
  });
});

describe("the store is bounded and never persisted (I-10)", () => {
  it(`evicts least-recently-touched past ${TECH_TERM_DETAIL_STORE_MAX} records`, async () => {
    expect(TECH_TERM_DETAIL_STORE_MAX).toBe(200);
    for (let i = 0; i < TECH_TERM_DETAIL_STORE_MAX; i += 1) {
      await beginTechTermDetail({ key: `k${i}`, request: REQUEST }, async () => DONE);
    }
    getTechTermDetail("k0"); // touch the oldest so it is no longer LRU
    await beginTechTermDetail({ key: "one-more", request: REQUEST }, async () => DONE);
    expect(getTechTermDetail("k0").status).toBe("done");
    expect(getTechTermDetail("k1").status).toBe("idle");
  });

  it("persists nothing to the browser or to Supabase", () => {
    for (const src of [STORE_SRC, CLIENT_SRC]) {
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(src).not.toMatch(/@\/lib\/supabase\//);
    }
  });

  it("[control] the storage sweep can actually fail", () => {
    expect('localStorage.setItem("x", "1")').toMatch(/localStorage/);
  });
});

describe("fetchTechTermDetail", () => {
  it("POSTs to the detail route with every field listed explicitly and nothing extra", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => DONE }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchTechTermDetail({ ...REQUEST, secretExtra: "SHOULD NOT TRAVEL" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/copilot/answer/tech-term-detail");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body);
    expect(sent.secretExtra).toBeUndefined();
    expect(Object.keys(sent).sort()).toEqual(["applicationId", "engine", "question", "term"].sort());
  });

  it("bounds the round trip at 6000ms, longer than the server's own 4000ms budget", () => {
    expect(CLIENT_SRC).toContain("6000");
    expect(CLIENT_SRC).toContain("AbortSignal.timeout");
  });

  it("throws a coded error rather than a raw provider string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "raw provider detail" }) })));
    await expect(fetchTechTermDetail(REQUEST)).rejects.toMatchObject({ code: "http" });
  });

  it("codes a timeout and a network failure differently from an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }));
    await expect(fetchTechTermDetail(REQUEST)).rejects.toMatchObject({ code: "timeout" });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(fetchTechTermDetail(REQUEST)).rejects.toMatchObject({ code: "network" });
  });
});
