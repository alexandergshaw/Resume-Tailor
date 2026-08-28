// node (this repo's default environment — no `@vitest-environment` docblock).
//
// The contract under test is `lib/copilot/choiceStore.js`'s `createChoiceStore`
// factory: a React-free, persisted-choice store whose ENTIRE state lives in the
// closure the factory returns.
//
// Written BEFORE the implementation exists (step 4b), so every case here fails
// on a missing module until `choiceStore.js` lands. What each case is for:
//
//   * FD-1 — the two-instance isolation case below is the ONLY assertion in
//     this tree that can catch module-scope state in a factory. A factory whose
//     `memoryValue`, blocked flag and listener sets sit at module scope passes
//     every single-instance test ever written, because chunk A constructs
//     exactly one store. Chunk C constructs the second, and the defect surfaces
//     there as two unrelated controls moving together. It is caught here or not
//     at all.
//   * AC-A8 / §5.1 row 1 — `setItem` throws while `getItem` still works (quota,
//     Safari private browsing). The selection must APPLY and must not be
//     reverted by this tab's own read path. Today's `useInterviewType.js:42-52`
//     asserts the opposite of what it does.
//   * A5 / §5.1 row 1b — the diff baseline is what THIS TAB BELIEVED, not what
//     storage holds. A storage-tracking baseline silently swallows the second
//     change of a quota session.
//   * AC-A14 / §5.1 row 7 — same value re-selected notifies nothing.
//   * AC-A10 / §5.1 rows 5, 6 — the `storage` handler filters on the exact key
//     and accepts `e.key === null` (a foreign `clear()`).
//   * C4 — `getServerSnapshot()` is the CONSTANT default, never the live value.
//   * AC-A29b / A8 — the test-only reset seam, because a memory-authoritative
//     store is no longer reset by `localStorage.clear()`.
//
// Environment note, deliberately written down: in node `typeof localStorage`,
// `typeof window` and `typeof addEventListener` are all "undefined", so every
// case stubs `globalThis.localStorage` / `globalThis.window` BEFORE constructing
// a store. Each `crossWindow` construction attaches its own listener to the
// fake window and never detaches it; those are inert (each closes over its own
// store's state and the window itself is replaced per case), and the fix is NOT
// to add a `__destroy` the production singleton would then also need.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createChoiceStore, resetAllChoiceStores } from "./choiceStore.js";

const VALUES = ["alpha", "beta", "gamma"];
const normalize = (value) => (VALUES.includes(value) ? value : "alpha");

// A stand-in for localStorage whose failures are switchable mid-case, so a
// single store instance can be watched across the transition from "storage
// works" to "storage is refusing writes" — which is the real quota timeline.
function makeStorage(faults = { get: false, set: false }) {
  const raw = new Map();
  return {
    faults,
    raw,
    getItem(key) {
      if (faults.get) throw new Error("getItem is blocked");
      return raw.has(key) ? raw.get(key) : null;
    },
    setItem(key, value) {
      if (faults.set) throw new Error("QuotaExceededError");
      raw.set(key, String(value));
    },
    removeItem(key) {
      raw.delete(key);
    },
    clear() {
      raw.clear();
    },
  };
}

function makeWindow() {
  const handlers = new Map();
  return {
    addEventListener(type, cb) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(cb);
    },
    removeEventListener(type, cb) {
      handlers.get(type)?.delete(cb);
    },
    listenerCount(type) {
      return handlers.get(type)?.size || 0;
    },
    fire(type, event) {
      for (const cb of [...(handlers.get(type) || [])]) cb(event);
    },
  };
}

let storage;
let win;

beforeEach(() => {
  storage = makeStorage({ get: false, set: false });
  win = makeWindow();
  globalThis.localStorage = storage;
  globalThis.window = win;
});

afterEach(() => {
  resetAllChoiceStores();
  delete globalThis.localStorage;
  delete globalThis.window;
});

function makeStore(overrides = {}) {
  return createChoiceStore({
    storageKey: "test-choice-key",
    defaultValue: "alpha",
    normalize,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// FD-1. The one assertion chunk A can make that chunk C's defect cannot hide
// from.
// ---------------------------------------------------------------------------

describe("createChoiceStore — every instance owns ALL of its own state (FD-1)", () => {
  it("does not let one store's write reach another store created under a different key", () => {
    const a = makeStore({ storageKey: "key-a", defaultValue: "alpha" });
    const b = makeStore({ storageKey: "key-b", defaultValue: "beta" });

    const aChanges = [];
    const bChanges = [];
    a.subscribeChange((next, prev, meta) => aChanges.push([next, prev, meta?.origin]));
    b.subscribeChange((next, prev, meta) => bChanges.push([next, prev, meta?.origin]));

    a.set("gamma");

    // POSITIVE CONTROL, in the same case on purpose: without these three, a
    // store that does nothing at all satisfies every assertion below. The
    // isolation claim is only meaningful once A is proven to have really moved.
    expect(a.get()).toBe("gamma");
    expect(aChanges).toEqual([["gamma", "alpha", "local"]]);
    expect(storage.raw.get("key-a")).toBe("gamma");

    // The FD-1 assertion. With `let currentValue` at module scope these three
    // are ["gamma"], one entry, and "gamma" — the second store having silently
    // adopted the first's write.
    expect(b.get()).toBe("beta");
    expect(bChanges).toEqual([]);
    expect(storage.raw.has("key-b")).toBe(false);
  });

  it("does not let a throwing write on one store set the other store's blocked flag", () => {
    const a = makeStore({ storageKey: "key-a", defaultValue: "alpha" });
    const b = makeStore({ storageKey: "key-b", defaultValue: "beta" });

    expect(a.getStorageBlocked()).toBe(false);
    expect(b.getStorageBlocked()).toBe(false);

    storage.faults.set = true;
    a.set("gamma");

    // Positive control for the flag itself — see the storage-failure block
    // below for the full contract; here it only has to be proven to have moved.
    expect(a.getStorageBlocked()).toBe(true);
    // The FD-1 assertion: a module-scope flag is now true for B as well, and
    // chunk C's second control would tell the user their choice is not being
    // saved when nothing of the sort happened.
    expect(b.getStorageBlocked()).toBe(false);
  });

  it("does not let a foreign change delivered to one store advance the other", () => {
    const a = makeStore({ storageKey: "key-a", defaultValue: "alpha", crossWindow: true });
    const b = makeStore({ storageKey: "key-b", defaultValue: "beta", crossWindow: true });

    storage.raw.set("key-a", "gamma");
    win.fire("storage", { key: "key-a", newValue: "gamma", storageArea: storage });

    expect(a.get()).toBe("gamma"); // positive control
    expect(b.get()).toBe("beta");
  });

  it("gives each instance its own listener sets, so resetting one leaves the other subscribed", () => {
    const a = makeStore({ storageKey: "key-a", defaultValue: "alpha" });
    const b = makeStore({ storageKey: "key-b", defaultValue: "beta" });

    const aSeen = [];
    const bSeen = [];
    a.subscribeChange((next) => aSeen.push(next));
    b.subscribeChange((next) => bSeen.push(next));

    a.__resetForTests();

    a.set("beta");
    b.set("gamma");

    expect(aSeen).toEqual([]); // A's listeners were emptied by ITS reset
    expect(bSeen).toEqual(["gamma"]); // B's were not — positive control
  });
});

// ---------------------------------------------------------------------------
// The read path, and why it is never authoritative (C5 / A1).
// ---------------------------------------------------------------------------

describe("createChoiceStore — reads", () => {
  it("starts at the default when storage holds nothing", () => {
    const store = makeStore();
    store.hydrate();
    expect(store.get()).toBe("alpha");
  });

  it("hydrate() seeds the value from storage", () => {
    storage.raw.set("test-choice-key", "gamma");
    const store = makeStore();
    store.hydrate();
    expect(store.get()).toBe("gamma");
  });

  it("normalizes a retired or hand-edited stored value back to the default (AC-A7)", () => {
    storage.raw.set("test-choice-key", "not-a-real-value");
    const store = makeStore();
    store.hydrate();
    expect(store.get()).toBe("alpha");
  });

  it("get() is pure — it reads no storage and writes nothing (C5)", () => {
    const store = makeStore();
    store.hydrate();
    store.set("beta");

    const getItem = vi.spyOn(storage, "getItem");
    const setItem = vi.spyOn(storage, "setItem");
    expect(store.get()).toBe("beta");
    expect(store.get()).toBe("beta");
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("returns a primitive, never a fresh object (AC-A8c — the infinite-render trap)", () => {
    const store = makeStore();
    expect(typeof store.get()).toBe("string");
    expect(Object.is(store.get(), store.get())).toBe(true);
    expect(typeof store.getStorageBlocked()).toBe("boolean");
    expect(Object.is(store.getStorageBlocked(), store.getStorageBlocked())).toBe(true);
  });

  it("getServerSnapshot() is the CONSTANT default even after a write (C4)", () => {
    const store = makeStore();
    store.hydrate();
    store.set("gamma");
    expect(store.get()).toBe("gamma"); // positive control
    // Module scope is shared across requests in a long-lived server process;
    // returning the live value lets one request's choice reach another's SSR.
    expect(store.getServerSnapshot()).toBe("alpha");
    expect(store.getServerSnapshot()).toBe("alpha");
  });

  it("survives an environment with no storage at all (§5.1 row 3)", () => {
    delete globalThis.localStorage;
    const store = makeStore();
    expect(() => store.hydrate()).not.toThrow();
    expect(store.get()).toBe("alpha");
    expect(() => store.set("beta")).not.toThrow();
    expect(store.get()).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// AC-A8 / AC-A8b — the storage-failure path.
// ---------------------------------------------------------------------------

describe("createChoiceStore — a selection made while storage refuses writes (AC-A8)", () => {
  it("applies the choice and never lets its own read path revert it", () => {
    storage.raw.set("test-choice-key", "alpha");
    const store = makeStore();
    store.hydrate();

    // Quota is reached / private browsing refuses. `getItem` still WORKS, which
    // is the whole shape of the defect: a store that treats a successful read
    // as authoritative overwrites the choice with the stale stored value.
    storage.faults.set = true;
    store.set("gamma");

    expect(store.get()).toBe("gamma");
    // Read it repeatedly — a refresh-on-read implementation snaps back here.
    expect(store.get()).toBe("gamma");
    expect(store.get()).toBe("gamma");
    // And storage genuinely never took the value, so this is not passing
    // because the write quietly succeeded.
    expect(storage.raw.get("test-choice-key")).toBe("alpha");
  });

  it("reports the failure through a sticky primitive flag (AC-A8b)", () => {
    const store = makeStore();
    store.hydrate();

    // Positive control: a healthy store does NOT claim storage is blocked, so
    // the assertion below cannot be satisfied by a flag hardcoded to true.
    store.set("beta");
    expect(store.getStorageBlocked()).toBe(false);
    expect(storage.raw.get("test-choice-key")).toBe("beta");

    storage.faults.set = true;
    store.set("gamma");
    expect(store.getStorageBlocked()).toBe(true);

    // Sticky: it reports the ENVIRONMENT, not one write. A later successful
    // write does not un-tell the user their settings are not being saved.
    storage.faults.set = false;
    store.set("beta");
    expect(store.getStorageBlocked()).toBe(true);
  });

  it("sets the flag when getItem itself throws, and does not snap back (§5.1 row 2)", () => {
    const store = makeStore();
    store.hydrate();
    store.set("gamma");

    storage.faults.get = true;
    store.hydrate();

    expect(store.get()).toBe("gamma");
    expect(store.getStorageBlocked()).toBe(true);
  });

  it("diffs against what THIS TAB believed, not against storage (A5's trace, §5.1 row 1b)", () => {
    // Storage holds "alpha". The tab picks "gamma" and the write throws, so a
    // storage-tracking baseline still reads "alpha". The tab's caches are now
    // built under "gamma". The user picks "alpha" again — which MUST fire, or
    // "gamma"-grounded cache entries sit behind a tab that believes "alpha".
    storage.raw.set("test-choice-key", "alpha");
    const store = makeStore();
    store.hydrate();

    const changes = [];
    store.subscribeChange((next, prev, meta) => changes.push([next, prev, meta?.origin]));

    storage.faults.set = true;
    store.set("gamma");
    store.set("alpha");

    expect(changes).toEqual([
      ["gamma", "alpha", "local"],
      ["alpha", "gamma", "local"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Notification order, gating, and the origin channel.
// ---------------------------------------------------------------------------

describe("createChoiceStore — notification", () => {
  it("advances the value BEFORE notifying, so the first listener already reads the new one (C6 step 1)", () => {
    const store = makeStore();
    store.hydrate();

    const snapshotReads = [];
    const changeReads = [];
    store.subscribe(() => snapshotReads.push(store.get()));
    store.subscribeChange(() => changeReads.push(store.get()));

    store.set("beta");

    expect(snapshotReads).toEqual(["beta"]);
    expect(changeReads).toEqual(["beta"]);
  });

  it("does not notify when the same value is re-selected (AC-A14, §5.1 row 7)", () => {
    const store = makeStore();
    store.hydrate();
    store.set("beta");

    const snapshot = vi.fn();
    const change = vi.fn();
    store.subscribe(snapshot);
    store.subscribeChange(change);

    store.set("beta");
    expect(snapshot).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();

    // Positive control, without which a store that notifies nobody passes.
    store.set("gamma");
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("gates on the value even when the raw input differs but normalizes the same", () => {
    const store = makeStore();
    store.hydrate();
    const change = vi.fn();
    store.subscribeChange(change);

    store.set("nonsense"); // normalizes to "alpha", which is already the value
    expect(change).not.toHaveBeenCalled();
    expect(store.get()).toBe("alpha");

    store.set("beta"); // positive control
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("labels a write from this document 'local' and a storage event 'foreign' (A12)", () => {
    const store = makeStore({ crossWindow: true });
    store.hydrate();
    const seen = [];
    store.subscribeChange((next, prev, meta) => seen.push([next, prev, meta?.origin]));

    store.set("beta");
    storage.raw.set("test-choice-key", "gamma");
    win.fire("storage", { key: "test-choice-key", newValue: "gamma", storageArea: storage });

    expect(seen).toEqual([
      ["beta", "alpha", "local"],
      ["gamma", "beta", "foreign"],
    ]);
  });

  it("stops calling a listener that has unsubscribed", () => {
    const store = makeStore();
    store.hydrate();
    const change = vi.fn();
    const off = store.subscribeChange(change);

    store.set("beta");
    expect(change).toHaveBeenCalledTimes(1); // positive control

    off();
    store.set("gamma");
    expect(change).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC-A10 — the cross-window channel and its key filter.
// ---------------------------------------------------------------------------

describe("createChoiceStore — the storage event handler (AC-A10)", () => {
  it("adopts a foreign change under its own key", () => {
    const store = makeStore({ crossWindow: true });
    store.hydrate();

    storage.raw.set("test-choice-key", "gamma");
    win.fire("storage", { key: "test-choice-key", newValue: "gamma", storageArea: storage });

    expect(store.get()).toBe("gamma");
  });

  it("re-reads STORAGE rather than trusting the event's newValue", () => {
    // Every other storage case here puts the same string in `storage.raw` and
    // in `newValue`, so a handler that trusts the event and never re-reads is
    // indistinguishable from one that hydrates. This is the one case where the
    // two disagree, and it is what makes the contrast the others look like
    // they are drawing an actual contrast.
    //
    // Storage is the authority because `hydrate()` is also what the
    // `e.key === null` (foreign `clear()`) path runs, where there is no
    // `newValue` to trust at all — one code path, one source of truth.
    const store = makeStore({ crossWindow: true });
    store.hydrate();

    storage.raw.set("test-choice-key", "gamma");
    win.fire("storage", { key: "test-choice-key", newValue: "beta", storageArea: storage });

    expect(store.get()).toBe("gamma");
  });

  it("ignores an event for a DIFFERENT key on the same origin", () => {
    // `copilot-audio-source` is written from two places in this app, so a
    // `startsWith("copilot-")` filter is not merely loose — it is wrong.
    const store = makeStore({ crossWindow: true });
    store.hydrate();
    const change = vi.fn();
    store.subscribeChange(change);

    storage.raw.set("copilot-audio-source", "system");
    win.fire("storage", { key: "copilot-audio-source", newValue: "system", storageArea: storage });

    expect(store.get()).toBe("alpha");
    expect(change).not.toHaveBeenCalled();

    // Positive control in the same case: the handler is alive and this
    // absence is a filter doing its job, not a listener that was never wired.
    storage.raw.set("test-choice-key", "beta");
    win.fire("storage", { key: "test-choice-key", newValue: "beta", storageArea: storage });
    expect(store.get()).toBe("beta");
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("accepts e.key === null, a foreign clear() (§5.1 row 6)", () => {
    storage.raw.set("test-choice-key", "gamma");
    const store = makeStore({ crossWindow: true });
    store.hydrate();
    expect(store.get()).toBe("gamma");

    storage.raw.clear();
    win.fire("storage", { key: null, newValue: null, storageArea: storage });

    // Ignoring a null key strands every other tab on a value storage no
    // longer holds.
    expect(store.get()).toBe("alpha");
  });

  it("ignores an event from a storage area that is not localStorage", () => {
    const store = makeStore({ crossWindow: true });
    store.hydrate();

    const other = makeStorage();
    storage.raw.set("test-choice-key", "gamma");
    win.fire("storage", { key: "test-choice-key", newValue: "gamma", storageArea: other });

    expect(store.get()).toBe("alpha");

    // Positive control: the same event from the real area IS taken.
    win.fire("storage", { key: "test-choice-key", newValue: "gamma", storageArea: storage });
    expect(store.get()).toBe("gamma");
  });

  it("attaches no window listener at all unless crossWindow is asked for", () => {
    makeStore({ crossWindow: false });
    expect(win.listenerCount("storage")).toBe(0);

    makeStore({ storageKey: "other-key", crossWindow: true });
    expect(win.listenerCount("storage")).toBe(1);
  });

  it("constructs without a window present", () => {
    delete globalThis.window;
    expect(() => makeStore({ crossWindow: true })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-A29b / A8 — the reset seam, required because the store is now
// memory-authoritative and `localStorage.clear()` no longer touches it.
// ---------------------------------------------------------------------------

describe("createChoiceStore — the test-only reset seam (AC-A29b)", () => {
  it("localStorage.clear() alone does NOT reset the store — which is why the seam exists", () => {
    const store = makeStore();
    store.hydrate();
    store.set("gamma");

    storage.clear();
    expect(store.get()).toBe("gamma");

    store.__resetForTests();
    expect(store.get()).toBe("alpha");
  });

  it("__resetForTests() clears the value, the blocked flag and both listener sets", () => {
    const store = makeStore();
    store.hydrate();

    const snapshot = vi.fn();
    const change = vi.fn();
    store.subscribe(snapshot);
    store.subscribeChange(change);

    storage.faults.set = true;
    store.set("gamma");
    expect(store.get()).toBe("gamma");
    expect(store.getStorageBlocked()).toBe(true);
    expect(snapshot).toHaveBeenCalled();
    expect(change).toHaveBeenCalled();

    storage.faults.set = false;
    snapshot.mockClear();
    change.mockClear();
    store.__resetForTests();

    expect(store.get()).toBe("alpha");
    expect(store.getStorageBlocked()).toBe(false);

    store.set("beta");
    expect(snapshot).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
  });

  it("resetAllChoiceStores() resets every instance, including ones a test never named", () => {
    // The registry exists because a per-store reset requires a suite to know
    // every store that exists — and chunk C adds one. A per-store reset
    // silently under-resets the moment a store is added, which is FD-1's shape.
    const a = makeStore({ storageKey: "key-a", defaultValue: "alpha" });
    const b = makeStore({ storageKey: "key-b", defaultValue: "beta" });
    a.set("gamma");
    b.set("gamma");
    expect(a.get()).toBe("gamma");
    expect(b.get()).toBe("gamma");

    resetAllChoiceStores();

    expect(a.get()).toBe("alpha");
    expect(b.get()).toBe("beta");
  });
});
