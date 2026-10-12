// @vitest-environment jsdom
//
// N124 -- app/copilot/useRecentCompanies.js: the per-viewer store behind "remember
// the companies I recently practiced / interviewed for". localStorage, built on
// lib/copilot/choiceStore.js, shared by every PostingPicker.
//
// Written BEFORE the module exists. The cases that carry the weight:
//   * ACROSS SESSIONS is proven the only honest way -- seed localStorage, throw the
//     module graph away (vi.resetModules), import again, and read the list back.
//     EVERY case loads a fresh module graph, which is also what isolates the
//     module-level store between cases (the module exports no test-only reset).
//   * STORAGE FAILURE. localStorage can throw on read (blocked site data) and on
//     write (quota, private window). Neither may take the picker down, and a failed
//     write must not lose the choice for the rest of the tab (the in-memory list is
//     authoritative; storage is only the sink).
//   * INERT WHEN EMPTY. Nothing persisted means the frozen empty list and nothing
//     written -- a read must never create the key.
//
// Everything is observed through the hook a picker actually uses.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { RECENT_COMPANIES_STORAGE_KEY, RECENT_COMPANIES_CAP } from "@/lib/copilot/recentCompanies.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = RECENT_COMPANIES_STORAGE_KEY;
const mounted = [];

// A fresh module graph: the store hydrates from whatever localStorage holds right
// now, exactly as on a page load. The lib is imported AFTER the reset so the hook and
// the test see the same frozen-empty-list instance.
async function load() {
  vi.resetModules();
  const hook = await import("./useRecentCompanies.js");
  const lib = await import("@/lib/copilot/recentCompanies.js");
  return { hook, lib };
}

// Mounts the hook from `mod` and returns a live view of what it last returned.
function mountHook(mod) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const seen = { renders: 0, value: undefined };
  function Probe() {
    seen.renders += 1;
    seen.value = mod.useRecentCompanies();
    return null;
  }
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Probe));
  });
  return seen;
}

const companies = (seen) => seen.value.recentCompanies.map((e) => e.company);
const stored = () => window.localStorage.getItem(KEY);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  // Throwing spies on Storage.prototype must not outlive the case that made them.
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useRecentCompanies -- inert when nothing is persisted", () => {
  it("starts as the frozen empty list and does not create the storage key by being read", async () => {
    const { hook, lib } = await load();
    const seen = mountHook(hook);
    expect(seen.value.recentCompanies).toBe(lib.NO_RECENT_COMPANIES);
    expect(stored()).toBeNull();
  });

  it("renders once with no write: the snapshot is referentially stable, so useSyncExternalStore never loops", async () => {
    // An array snapshot that were rebuilt on every getSnapshot call would make React
    // re-render until it threw "Maximum update depth exceeded" -- mounting at all,
    // and rendering exactly once, is the proof.
    const { hook } = await load();
    const seen = mountHook(hook);
    expect(seen.renders).toBe(1);
  });
});

describe("useRecentCompanies -- recordCompany", () => {
  it("records a posting's company, newest first, and persists it under the key", async () => {
    const { hook } = await load();
    const seen = mountHook(hook);
    act(() => seen.value.recordCompany({ id: "1", company: "Acme" }));
    act(() => seen.value.recordCompany({ id: "2", company: "Globex" }));
    expect(companies(seen)).toEqual(["Globex", "Acme"]);
    const persisted = JSON.parse(stored());
    expect(persisted.map((e) => e.company)).toEqual(["Globex", "Acme"]);
    expect(persisted.every((e) => Number.isFinite(e.lastUsedAt) && e.lastUsedAt > 0)).toBe(true);
  });

  it("dedupes case-insensitively and moves the re-selected company to the front", async () => {
    const { hook } = await load();
    const seen = mountHook(hook);
    act(() => seen.value.recordCompany({ company: "Acme" }));
    act(() => seen.value.recordCompany({ company: "Globex" }));
    act(() => seen.value.recordCompany({ company: "acme " }));
    expect(companies(seen)).toEqual(["acme", "Globex"]);
  });

  it("never holds more than the cap", async () => {
    const { hook } = await load();
    const seen = mountHook(hook);
    for (let i = 0; i < RECENT_COMPANIES_CAP + 4; i += 1) {
      act(() => seen.value.recordCompany({ company: `Company ${i}` }));
    }
    expect(seen.value.recentCompanies).toHaveLength(RECENT_COMPANIES_CAP);
    expect(JSON.parse(stored())).toHaveLength(RECENT_COMPANIES_CAP);
  });

  it("writes nothing for a null posting, a title-only posting, or a whitespace company", async () => {
    const { hook, lib } = await load();
    const seen = mountHook(hook);
    act(() => seen.value.recordCompany(null));
    act(() => seen.value.recordCompany(undefined));
    act(() => seen.value.recordCompany({ id: "t", title: "Staff Engineer", company: "" }));
    act(() => seen.value.recordCompany({ id: "w", company: "   " }));
    act(() => seen.value.recordCompany({ id: "n" }));
    expect(seen.value.recentCompanies).toBe(lib.NO_RECENT_COMPANIES);
    expect(stored()).toBeNull();
  });

  it("a blank write cannot erase a good list", async () => {
    const { hook } = await load();
    const seen = mountHook(hook);
    act(() => seen.value.recordCompany({ company: "Acme" }));
    const before = stored();
    act(() => seen.value.recordCompany({ company: "" }));
    act(() => seen.value.recordCompany(null));
    expect(stored()).toBe(before);
    expect(companies(seen)).toEqual(["Acme"]);
  });

  it("hands out a stable recordCompany across renders", async () => {
    const { hook } = await load();
    const seen = mountHook(hook);
    const first = seen.value.recordCompany;
    act(() => seen.value.recordCompany({ company: "Acme" }));
    expect(seen.value.recordCompany).toBe(first);
  });
});

describe("useRecentCompanies -- the list survives a reload (across sessions)", () => {
  it("reads a persisted list back after the module graph is discarded", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { company: "Globex", lastUsedAt: 20 },
        { company: "Acme", lastUsedAt: 10 },
      ]),
    );
    const { hook } = await load();
    expect(companies(mountHook(hook))).toEqual(["Globex", "Acme"]);
  });

  it("a write in one load is visible to the next load", async () => {
    const first = await load();
    const seen = mountHook(first.hook);
    act(() => seen.value.recordCompany({ company: "Acme" }));
    const second = await load();
    expect(companies(mountHook(second.hook))).toEqual(["Acme"]);
  });

  it.each([
    ["not JSON", "{not json"],
    ["JSON of the wrong shape", JSON.stringify({ company: "Acme" })],
    ["an empty string", ""],
    ["a list of junk", JSON.stringify([null, 3, "x", { company: "" }])],
  ])("degrades %s to nothing remembered instead of throwing", async (_label, raw) => {
    window.localStorage.setItem(KEY, raw);
    const { hook } = await load();
    expect(mountHook(hook).value.recentCompanies).toHaveLength(0);
  });

  it("caps a hand-edited list that is longer than the cap", async () => {
    const many = Array.from({ length: RECENT_COMPANIES_CAP + 6 }, (_, i) => ({ company: `C${i}`, lastUsedAt: i }));
    window.localStorage.setItem(KEY, JSON.stringify(many));
    const { hook } = await load();
    expect(mountHook(hook).value.recentCompanies).toHaveLength(RECENT_COMPANIES_CAP);
  });
});

describe("useRecentCompanies -- storage that throws", () => {
  it("a write that throws does not throw out of recordCompany, and the choice still holds for this tab", async () => {
    const { hook } = await load();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const seen = mountHook(hook);
    expect(() => act(() => seen.value.recordCompany({ company: "Acme" }))).not.toThrow();
    expect(companies(seen)).toEqual(["Acme"]);
  });

  it("a read that throws at load leaves the module importable and the list empty", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { hook } = await load();
    expect(mountHook(hook).value.recentCompanies).toHaveLength(0);
  });

  it("a storage that throws on both read and write still records in memory", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { hook } = await load();
    const seen = mountHook(hook);
    expect(() => act(() => seen.value.recordCompany({ company: "Acme" }))).not.toThrow();
    expect(companies(seen)).toEqual(["Acme"]);
  });
});

describe("useRecentCompanies -- another tab", () => {
  it("adopts a list another tab wrote, and re-renders the picker with it", async () => {
    const { hook } = await load();
    const seen = mountHook(hook);
    expect(seen.value.recentCompanies).toHaveLength(0);
    const next = JSON.stringify([{ company: "Initech", lastUsedAt: 5 }]);
    window.localStorage.setItem(KEY, next);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: next, storageArea: window.localStorage }));
    });
    expect(companies(seen)).toEqual(["Initech"]);
  });

  it("ignores a storage event for a different key", async () => {
    const { hook } = await load();
    const seen = mountHook(hook);
    window.localStorage.setItem(KEY, JSON.stringify([{ company: "Initech", lastUsedAt: 5 }]));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "copilot-audio-source", newValue: "x", storageArea: window.localStorage }),
      );
    });
    expect(seen.value.recentCompanies).toHaveLength(0);
  });
});
