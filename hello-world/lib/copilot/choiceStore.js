// React-free persisted-choice store factory (FD-1, A4.1). `lib/` never
// imports React — nine other modules in `lib/copilot/` state that same
// convention, because it is what keeps this directory testable in the
// repo's DEFAULT node environment, with no jsdom and no `@vitest-environment`
// docblock. Importing React here would drag this module out of that
// environment and defeat the entire reason it exists.
//
// `createChoiceStore({ storageKey, defaultValue, normalize, crossWindow,
// encode, decode })` returns the primitives — `get`, `set`, `hydrate`,
// `subscribe`, `subscribeChange`, `getServerSnapshot`, `getStorageBlocked`,
// `__resetForTests`. Thin React hooks (`useSyncExternalStore` wrappers) are
// NOT built here; they live in `app/copilot/` (contract 2), one file per
// caller, over these primitives.
//
// EVERY PIECE OF STATE BELOW IS PER-INSTANCE, DECLARED INSIDE THE FACTORY
// FUNCTION BODY (FD-1). The obvious shape for a single-caller store is a
// module-level `let currentValue` — that is what both design documents this
// module was built from actually describe, because at the time each had
// exactly one caller in mind. Extracted naively, that variable is shared by
// EVERY instance the factory ever creates, so a second store silently
// overwrites the first the moment it exists. This chunk has one caller
// (the interview-type picker); a later chunk adds a second (a code-language
// override) under a different key, and the defect would surface there as
// two unrelated controls moving together — invisible to every test a
// single-instance chunk could write. `choiceStore.test.js`'s "every instance
// owns ALL of its own state (FD-1)" block is the only assertion in this tree
// that can catch it, by constructing two stores and proving neither observes
// the other's writes, blocked flag, foreign changes, or listener resets. The
// only thing that IS module scope is the registry `resetAllChoiceStores`
// walks, below — it holds store OBJECTS, never store STATE.
//
// THE READ PATH IS NEVER AUTHORITATIVE (C5 / A1). `get()` is `getSnapshot`:
// it must be pure, returning the in-memory value with no side effect, so it
// can be called from render as often as React likes. Earlier designs had the
// read path re-read and "refresh" the in-memory value from storage on every
// call. That is the exact mechanism behind the storage-failure defect this
// store exists to close: when `setItem` throws but `getItem` still succeeds
// (quota, Safari private browsing), a refresh-on-read implementation
// overwrites the tab's own choice with the stale value still sitting in
// storage the instant anything reads it again — the picker silently snaps
// back, and the request body and cache key built from it carry the old
// value indefinitely. So storage is demoted here to a persistence SINK and a
// CROSS-WINDOW INPUT CHANNEL, nothing more: the in-memory value is advanced
// only at an explicit write (`set`) or an explicit external-change point
// (`hydrate`, called by the caller once at construction and by the `storage`
// listener). `get()` never advances it.
//
// THE DIFF MUST BE COMPUTED AGAINST WHAT THIS TAB BELIEVED, because that is
// what its caches were built under. Trace: storage holds "general"; a quota
// tab picks "technical" (the write throws, so a STORAGE-tracking baseline
// would still read "general") and answers get cached under "technical"; the
// tab picks "general" again — a storage-tracking diff sees "general" ===
// "general" and fires nothing, leaving "technical"-grounded cache entries
// behind a tab that believes it is back on "general". The one in-memory
// value doubles as the diff baseline by construction (it has exactly two
// writers, `set` and `hydrate`, and the read path provably cannot advance
// it), so this trap cannot occur here.
//
// getServerSnapshot() returns the CONSTANT `defaultValue`, never the live
// in-memory value (C4): module scope — and, in a long-lived server process,
// the whole module instance — is shared across requests, so returning the
// live value would let one request's choice leak into another request's
// server-rendered snapshot. `useSyncExternalStore` also requires a server
// snapshot to be referentially stable across calls, which a mutable value
// is not.
//
// A SERIALIZER, NOT ONLY A NORMALIZER. `normalize` guards against a retired
// or hand-edited stored value (returns to `defaultValue` on anything it does
// not recognize) but says nothing about the STRING a value is persisted as.
// A caller must be able to store, say, a boolean as `"on"`/`"off"` rather
// than `"true"`/`"false"` without changing what is already sitting in that
// key for existing users — the exact shape `useSaveRecordings.js`'s
// `readSaveEnabled`/`writeSaveEnabled` already need. `encode`/`decode` are
// therefore part of this contract, defaulting to the identity function so a
// plain-string store (this chunk's only caller) never has to supply them.
// `decode` runs on the raw value BEFORE `normalize`; `encode` runs on the
// normalized value before it is handed to `setItem`.
//
// THE STORAGE-BLOCKED FLAG (A13) IS A PRIMITIVE BOOLEAN SNAPSHOT, never an
// object and never a fresh array. `useSyncExternalStore` bails out of a
// re-render only when the snapshot is `Object.is`-equal to the last one it
// saw; a fresh allocation on every call — `{ blocked: true }`, `[...]` — is
// never equal to itself and re-renders forever. It starts `false` and,
// once a `setItem` or `getItem` failure is observed in this tab, stays
// `true` for the rest of the tab's life: it reports the ENVIRONMENT (quota
// exhausted, private browsing refusing writes), not the outcome of one
// write, so a later successful write must not un-tell the user their
// choices are not being saved.
//
// A TEST-ONLY RESET, AND A CROSS-INSTANCE REGISTRY. Once this store is
// memory-authoritative, `localStorage.clear()` no longer resets it —
// `__resetForTests()` is the per-instance escape hatch (precedents:
// `app/copilot/roles/roleDrillStore.js`'s `resetRoleDrillStore`,
// `answerSessionCache.js`'s `createTtlCache().clear()`), and
// `resetAllChoiceStores()` is the module-level registry every instance
// registers itself into. The registry exists because a per-store reset
// requires a suite to know every store that exists; a later chunk adds a
// second one, and three suites in this repo mount two writers where this
// chunk has exactly one — a per-store reset silently under-resets the
// moment a store is added, which is FD-1's defect shape one level up.
// Production code never calls either reset function.
//
// THE STORAGE HANDLER is attached (never refcounted, never removed) exactly
// once per instance, and only when the caller asks for `crossWindow` AND a
// `window` with a real `addEventListener` exists — an unguarded
// `window.addEventListener` call throws on import in every node test, which
// is the default environment for this whole directory. It ignores an event
// whose `storageArea` is present and is not `localStorage` (a different
// storage object entirely); it ignores `e.key !== null && e.key !==
// storageKey` — an EXACT match, deliberately never a `startsWith` prefix
// check, because at least one key in this app
// (`copilot-audio-source`) is written from two different call sites and a
// prefix filter would cross-fire between unrelated stores; and it treats
// `e.key === null` (another window's `localStorage.clear()`) as a signal to
// re-hydrate, because ignoring a null key would strand every other tab on a
// value storage no longer holds. It always re-reads storage itself via
// `hydrate()` rather than trusting the event's own `newValue`, both because
// that is the one code path that also has to handle `e.key === null` (which
// carries no `newValue` at all) and because trusting an event payload over
// re-reading the channel it claims to describe is not a habit worth forming.
//
// `typeof localStorage` — not `typeof window` — is the guard used to decide
// whether persistence is available at all: it is what makes every case in
// `choiceStore.test.js` runnable in node with no jsdom, and it was verified
// SSR-safe (Next.js never defines a global `localStorage` on the server).
//
// STORES THAT HAVE NOT ADOPTED THIS FACTORY, and why migrating them is not
// mechanical: `app/copilot/roles/useRoleChoice.js` (already carries a
// hand-written version of the same fix, still broken under quota because
// its successful-read branch overwrites the in-memory fallback the same way
// this module's own `get()` deliberately does not);
// `app/copilot/roles/roleDrillStore.js`; `app/copilot/practice/
// useSaveRecordings.js` and `app/settings/engine.js` (both carry the same
// false "the choice still applies for the rest of this tab" comment this
// module's own predecessor, `useInterviewType.js`, had). A migration of
// `useSaveRecordings` was scoped into this same chunk and then withdrawn:
// `RoleDrillClient.recording.test.js` clicks that switch THROUGH THE UI and
// resets state with `localStorage.clear()` in its `beforeEach`, so making
// that store memory-authoritative silently breaks a positive control in a
// suite this chunk may not touch. Component suites reach these controls
// through the UI, not through the module's own exported functions, which is
// exactly what makes the migration non-mechanical — it is deferred, not
// forgotten.

const registry = [];

/**
 * @param {object} options
 * @param {string} options.storageKey
 * @param {*} options.defaultValue
 * @param {(value: *) => *} options.normalize - returns `defaultValue` (or any
 *   other valid value) for anything it does not recognize; never throws.
 * @param {boolean} [options.crossWindow=false] - attach a `storage` listener
 *   so a change made in another tab/window is adopted here.
 * @param {(value: *) => *} [options.encode] - transforms the normalized value
 *   into whatever gets handed to `setItem`. Defaults to the identity.
 * @param {(raw: *) => *} [options.decode] - transforms the raw value read
 *   from storage before it is handed to `normalize`. Defaults to the
 *   identity.
 */
export function createChoiceStore({
  storageKey,
  defaultValue,
  normalize,
  crossWindow = false,
  encode = (value) => value,
  decode = (raw) => raw,
}) {
  // Every one of these is per-instance (FD-1) — none of it is declared
  // outside this function body.
  let memoryValue = defaultValue;
  let blocked = false;
  const snapshotListeners = new Set();
  const changeListeners = new Set();

  function notifySnapshotListeners() {
    snapshotListeners.forEach((cb) => cb());
  }

  function notifyChangeListeners(next, prev, origin) {
    changeListeners.forEach((cb) => cb(next, prev, { origin }));
  }

  // The one place a value transition is applied and notified from an
  // EXTERNAL source (construction-time seeding, or a foreign `storage`
  // event) — see `hydrate()`. `set()` below does its own, slightly
  // different sequence, because it also has a write to attempt in between.
  function advance(next, origin) {
    const prev = memoryValue;
    if (next === prev) return;
    memoryValue = next;
    notifySnapshotListeners();
    notifyChangeListeners(next, prev, origin);
  }

  function get() {
    return memoryValue;
  }

  function getServerSnapshot() {
    return defaultValue;
  }

  function getStorageBlocked() {
    return blocked;
  }

  function hydrate() {
    if (typeof localStorage === "undefined") return;
    let next;
    try {
      next = normalize(decode(localStorage.getItem(storageKey)));
    } catch {
      if (!blocked) {
        blocked = true;
        notifySnapshotListeners();
      }
      return;
    }
    advance(next, "foreign");
  }

  function set(value) {
    const next = normalize(value);
    const prev = memoryValue;
    if (next === prev) return;
    memoryValue = next;
    try {
      localStorage.setItem(storageKey, encode(next));
    } catch {
      blocked = true;
    }
    notifySnapshotListeners();
    notifyChangeListeners(next, prev, "local");
  }

  function subscribe(cb) {
    snapshotListeners.add(cb);
    return () => snapshotListeners.delete(cb);
  }

  function subscribeChange(cb) {
    changeListeners.add(cb);
    return () => changeListeners.delete(cb);
  }

  function __resetForTests() {
    memoryValue = defaultValue;
    blocked = false;
    snapshotListeners.clear();
    changeListeners.clear();
  }

  function onStorageEvent(e) {
    if (!e) return;
    if (e.storageArea != null && e.storageArea !== localStorage) return;
    if (e.key !== null && e.key !== storageKey) return;
    hydrate();
  }

  if (
    crossWindow &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("storage", onStorageEvent);
  }

  const store = {
    get,
    set,
    hydrate,
    subscribe,
    subscribeChange,
    getServerSnapshot,
    getStorageBlocked,
    __resetForTests,
  };

  registry.push(store);

  return store;
}

// Test-only. Production code has no reason to ever call this — resets every
// store this module has ever constructed, including ones the calling test
// never named itself. See the module header for why a registry, not a
// per-store seam, is required.
export function resetAllChoiceStores() {
  registry.forEach((store) => store.__resetForTests());
}
