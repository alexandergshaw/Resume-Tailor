// THE CLIENT-SIDE TECH-TERM DETAIL CONTENT STORE. Module scope, bounded, in
// memory, and never persisted anywhere. Mirrors expansionStore.js.
//
// WHY MODULE SCOPE AND NOT A HOOK OR A REF. The copilot's transcript region
// swaps element types at the same position when a live session starts or stops,
// which unmounts every card hook state under it. A hook-owned map would silently
// re-buy a paid model call on a tab flick. Nothing in this feature may hold
// detail content in a component or a component's ref.
//
// WHY CONTENT AND OPEN STATE ARE SEPARATE. Content lives here, shared across
// surfaces, keyed on TEXT (techTermDetailContract.js). "Which chips are open" is
// per surface and lives in useTechTermDetails. That split is what makes
// collapsing a chip while its request is in flight legal and NOT a cancel: the
// response completes and writes its record, and because writing a record does
// not set `open`, it cannot reopen a chip the reader closed.
//
// THE KEY IS THE GENERATION GUARD. A response settling under a key the UI no
// longer computes is simply never read: no cancellation, no token, no
// bookkeeping.
//
// NOTHING HERE IS PERSISTED. The detail is general knowledge, but it is also
// keyed on the interview question, which is the user's own words; writing it to
// browser storage would leave that on a shared machine under a key nothing
// expires.

// Matching expansionStore's own bound, a number with a precedent in this repo
// rather than a guess. Eviction is harmless: the next click re-fetches, and the
// chip renders collapsed rather than stale.
export const TECH_TERM_DETAIL_STORE_MAX = 200;

const IDLE = Object.freeze({ status: "idle", detail: "", empty: false, code: null });

// key -> { status, detail, empty, code }
const records = new Map();
const listeners = new Set();

// useSyncExternalStore requires getSnapshot to return the SAME reference when
// nothing has changed; one that allocates re-renders forever. A counter that
// only moves on a write, and a memoised object built from it.
let version = 0;
let snapshot = { version: 0 };

function notify() {
  version += 1;
  snapshot = { version };
  for (const listener of [...listeners]) listener();
}

function touch(key) {
  // Re-insertion is what makes a plain Map an LRU: JS Maps iterate in insertion
  // order, so deleting and re-setting moves an entry to the back and
  // `keys().next()` is always the least recently touched.
  const record = records.get(key);
  if (record === undefined) return undefined;
  records.delete(key);
  records.set(key, record);
  return record;
}

function write(key, record) {
  records.delete(key);
  records.set(key, record);
  while (records.size > TECH_TERM_DETAIL_STORE_MAX) {
    const oldest = records.keys().next();
    if (oldest.done) break;
    records.delete(oldest.value);
  }
  notify();
}

/** Subscribe to writes. Returns the unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A referentially stable value that changes only when a record does. */
export function getSnapshot() {
  return snapshot;
}

/**
 * The record for one key. Reading TOUCHES it, which makes the bound
 * least-recently-USED rather than first-in-first-out: the term a reader keeps
 * reopening is the one worth keeping.
 */
export function getTechTermDetail(key) {
  return touch(key) || IDLE;
}

/**
 * Ask for one detail.
 *
 * DEDUPE, NEVER CANCEL, NEVER QUEUE. A second click while a request is in flight
 * means "I still want this"; queueing a second request doubles the spend for a
 * byte-identical result. A key that already holds a settled record issues
 * nothing at all, which is what makes collapse-then-reopen free.
 *
 * `retry: true` is the ONE way to re-issue a request for a key that already
 * settled, and it only applies to a failure. Retrying an honest empty spends
 * money to be told the same thing.
 *
 * `loading` is never terminal: every path below settles the key, including the
 * one where the fetcher throws something shapeless.
 */
export async function beginTechTermDetail({ key, request } = {}, fetcher, { retry = false } = {}) {
  if (!key || typeof fetcher !== "function") return;

  // THE LOADING RECORD IS THE IN-FLIGHT GUARD. There is deliberately no second
  // `Set` of keys being fetched: the loading record below is written
  // SYNCHRONOUSLY, before any await, so every later call for the same key finds
  // it here and returns.
  const existing = records.get(key);
  if (existing && !(retry && existing.status === "error")) return;

  // SYNCHRONOUS, before any await: the reader gets feedback in the same frame as
  // the click.
  write(key, { status: "loading", detail: "", empty: false, code: null });

  try {
    const result = await fetcher(request);
    const detail = typeof result?.detail === "string" ? result.detail.trim() : "";
    if (!detail || result?.empty === true) {
      write(key, { status: "empty", detail: "", empty: true, code: null });
    } else {
      write(key, { status: "done", detail, empty: false, code: null });
    }
  } catch (err) {
    write(key, {
      status: "error",
      detail: "",
      empty: false,
      // The enumerated kind, never the provider's own words: by the time this
      // runs the raw message does not exist, because the route refuses to put it
      // on the wire.
      code: typeof err?.code === "string" ? err.code : "http",
    });
  }
}

/** Test-only. Never called from application code. */
export function resetTechTermDetailStore() {
  records.clear();
  notify();
}
