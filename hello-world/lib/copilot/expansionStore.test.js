// THE CLIENT-SIDE EXPANSION STORE and the one fetch that fills it.
//
// WHY THE STORE IS AT MODULE SCOPE AND NOT IN A HOOK OR A REF. TranscriptDisclosure
// returns a `<Stack>` when a session is not live and a fragment when it is: a
// DIFFERENT ELEMENT TYPE AT THE SAME POSITION, so starting or stopping a live
// session unmounts that subtree and destroys every QuestionFeed/QuestionCard
// hook state under it. A hook-owned map would therefore silently re-buy up to
// six paid model calls on a tab flick. Nothing in this feature may hold
// expansion content in a component or a component's ref.
//
// WHY CONTENT AND OPEN STATE LIVE IN DIFFERENT PLACES. Content is here, shared,
// keyed on text. "Which panels are open" is per surface and lives in the hook.
// That is what lets collapsing while a request is in flight be legal and NOT a
// cancel: the response completes and writes its record, and because writing a
// record does not set `open`, it cannot reopen a panel the reader closed.
//
// Type B red: the modules do not exist yet.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  EXPANSION_STORE_MAX,
  beginExpansion,
  getExpansion,
  getSnapshot,
  resetExpansionStore,
  subscribe,
} from "./expansionStore.js";
import { fetchExpansion } from "./expansionClient.js";

const STORE_SRC = readFileSync(fileURLToPath(new URL("./expansionStore.js", import.meta.url)), "utf8");
const CLIENT_SRC = readFileSync(fileURLToPath(new URL("./expansionClient.js", import.meta.url)), "utf8");
// Source assertions are about CODE, not prose. Both modules' comments name the
// very things the sweeps below forbid, in order to say why they are not there
// (the client's header names `draftAnswerStreaming` to draw the contrast), so
// a raw grep would fail on the documentation that prevents the defect.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const CLIENT_CODE = stripComments(CLIENT_SRC);
const STORE_CODE = stripComments(STORE_SRC);

const REQUEST = {
  question: "Tell me about a failure.",
  parentPoint: "I rebuilt the ledger.",
  points: ["Situation: I rebuilt the ledger."],
  pointIndex: 0,
  applicationId: "app-1",
  profile: "",
  interviewType: "behavioral",
  codeLanguage: "auto",
  engine: "embedded",
};

const DONE = { subBullets: [{ text: "I reconciled every settlement by hand.", pageSource: null, source: null }], caption: "c", empty: false };

beforeEach(() => {
  resetExpansionStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the store's read side", () => {
  it("reports idle for a key nothing has ever asked about", () => {
    expect(getExpansion("nothing")).toMatchObject({ status: "idle" });
  });

  it("returns the SAME snapshot reference when nothing has changed", async () => {
    // useSyncExternalStore requires getSnapshot to return the same reference
    // when nothing changed. A getSnapshot that allocates re-renders forever;
    // roleDrillStore.js records the same trap, and its fix is the same
    // memo-against-last-write shape.
    // MUTATION PROOF: make getSnapshot build a fresh object; red.
    const a = getSnapshot();
    const b = getSnapshot();
    expect(a).toBe(b);
    await beginExpansion({ key: "k1", request: REQUEST }, async () => DONE);
    expect(getSnapshot()).not.toBe(a);
    expect(getSnapshot()).toBe(getSnapshot());
  });

  it("notifies subscribers on a write and stops on unsubscribe", async () => {
    let calls = 0;
    const off = subscribe(() => {
      calls += 1;
    });
    await beginExpansion({ key: "k2", request: REQUEST }, async () => DONE);
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    off();
    await beginExpansion({ key: "k3", request: REQUEST }, async () => DONE);
    expect(calls).toBe(seen);
  });
});

describe("one expansion, one request", () => {
  it("writes loading SYNCHRONOUSLY, before any await", () => {
    // The reader gets feedback in the same frame as the click. Zero awaits
    // before the state write is the whole budget.
    const fetcher = vi.fn(() => new Promise(() => {}));
    beginExpansion({ key: "sync", request: REQUEST }, fetcher);
    expect(getExpansion("sync").status).toBe("loading");
  });

  it("dedupes: repeated calls while a key is loading issue ONE request", () => {
    // Dedupe, never cancel, never queue. A second click means "I still want
    // this"; queueing doubles the spend for a byte-identical result.
    const fetcher = vi.fn(() => new Promise(() => {}));
    beginExpansion({ key: "dedupe", request: REQUEST }, fetcher);
    beginExpansion({ key: "dedupe", request: REQUEST }, fetcher);
    beginExpansion({ key: "dedupe", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves a settled record without going back to the network", async () => {
    const fetcher = vi.fn(async () => DONE);
    await beginExpansion({ key: "cached", request: REQUEST }, fetcher);
    await beginExpansion({ key: "cached", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getExpansion("cached").subBullets).toHaveLength(1);
  });

  it("retry, and only retry, re-issues one request after a failure", async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error("nope"), { code: "http" });
    });
    await beginExpansion({ key: "err", request: REQUEST }, fetcher);
    expect(getExpansion("err").status).toBe("error");
    await beginExpansion({ key: "err", request: REQUEST }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await beginExpansion({ key: "err", request: REQUEST }, fetcher, { retry: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("records an honest empty as its own terminal state, not as an error", async () => {
    await beginExpansion({ key: "empty", request: REQUEST }, async () => ({ subBullets: [], caption: "", empty: true }));
    expect(getExpansion("empty").status).toBe("empty");
  });

  it("never leaves a key stuck on loading", async () => {
    // `loading` is not a terminal state. Whatever happens, the key settles.
    await beginExpansion({ key: "throws", request: REQUEST }, async () => {
      throw new Error("boom");
    });
    expect(getExpansion("throws").status).not.toBe("loading");
    await beginExpansion({ key: "junk", request: REQUEST }, async () => null);
    expect(getExpansion("junk").status).not.toBe("loading");
  });
});

describe("the store is bounded", () => {
  it(`evicts least-recently-touched past ${EXPANSION_STORE_MAX} records`, async () => {
    // Matching answerContextCache's own maxEntries, a number with a precedent
    // rather than a guess. Eviction is harmless: the next click re-fetches and
    // the panel renders collapsed rather than stale.
    // MUTATION PROOF: raise the cap to Infinity; red.
    for (let i = 0; i < EXPANSION_STORE_MAX; i += 1) {
      await beginExpansion({ key: `k${i}`, request: REQUEST }, async () => DONE);
    }
    // Touch the oldest so it is no longer least-recently-used.
    getExpansion("k0");
    await beginExpansion({ key: "one-more", request: REQUEST }, async () => DONE);
    expect(getExpansion("k0").status).toBe("done");
    expect(getExpansion("k1").status).toBe("idle");
  });
});

describe("what the store must never do", () => {
  it("persists nothing to the browser or to Supabase", () => {
    // The payload is derived from material the client is deliberately never
    // given, so persisting it would write submitted-document text to disk on a
    // shared machine under a key nothing expires. The app already carries nine
    // copilot localStorage keys; this is not a tenth.
    for (const src of [STORE_SRC, CLIENT_SRC]) {
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(src).not.toMatch(/@\/lib\/supabase\//);
    }
  });

  it("[control] the storage sweep can actually fail", () => {
    expect('localStorage.setItem("x", "1")').toMatch(/localStorage/);
  });

  it("holds no React and subscribes to nothing itself", () => {
    expect(STORE_CODE).not.toMatch(/from "react"/);
    expect(STORE_CODE).not.toMatch(/useSyncExternalStore/);
  });

  it("never scrolls anything", () => {
    for (const src of [STORE_SRC, CLIENT_SRC]) expect(src).not.toContain("scrollIntoView");
  });
});

describe("fetchExpansion", () => {
  it("POSTs to the expansion route with every field listed explicitly", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => DONE }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchExpansion({ ...REQUEST, secretExtra: "SHOULD NOT TRAVEL" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/copilot/answer/expand");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body);
    expect(sent.secretExtra).toBeUndefined();
    expect(Object.keys(sent).sort()).toEqual(
      ["applicationId", "codeLanguage", "engine", "interviewType", "pointIndex", "parentPoint", "points", "profile", "question"].sort(),
    );
  });

  it("has no stream flag: this endpoint does not stream", () => {
    // The contrast is answerClient.js, which exposes TWO separate functions
    // rather than one request with a caller-chosen flag.
    expect(CLIENT_CODE).not.toMatch(/stream/i);
  });

  it("bounds the round trip, and longer than the server's own budget", () => {
    // 6000 against the server's 4000, deliberately: when both fire, the
    // server's diagnosis wins the race and the reader is told what actually
    // happened rather than "network error".
    expect(CLIENT_SRC).toContain("6000");
    expect(CLIENT_SRC).toContain("AbortSignal.timeout");
  });

  it("throws a coded error rather than a raw provider string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "raw provider detail" }) })),
    );
    await expect(fetchExpansion(REQUEST)).rejects.toMatchObject({ code: "http" });
  });

  it("codes a timeout and a network failure differently from an HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }),
    );
    await expect(fetchExpansion(REQUEST)).rejects.toMatchObject({ code: "timeout" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(fetchExpansion(REQUEST)).rejects.toMatchObject({ code: "network" });
  });

  it("codes an unparseable body rather than throwing something shapeless", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      })),
    );
    await expect(fetchExpansion(REQUEST)).rejects.toMatchObject({ code: "parse" });
  });

  it("surfaces the disabled marker so the UI can say so without offering a Retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "off", code: "disabled" }) })),
    );
    await expect(fetchExpansion(REQUEST)).rejects.toMatchObject({ code: "disabled" });
  });
});
