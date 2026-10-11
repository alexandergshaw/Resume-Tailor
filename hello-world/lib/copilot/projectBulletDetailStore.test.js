// N154 — the client-side per-bullet-detail content store
// (projectBulletDetailStore.js) and the one fetch that fills it
// (projectBulletDetailClient.js), mirroring techTermDetailStore /
// techTermDetailClient. RED on HEAD: neither module exists.
//
// The store is MODULE SCOPE and never persisted: the key carries the interview
// question (the user's own words), so writing it to browser storage would leave
// that on a shared machine. Content is keyed on projectBulletDetailKey, never on
// a component or entry. The client lists EVERY field explicitly (no spread) so a
// field growing on the caller cannot travel to a paid endpoint unnoticed.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PROJECT_BULLET_DETAIL_STORE_MAX,
  beginProjectBulletDetail,
  getProjectBulletDetail,
  getSnapshot,
  resetProjectBulletDetailStore,
  subscribe,
} from "./projectBulletDetailStore.js";
import { fetchProjectBulletDetail } from "./projectBulletDetailClient.js";

const STORE_SRC = readFileSync(fileURLToPath(new URL("./projectBulletDetailStore.js", import.meta.url)), "utf8");
const CLIENT_SRC = readFileSync(fileURLToPath(new URL("./projectBulletDetailClient.js", import.meta.url)), "utf8");

const REQUEST = {
  bullet: "Cut alert noise from 5 to 1 per shift",
  title: "Rebuilt the paging rotation",
  siblingBullets: ["Mean time to ack within the target"],
  bulletIndex: 0,
  question: "Tell me about an incident.",
  applicationId: "app-1",
  engine: "gemini",
};
const DONE = { detail: "A strong candidate might describe tuning alert thresholds.", empty: false };

beforeEach(() => {
  resetProjectBulletDetailStore();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the detail store's read side", () => {
  it("reports idle for a key nothing has ever asked about", () => {
    expect(getProjectBulletDetail("nothing")).toMatchObject({ status: "idle" });
  });

  it("returns the SAME snapshot reference when nothing changed, a new one after a write", async () => {
    const a = getSnapshot();
    expect(getSnapshot()).toBe(a);
    await beginProjectBulletDetail({ key: "k1", request: REQUEST }, async () => DONE);
    expect(getSnapshot()).not.toBe(a);
  });

  it("notifies subscribers on a write and stops on unsubscribe", async () => {
    let calls = 0;
    const off = subscribe(() => (calls += 1));
    await beginProjectBulletDetail({ key: "k2", request: REQUEST }, async () => DONE);
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    off();
    await beginProjectBulletDetail({ key: "k3", request: REQUEST }, async () => DONE);
    expect(calls).toBe(seen);
  });
});

describe("one detail, one request (dedupe, never cancel, retry-only-on-error)", () => {
  it("writes loading SYNCHRONOUSLY, before any await", () => {
    beginProjectBulletDetail({ key: "sync", request: REQUEST }, () => new Promise(() => {}));
    expect(getProjectBulletDetail("sync").status).toBe("loading");
  });

  it("dedupes: repeated calls while a key is loading issue ONE request (DELAYED PROMISE holds it)", () => {
    const fetcher = vi.fn(() => new Promise(() => {}));
    beginProjectBulletDetail({ key: "dedupe", request: REQUEST }, fetcher);
    beginProjectBulletDetail({ key: "dedupe", request: REQUEST }, fetcher);
    beginProjectBulletDetail({ key: "dedupe", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves a settled record without going back to the network", async () => {
    const fetcher = vi.fn(async () => DONE);
    await beginProjectBulletDetail({ key: "cached", request: REQUEST }, fetcher);
    await beginProjectBulletDetail({ key: "cached", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getProjectBulletDetail("cached").detail).toBe(DONE.detail);
  });

  it("retry, and only retry, re-issues one request after a failure", async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error("nope"), { code: "http" });
    });
    await beginProjectBulletDetail({ key: "err", request: REQUEST }, fetcher);
    expect(getProjectBulletDetail("err").status).toBe("error");
    await beginProjectBulletDetail({ key: "err", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await beginProjectBulletDetail({ key: "err", request: REQUEST }, fetcher, { retry: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("records an honest empty as its own terminal state, not as an error", async () => {
    await beginProjectBulletDetail({ key: "empty", request: REQUEST }, async () => ({ detail: "", empty: true }));
    expect(getProjectBulletDetail("empty").status).toBe("empty");
  });

  it("never leaves a key stuck on loading, even on a shapeless throw", async () => {
    await beginProjectBulletDetail({ key: "throws", request: REQUEST }, async () => {
      throw new Error("boom");
    });
    expect(getProjectBulletDetail("throws").status).not.toBe("loading");
    await beginProjectBulletDetail({ key: "junk", request: REQUEST }, async () => null);
    expect(getProjectBulletDetail("junk").status).not.toBe("loading");
  });
});

describe("the store is bounded and never persisted", () => {
  it(`evicts least-recently-touched past ${PROJECT_BULLET_DETAIL_STORE_MAX} records`, async () => {
    expect(PROJECT_BULLET_DETAIL_STORE_MAX).toBe(200);
    for (let i = 0; i < PROJECT_BULLET_DETAIL_STORE_MAX; i += 1) {
      await beginProjectBulletDetail({ key: `k${i}`, request: REQUEST }, async () => DONE);
    }
    getProjectBulletDetail("k0"); // touch the oldest so it is no longer LRU
    await beginProjectBulletDetail({ key: "one-more", request: REQUEST }, async () => DONE);
    expect(getProjectBulletDetail("k0").status).toBe("done");
    expect(getProjectBulletDetail("k1").status).toBe("idle");
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

describe("fetchProjectBulletDetail", () => {
  it("POSTs to the detail route with every field listed explicitly and nothing extra", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => DONE }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchProjectBulletDetail({ ...REQUEST, secretExtra: "SHOULD NOT TRAVEL" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/copilot/answer/project-bullet-detail");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body);
    expect(sent.secretExtra).toBeUndefined();
    expect(Object.keys(sent).sort()).toEqual(
      ["applicationId", "bullet", "bulletIndex", "engine", "question", "siblingBullets", "title", "userContext"].sort(),
    );
  });

  it("bounds the round trip at 6000ms, longer than the server's own 4000ms budget", () => {
    expect(CLIENT_SRC).toContain("6000");
    expect(CLIENT_SRC).toContain("AbortSignal.timeout");
  });

  it("maps the kill switch and the route's timeout code distinctly from a plain HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ code: "disabled" }) })));
    await expect(fetchProjectBulletDetail(REQUEST)).rejects.toMatchObject({ code: "disabled" });

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 504, json: async () => ({ code: "project_bullet_timeout" }) })));
    await expect(fetchProjectBulletDetail(REQUEST)).rejects.toMatchObject({ code: "timeout" });

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "raw provider detail" }) })));
    await expect(fetchProjectBulletDetail(REQUEST)).rejects.toMatchObject({ code: "http" });
  });

  it("codes a client-side timeout and a network failure differently (DELAYED/aborted promise)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }));
    await expect(fetchProjectBulletDetail(REQUEST)).rejects.toMatchObject({ code: "timeout" });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(fetchProjectBulletDetail(REQUEST)).rejects.toMatchObject({ code: "network" });
  });
});
