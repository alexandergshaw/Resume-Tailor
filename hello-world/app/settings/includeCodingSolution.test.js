// N162 Wave A AC-N162-1 / AC-N162-2 — the "include coding solution" toggle
// store.
//
// A localStorage-backed useSyncExternalStore, modelled byte-for-byte on
// app/settings/answerAsMe.js (and its answerAsMe.test.js, which itself mirrors
// engine.js/engine.test.js). This file mirrors that test so the three stores
// cannot drift. The ONE property that matters most for safety is the default:
// an empty, unreadable, or garbage store must resolve to OFF (false), never ON
// (FD-1) — a user must never silently start getting coding sections appended
// to their answers without having opted in.
//
// RED-ON-HEAD: `./includeCodingSolution` does not exist at HEAD (grep: 0 hits
// for `includeCodingSolution` anywhere under hello-world/app or hello-world/lib
// this round; the canary `answerAsMe` resolves to an existing module). The
// named imports below cannot resolve, so this whole file is a COLLECTION-ERROR
// red until the module is written. That is the honest red for "the store does
// not exist yet" — a failed import is INVALID coverage, not a passing
// assertion; once the module lands, every case below actually runs. (The
// store is a shipping module that later waves' consumers import, so its
// export-reachability reconciles when a consumer lands, not in Wave A.)

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeIncludeCodingSolution,
  readIncludeCodingSolution,
  subscribe,
  setIncludeCodingSolution,
  useIncludeCodingSolution,
  DEFAULT_INCLUDE_CODING_SOLUTION,
  INCLUDE_CODING_SOLUTION_STORAGE_KEY,
} from "./includeCodingSolution";

// The store persists to localStorage, which the node test env lacks — install
// a minimal fake on globalThis, exactly as answerAsMe.test.js does.
function installStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  return store;
}

let store;
beforeEach(() => {
  store = installStorage();
});
afterEach(() => {
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

describe("include-coding-solution metadata", () => {
  it("defaults OFF under a distinct, new storage key", () => {
    // The safe default is the whole point of FD-1's failure direction.
    expect(DEFAULT_INCLUDE_CODING_SOLUTION).toBe(false);
    // A NEW key, namespaced like the other copilot stores — never sharing the
    // engine's "tailorEngine" or the voice preference's "chatAnswerAsMe", which
    // would couple two unrelated settings onto one value.
    expect(INCLUDE_CODING_SOLUTION_STORAGE_KEY).toBe("copilot-include-coding-solution");
    expect(INCLUDE_CODING_SOLUTION_STORAGE_KEY).not.toBe("tailorEngine");
    expect(INCLUDE_CODING_SOLUTION_STORAGE_KEY).not.toBe("chatAnswerAsMe");
  });
});

describe("normalizeIncludeCodingSolution", () => {
  it("treats ONLY the exact string \"true\" as ON", () => {
    expect(normalizeIncludeCodingSolution("true")).toBe(true);
  });

  it("coerces every other value to OFF (the make-wrong-safe core, FD-1)", () => {
    // null/empty is the unreadable-store case; "1"/"yes"/"TRUE" are garbage;
    // boolean true is NOT the stored form (localStorage holds strings) and must
    // not be mistaken for it. A widened normalizer (`!!value`,
    // `value !== "false"`, `JSON.parse`) would read garbage as ON — every one
    // of these must resolve OFF.
    for (const v of [null, undefined, "", "1", "yes", "TRUE", "false", "0", 1, true, {}, []]) {
      expect(normalizeIncludeCodingSolution(v)).toBe(false);
    }
  });
});

describe("readIncludeCodingSolution", () => {
  it("returns the default (false) when nothing is stored", () => {
    expect(readIncludeCodingSolution()).toBe(false);
  });

  it("reflects a persisted ON value", () => {
    store[INCLUDE_CODING_SOLUTION_STORAGE_KEY] = "true";
    expect(readIncludeCodingSolution()).toBe(true);
  });

  it("reflects a persisted OFF value", () => {
    store[INCLUDE_CODING_SOLUTION_STORAGE_KEY] = "false";
    expect(readIncludeCodingSolution()).toBe(false);
  });

  it("resolves a GARBAGE stored value to OFF, never ON (FD-1)", () => {
    // The dangerous direction: a corrupt/legacy value must fail safe.
    store[INCLUDE_CODING_SOLUTION_STORAGE_KEY] = "1";
    expect(readIncludeCodingSolution()).toBe(false);
    store[INCLUDE_CODING_SOLUTION_STORAGE_KEY] = "on";
    expect(readIncludeCodingSolution()).toBe(false);
  });

  it("returns OFF during SSR (no localStorage), never throwing", () => {
    delete globalThis.localStorage;
    expect(readIncludeCodingSolution()).toBe(false);
  });

  it("returns OFF when getItem THROWS (storage disabled), never throwing (FD-1)", () => {
    // A throwing store must resolve OFF, not crash — every read is wrapped in
    // try/catch returning the default.
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readIncludeCodingSolution()).toBe(false);
  });
});

describe("setIncludeCodingSolution", () => {
  it("persists ON as the literal \"true\"", () => {
    setIncludeCodingSolution(true);
    expect(store[INCLUDE_CODING_SOLUTION_STORAGE_KEY]).toBe("true");
    expect(readIncludeCodingSolution()).toBe(true);
  });

  it("persists OFF as the literal \"false\" and round-trips to false", () => {
    setIncludeCodingSolution(true);
    setIncludeCodingSolution(false);
    expect(store[INCLUDE_CODING_SOLUTION_STORAGE_KEY]).toBe("false");
    expect(readIncludeCodingSolution()).toBe(false);
  });

  it("is reversible: ON then OFF leaves no residue", () => {
    setIncludeCodingSolution(true);
    expect(readIncludeCodingSolution()).toBe(true);
    setIncludeCodingSolution(false);
    expect(readIncludeCodingSolution()).toBe(false);
  });

  it("does not throw when a WRITE throws (storage disabled), but still notifies", () => {
    // Mirrors answerAsMe/engine: the listener fires even when the write fails,
    // so a React subscriber re-renders to the in-memory value, and the write
    // path is itself try/catch-guarded so a throwing store cannot crash.
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    const cb = vi.fn();
    subscribe(cb);
    expect(() => setIncludeCodingSolution(true)).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not throw when localStorage is wholly unavailable, but still notifies", () => {
    delete globalThis.localStorage;
    const cb = vi.fn();
    subscribe(cb);
    expect(() => setIncludeCodingSolution(true)).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe (same-tab module listeners)", () => {
  it("notifies listeners on each set and stops after unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    setIncludeCodingSolution(true);
    setIncludeCodingSolution(false);
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    setIncludeCodingSolution(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("notifies every active subscriber (one shared value, many readers)", () => {
    // This is the same-tab shared-store property both the live writer and the
    // practice reader depend on: a single set notifies all module subscribers.
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    setIncludeCodingSolution(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("useIncludeCodingSolution", () => {
  it("is exported as a hook function", () => {
    expect(useIncludeCodingSolution).toBeTypeOf("function");
  });
});
