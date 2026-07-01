import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeEngine,
  readEngine,
  subscribe,
  setEngine,
  useEngine,
  ENGINE_OPTIONS,
  ENGINES,
  DEFAULT_ENGINE,
  ENGINE_STORAGE_KEY,
} from "./engine";

// The store persists to localStorage, which the node test env lacks — install a
// minimal fake on globalThis.
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

describe("engine metadata", () => {
  it("exposes gemini/external/embedded options with labels + hints", () => {
    expect(ENGINES).toEqual(["gemini", "external", "embedded"]);
    for (const opt of ENGINE_OPTIONS) {
      expect(opt.value).toBeTypeOf("string");
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.hint.length).toBeGreaterThan(0);
    }
  });

  it("defaults to gemini under the legacy storage key", () => {
    expect(DEFAULT_ENGINE).toBe("gemini");
    expect(ENGINES).toContain(DEFAULT_ENGINE);
    expect(ENGINE_STORAGE_KEY).toBe("tailorEngine");
  });
});

describe("normalizeEngine", () => {
  it("passes through known engines", () => {
    for (const e of ENGINES) expect(normalizeEngine(e)).toBe(e);
  });

  it("coerces unknown values to the default", () => {
    for (const v of ["GEMINI", "gpt", "", null, undefined, 42, {}]) {
      expect(normalizeEngine(v)).toBe(DEFAULT_ENGINE);
    }
  });
});

describe("readEngine", () => {
  it("returns the default when nothing is stored", () => {
    expect(readEngine()).toBe("gemini");
  });

  it("reflects the persisted engine", () => {
    store[ENGINE_STORAGE_KEY] = "embedded";
    expect(readEngine()).toBe("embedded");
  });

  it("normalizes a garbage stored value", () => {
    store[ENGINE_STORAGE_KEY] = "wingdings";
    expect(readEngine()).toBe("gemini");
  });

  it("returns the default during SSR (no localStorage)", () => {
    delete globalThis.localStorage;
    expect(readEngine()).toBe("gemini");
  });
});

describe("setEngine", () => {
  it("persists the engine under the storage key", () => {
    setEngine("external");
    expect(store[ENGINE_STORAGE_KEY]).toBe("external");
    expect(readEngine()).toBe("external");
  });

  it("normalizes invalid input before writing", () => {
    setEngine("nonsense");
    expect(store[ENGINE_STORAGE_KEY]).toBe("gemini");
  });

  it("does not throw when localStorage is unavailable, but still notifies", () => {
    delete globalThis.localStorage;
    const cb = vi.fn();
    subscribe(cb);
    expect(() => setEngine("embedded")).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe", () => {
  it("notifies listeners on each setEngine and stops after unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    setEngine("external");
    setEngine("embedded");
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    setEngine("gemini");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("notifies every active subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    setEngine("external");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("useEngine", () => {
  it("is exported as a hook function", () => {
    expect(useEngine).toBeTypeOf("function");
  });
});
