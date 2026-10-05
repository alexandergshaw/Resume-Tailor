// N102 AC-3 -- the "answer as me" preference store.
//
// A localStorage-backed useSyncExternalStore, modelled byte-for-byte on
// app/settings/engine.js (and its engine.test.js). This file mirrors that
// test so the two stores cannot drift. The ONE property that matters most for
// safety is the default: an empty, unreadable, or garbage store must resolve
// to OFF (false), never ON -- a user must never silently start speaking in
// their own voice without having chosen it (AC-3 failure direction).
//
// RED-ON-HEAD: `./answerAsMe` does not exist at HEAD (grep: 0 hits for a chat
// voice store). The named imports below cannot resolve, so this whole file is
// a collection-error RED until the module is written. That is the honest red
// for "the store does not exist yet" -- once the reference module lands, every
// case runs.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeAnswerAsMe,
  readAnswerAsMe,
  subscribe,
  setAnswerAsMe,
  useAnswerAsMe,
  DEFAULT_ANSWER_AS_ME,
  ANSWER_AS_ME_STORAGE_KEY,
} from "./answerAsMe";

// The store persists to localStorage, which the node test env lacks -- install
// a minimal fake on globalThis, exactly as engine.test.js does.
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

describe("answer-as-me metadata", () => {
  it("defaults OFF under a distinct, new storage key", () => {
    // The safe default is the whole point of AC-3's failure direction.
    expect(DEFAULT_ANSWER_AS_ME).toBe(false);
    // A NEW key, not the engine's "tailorEngine" or the panel's "chatSize" --
    // a voice preference is neither of those, and sharing a key would couple
    // two unrelated settings.
    expect(ANSWER_AS_ME_STORAGE_KEY).toBe("chatAnswerAsMe");
    expect(ANSWER_AS_ME_STORAGE_KEY).not.toBe("tailorEngine");
  });
});

describe("normalizeAnswerAsMe", () => {
  it("treats ONLY the exact string \"true\" as ON", () => {
    expect(normalizeAnswerAsMe("true")).toBe(true);
  });

  it("coerces every other value to OFF (the make-wrong-safe core)", () => {
    // null/empty is the unreadable-store case; "1"/"yes"/"TRUE" are garbage;
    // boolean true is NOT the stored form (localStorage holds strings) and
    // must not be mistaken for it. Every one of these resolves OFF.
    for (const v of [null, undefined, "", "1", "yes", "TRUE", "false", "0", 1, true, {}, []]) {
      expect(normalizeAnswerAsMe(v)).toBe(false);
    }
  });
});

describe("readAnswerAsMe", () => {
  it("returns the default (false) when nothing is stored", () => {
    expect(readAnswerAsMe()).toBe(false);
  });

  it("reflects a persisted ON value", () => {
    store[ANSWER_AS_ME_STORAGE_KEY] = "true";
    expect(readAnswerAsMe()).toBe(true);
  });

  it("reflects a persisted OFF value", () => {
    store[ANSWER_AS_ME_STORAGE_KEY] = "false";
    expect(readAnswerAsMe()).toBe(false);
  });

  it("resolves a GARBAGE stored value to OFF, never ON", () => {
    // The dangerous direction: a corrupt/legacy value must fail safe.
    store[ANSWER_AS_ME_STORAGE_KEY] = "1";
    expect(readAnswerAsMe()).toBe(false);
    store[ANSWER_AS_ME_STORAGE_KEY] = "on";
    expect(readAnswerAsMe()).toBe(false);
  });

  it("returns OFF during SSR (no localStorage), never throwing", () => {
    delete globalThis.localStorage;
    expect(readAnswerAsMe()).toBe(false);
  });

  it("returns OFF when getItem THROWS (storage disabled), never throwing", () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readAnswerAsMe()).toBe(false);
  });
});

describe("setAnswerAsMe", () => {
  it("persists ON as the literal \"true\"", () => {
    setAnswerAsMe(true);
    expect(store[ANSWER_AS_ME_STORAGE_KEY]).toBe("true");
    expect(readAnswerAsMe()).toBe(true);
  });

  it("persists OFF as the literal \"false\" and round-trips to false", () => {
    setAnswerAsMe(true);
    setAnswerAsMe(false);
    expect(store[ANSWER_AS_ME_STORAGE_KEY]).toBe("false");
    expect(readAnswerAsMe()).toBe(false);
  });

  it("is reversible: ON then OFF leaves no residue", () => {
    setAnswerAsMe(true);
    expect(readAnswerAsMe()).toBe(true);
    setAnswerAsMe(false);
    expect(readAnswerAsMe()).toBe(false);
  });

  it("does not throw when localStorage is unavailable, but still notifies", () => {
    // Mirrors engine.js setEngine: the listener fires even when the write
    // fails, so a React subscriber re-renders to the in-memory value.
    delete globalThis.localStorage;
    const cb = vi.fn();
    subscribe(cb);
    expect(() => setAnswerAsMe(true)).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe", () => {
  it("notifies listeners on each setAnswerAsMe and stops after unsubscribe", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    setAnswerAsMe(true);
    setAnswerAsMe(false);
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    setAnswerAsMe(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("notifies every active subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    setAnswerAsMe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("useAnswerAsMe", () => {
  it("is exported as a hook function", () => {
    expect(useAnswerAsMe).toBeTypeOf("function");
  });
});
