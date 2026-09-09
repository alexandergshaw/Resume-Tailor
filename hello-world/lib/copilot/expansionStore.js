// THE CLIENT-SIDE EXPANSION CONTENT STORE. Module scope, bounded, in memory,
// and never persisted anywhere.
//
// WHY MODULE SCOPE AND NOT A HOOK OR A REF, measured rather than assumed.
// TranscriptDisclosure returns a `<Stack>` when a session is not live and a
// bare fragment when it is: a DIFFERENT ELEMENT TYPE AT THE SAME POSITION, so
// starting or stopping a live session unmounts that whole subtree and destroys
// every QuestionFeed/QuestionCard hook state under it. A hook-owned map would
// silently re-buy up to six paid model calls on a tab flick. Nothing in this
// feature may hold expansion content in a component or a component's ref.
//
// WHY CONTENT AND OPEN STATE ARE SEPARATE. Content lives here, shared across
// surfaces, keyed on TEXT. "Which panels are open" is per surface and lives in
// useAnswerExpansions. That split is what makes collapsing a panel while its
// request is in flight legal and NOT a cancel: the response completes and
// writes its record, and because writing a record does not set `open`, it
// cannot reopen a panel the reader closed. It is also what makes the same
// (question, bullet) unable to show two different TEXTS in two surfaces at
// once, without any coordination mechanism.
//
// THE KEY IS THE GENERATION GUARD. Keys carry the normalised parent sentence
// (expansionContract.js), so a response settling under a key the UI no longer
// computes is simply never read: no cancellation, no token, no bookkeeping.
//
// NOTHING HERE IS PERSISTED. The payload derives from material the client is
// deliberately never given, so writing it to browser storage would put
// submitted-document text on a shared machine's disk under a key nothing
// expires.

// Matching answerContextCache's own `maxEntries`, a number with a precedent in
// this repo rather than a guess. Eviction is harmless: the next click
// re-fetches, and the panel renders collapsed rather than stale.
export const EXPANSION_STORE_MAX = 200;

const IDLE = Object.freeze({ status: "idle", subBullets: [], caption: "", empty: false, code: null });

// key -> { status, subBullets, caption, empty, code }
const records = new Map();
const listeners = new Set();

// useSyncExternalStore requires getSnapshot to return the SAME reference when
// nothing has changed; one that allocates re-renders forever. The repo records
// the same trap in roleDrillStore.js, and this is the same fix: a counter that
// only moves on a write, and a memoised object built from it.
let version = 0;
let snapshot = { version: 0 };

function notify() {
  version += 1;
  snapshot = { version };
  for (const listener of [...listeners]) listener();
}

function touch(key) {
  // Re-insertion is what makes a plain Map an LRU: JS Maps iterate in
  // insertion order, so deleting and re-setting moves an entry to the back and
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
  while (records.size > EXPANSION_STORE_MAX) {
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
 * The record for one key. Reading TOUCHES it, which is what makes the bound
 * least-recently-USED rather than first-in-first-out: the expansion a reader
 * keeps reopening is the one worth keeping.
 */
export function getExpansion(key) {
  return touch(key) || IDLE;
}

/**
 * Ask for one expansion.
 *
 * DEDUPE, NEVER CANCEL, NEVER QUEUE. A second click while a request is in
 * flight means "I still want this"; queueing a second request doubles the
 * spend for a byte-identical result. A key that already holds a settled record
 * issues nothing at all, which is what makes collapse-then-reopen free.
 *
 * `retry: true` is the ONE way to re-issue a request for a key that already
 * settled, and it only applies to a failure. Retrying an honest empty spends
 * money to be told the same thing.
 *
 * `loading` is never terminal: every path below settles the key, including the
 * one where the fetcher throws something shapeless.
 */
export async function beginExpansion({ key, request } = {}, fetcher, { retry = false } = {}) {
  if (!key || typeof fetcher !== "function") return;

  // THE LOADING RECORD IS THE IN-FLIGHT GUARD. There is deliberately no second
  // `Set` of keys being fetched: because the loading record below is written
  // SYNCHRONOUSLY, before any await, every later call for the same key finds
  // it here and returns. A separate in-flight set could never be observed to
  // do anything this line does not already do, and a guard no test can kill is
  // a guard nobody can trust.
  const existing = records.get(key);
  if (existing && !(retry && existing.status === "error")) return;

  // SYNCHRONOUS, before any await. The reader gets feedback in the same frame
  // as the click, and no network or engine work stands in front of it.
  write(key, { status: "loading", subBullets: [], caption: "", empty: false, code: null });

  try {
    const result = await fetcher(request);
    const subBullets = Array.isArray(result?.subBullets) ? result.subBullets : [];
    if (subBullets.length === 0) {
      write(key, { status: "empty", subBullets: [], caption: "", empty: true, code: null });
    } else {
      write(key, {
        status: "done",
        subBullets,
        caption: typeof result?.caption === "string" ? result.caption : "",
        empty: false,
        code: null,
      });
    }
  } catch (err) {
    write(key, {
      status: "error",
      subBullets: [],
      caption: "",
      empty: false,
      // The enumerated kind, never the provider's own words: by the time this
      // runs, the raw message does not exist, because the route refuses to put
      // it on the wire.
      code: typeof err?.code === "string" ? err.code : "http",
    });
  }
}

/** Test-only. Never called from application code. */
export function resetExpansionStore() {
  records.clear();
  notify();
}
