import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeMode,
  readMode,
  subscribe,
  setMode,
  useColorMode,
} from "./colorMode";
import { THEME_STORAGE_KEY } from "./tokens";

// The store reads/writes the DOM (<html data-theme>) and localStorage. The node
// test environment has neither, so we install minimal fakes on globalThis.
function installDom() {
  const attrs = {};
  const store = {};
  globalThis.document = {
    documentElement: {
      setAttribute: (k, v) => {
        attrs[k] = v;
      },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
    },
  };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  return { attrs, store };
}

let dom;
beforeEach(() => {
  dom = installDom();
});
afterEach(() => {
  delete globalThis.document;
  delete globalThis.localStorage;
  vi.restoreAllMocks();
});

describe("normalizeMode", () => {
  it("passes through the two valid modes", () => {
    expect(normalizeMode("dark")).toBe("dark");
    expect(normalizeMode("light")).toBe("light");
  });

  it("coerces anything else to light", () => {
    for (const v of ["DARK", "purple", "", null, undefined, 0, {}, "lightt"]) {
      expect(normalizeMode(v)).toBe("light");
    }
  });
});

describe("readMode", () => {
  it("returns light when no mode is set", () => {
    expect(readMode()).toBe("light");
  });

  it("reflects the current data-theme attribute", () => {
    dom.attrs["data-theme"] = "dark";
    expect(readMode()).toBe("dark");
    dom.attrs["data-theme"] = "light";
    expect(readMode()).toBe("light");
  });

  it("normalizes a garbage attribute value to light", () => {
    dom.attrs["data-theme"] = "neon";
    expect(readMode()).toBe("light");
  });

  it("returns light during SSR (no document)", () => {
    delete globalThis.document;
    expect(readMode()).toBe("light");
  });
});

describe("setMode", () => {
  it("writes the mode to <html data-theme>", () => {
    setMode("dark");
    expect(dom.attrs["data-theme"]).toBe("dark");
    setMode("light");
    expect(dom.attrs["data-theme"]).toBe("light");
  });

  it("persists the mode under the storage key", () => {
    setMode("dark");
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("normalizes invalid input to light before writing", () => {
    setMode("chartreuse");
    expect(dom.attrs["data-theme"]).toBe("light");
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("readMode reflects what setMode wrote (round-trip)", () => {
    setMode("dark");
    expect(readMode()).toBe("dark");
  });

  it("does not throw and still notifies when the DOM write fails", () => {
    globalThis.document.documentElement.setAttribute = () => {
      throw new Error("no DOM");
    };
    const cb = vi.fn();
    subscribe(cb);
    expect(() => setMode("dark")).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not throw when localStorage is unavailable", () => {
    delete globalThis.localStorage;
    expect(() => setMode("dark")).not.toThrow();
  });
});

describe("subscribe", () => {
  it("invokes the listener on each setMode", () => {
    const cb = vi.fn();
    subscribe(cb);
    setMode("dark");
    setMode("light");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    setMode("dark");
    unsub();
    setMode("light");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("notifies every active subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    setMode("dark");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("returns an idempotent unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    expect(() => {
      unsub();
      unsub();
    }).not.toThrow();
    setMode("dark");
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("useColorMode", () => {
  it("is exported as a hook function", () => {
    expect(useColorMode).toBeTypeOf("function");
  });
});
