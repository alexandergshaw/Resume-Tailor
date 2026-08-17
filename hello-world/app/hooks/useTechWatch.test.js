// @vitest-environment jsdom
//
// The briefing's data hook. Written before app/hooks/useTechWatch.js exists.
//
// Everything here is wiring and effects - what gets requested, when it gets
// re-requested, and what survives a failure - which no pure function can
// express. useCopilotDashboard.wiring.test.js is the precedent for running a
// hook under jsdom in this repo.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useTechWatch } from "./useTechWatch.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let seen;

function body(overrides = {}) {
  return {
    generatedAt: "2026-08-17T15:29:00.000Z",
    windowHours: 24,
    items: [],
    lifecycle: [],
    watchlist: { entries: [], usedDefaults: false, truncated: false },
    sources: [],
    ...overrides,
  };
}

function ok(json, status = 200) {
  return { ok: true, status, json: async () => json };
}

// Renders the hook and records every state it reports.
function Probe({ options }) {
  const state = useTechWatch(options);
  seen.push(state);
  return null;
}

async function mount(options) {
  await act(async () => {
    root.render(createElement(Probe, { options }));
  });
}

const latest = () => seen[seen.length - 1];

beforeEach(() => {
  seen = [];
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useTechWatch", () => {
  it("loads the briefing on mount at the default window", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await mount({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/api/techwatch");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("windowHours=24");
    expect(latest().data).toMatchObject({ windowHours: 24 });
    expect(latest().loading).toBe(false);
    expect(latest().error).toBe("");
    expect(typeof latest().lastLoadedAt).toBe("string");
  });

  it("re-requests when the window changes, and remembers the choice", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await mount({ fetchImpl });
    await act(async () => latest().setWindowHours(168));
    expect(String(fetchImpl.mock.calls.at(-1)[0])).toContain("windowHours=168");
    expect(latest().windowHours).toBe(168);
    expect(window.localStorage.getItem("techwatch:windowHours")).toBe("168");
  });

  it("starts at the remembered window rather than re-asking", async () => {
    window.localStorage.setItem("techwatch:windowHours", "72");
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await mount({ fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("windowHours=72");
  });

  it("ignores a remembered window that is not one of the offered values", async () => {
    window.localStorage.setItem("techwatch:windowHours", "999");
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await mount({ fetchImpl });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("windowHours=24");
  });

  it("treats a 401 as signed out, not as an error to shout about", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) });
    await mount({ fetchImpl });
    expect(latest().signedOut).toBe(true);
    expect(latest().error).toBe("");
  });

  it("keeps the last good briefing when a later load fails", async () => {
    const good = body({ items: [{ id: "a" }] });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok(good))
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "upstream" }) });
    await mount({ fetchImpl });
    expect(latest().data.items).toHaveLength(1);
    await act(async () => latest().reload());
    // A briefing going blank because one poll failed is worse than a stale
    // one, as long as the panel says how stale it is.
    expect(latest().data.items).toHaveLength(1);
    expect(latest().error).toBeTruthy();
  });

  it("clears a previous error once a load succeeds again", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: "upstream" }) })
      .mockResolvedValueOnce(ok(body()));
    await mount({ fetchImpl });
    expect(latest().error).toBeTruthy();
    await act(async () => latest().reload());
    expect(latest().error).toBe("");
  });

  it("survives a network throw", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await mount({ fetchImpl });
    expect(latest().error).toBeTruthy();
    expect(latest().loading).toBe(false);
  });

  it("polls on its own interval", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await mount({ fetchImpl, intervalMs: 60_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reloads when the window regains focus", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await mount({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops polling and listening once unmounted", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(ok(body()));
    await mount({ fetchImpl, intervalMs: 60_000 });
    await act(async () => root.unmount());
    root = createRoot(container); // so afterEach's unmount stays valid
    const callsAtUnmount = fetchImpl.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(180_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetchImpl.mock.calls.length).toBe(callsAtUnmount);
  });
});
