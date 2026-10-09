// @vitest-environment jsdom
//
// N153 — the two new methods on the expansion api (useAnswerExpansions):
// keyFor(line) and prefetch(line). RED on HEAD: the api exposes neither today
// (it has resolves/get/isOpen/toggle/retry/version only), so keyFor is not a
// function and the assertions below are red.
//
// The api is driven through the REAL ExpansionScope + the real store + the real
// client (only global fetch is stubbed), reached through context the way a leaf
// reaches it. The warm LEAF wiring (a bullet warming on mount) is a separate
// real-parent test (ExpansionPanel.warmOnMount.test.js); here the methods are
// exercised directly, so the contract is pinned without the render path.
//
// Properties pinned (design §2/§4c, ledger N153-L2/L4/L5/L6):
//   • keyFor(line) -> the resolved store key (a stable string) or null;
//   • prefetch(line) issues exactly one request through the store's begin* and
//     NEVER opens a panel (isOpen stays false);
//   • a click after a prefetch issues NO second request (store dedupe);
//   • a real click bypasses the shared concurrency queue — it is never stuck
//     behind warms, even while the queue is saturated.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import { ExpansionScope, useExpansionApi } from "./useAnswerExpansions.js";
import { resetExpansionStore } from "@/lib/copilot/expansionStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POINTS = [
  "I rebuilt the ledger after the settlement outage.",
  "I paged the on-call team during the incident.",
  "I ran the postmortem with the payments group.",
  "I wrote the replay script that closed the gap.",
];
const QUESTIONS = [{ id: 1, question: "Tell me about a failure.", points: POINTS, status: "done" }];
const REQUEST = { applicationId: "app-1", profile: "", interviewType: "behavioral", codeLanguage: "auto", engine: "embedded" };
const line = (i) => ({ label: "", cue: "", point: POINTS[i], pageSource: null, emphasis: null, sourceIndex: i });

let container;
let root;
let api;

function Probe() {
  api = useExpansionApi();
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  resetExpansionStore();
  api = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountScope() {
  await act(async () => {
    root.render(createElement(ExpansionScope, { questions: QUESTIONS, request: REQUEST }, createElement(Probe)));
  });
}

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const SUB = { subBullets: [{ text: "I reconciled every settlement by hand.", pageSource: null, source: null }], caption: "", empty: false };

// A fetch that resolves immediately with the given body.
function resolvingFetch(body = SUB) {
  const fetchMock = vi.fn(async () => okResponse(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A fetch that never resolves, so a prefetch stays in flight and holds a queue
// slot. Returns the mock and a release() that settles every call.
function gatedFetch(body = SUB) {
  const releasers = [];
  const fetchMock = vi.fn(
    () =>
      new Promise((resolve) => {
        releasers.push(() => resolve(okResponse(body)));
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, release: () => releasers.forEach((r) => r()) };
}

describe("keyFor and prefetch exist and resolve the item", () => {
  it("keyFor returns a stable string for a resolvable line and null for one it cannot resolve", async () => {
    await mountScope();
    expect(typeof api.keyFor).toBe("function");
    const k = api.keyFor(line(0));
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
    // Stable across calls (same resolved key).
    expect(api.keyFor(line(0))).toBe(k);
    // A line no answer in the scope holds resolves to null.
    expect(api.keyFor({ point: "Nothing in the scope says this.", sourceIndex: 0 })).toBeNull();
  });

  it("prefetch issues exactly one request and NEVER opens the panel", async () => {
    const fetchMock = resolvingFetch();
    await mountScope();
    await act(async () => api.prefetch(line(0)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The warm settled the record WITHOUT opening anything (design §P3/§9).
    expect(api.isOpen(line(0))).toBe(false);
    expect(api.get(line(0)).status).toBe("done");
  });

  it("does nothing for a line it cannot resolve", async () => {
    const fetchMock = resolvingFetch();
    await mountScope();
    await act(async () => api.prefetch({ point: "unresolvable", sourceIndex: 0 }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a click after a prefetch does not fetch again (store dedupe)", () => {
  it("toggle open after a settled prefetch issues no second request and shows the warmed content", async () => {
    const fetchMock = resolvingFetch();
    await mountScope();
    await act(async () => api.prefetch(line(0)));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => api.toggle(line(0)));
    expect(api.isOpen(line(0))).toBe(true);
    // The click opened the already-warmed record — no second network call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.get(line(0)).status).toBe("done");
  });

  it("a failed prefetch leaves the item retryable on click, and retry re-issues once", async () => {
    // Prefetch failures are silent and write an error record (§P5). The item is
    // still retryable exactly as a failed click would be.
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    await mountScope();
    await act(async () => api.prefetch(line(0)));
    expect(api.get(line(0)).status).toBe("error");
    expect(api.isOpen(line(0))).toBe(false); // the failure did not open anything

    // Retry re-issues (the one path allowed to re-ask a settled error).
    fetchMock.mockImplementation(async () => okResponse(SUB));
    await act(async () => api.retry(line(0)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(api.get(line(0)).status).toBe("done");
  });
});

describe("a real click bypasses the shared concurrency queue", () => {
  it("issues its request immediately even while the queue is saturated with warms", async () => {
    // PREFETCH_CONCURRENCY is 3. Three warms with a gated fetch saturate the
    // queue (three in flight, none settling). A click (toggle) calls begin*
    // DIRECTLY, never through the queue, so its request goes out at once — it is
    // never stuck behind the warms. A build that routed clicks through the queue
    // would leave the fourth request waiting and this reds (fetch stays at 3).
    const { fetchMock, release } = gatedFetch();
    await mountScope();
    await act(async () => {
      api.prefetch(line(0));
      api.prefetch(line(1));
      api.prefetch(line(2));
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // queue saturated

    await act(async () => api.toggle(line(3))); // a click on a FOURTH item
    expect(fetchMock).toHaveBeenCalledTimes(4); // went out immediately
    expect(api.isOpen(line(3))).toBe(true);

    await act(async () => release()); // cleanup: settle the gated warms
  });
});
