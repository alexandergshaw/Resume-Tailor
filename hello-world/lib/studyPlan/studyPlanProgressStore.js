// THE CLIENT-SIDE STUDY PLAN RECORD STORE. Module scope, bounded, in memory.
// Mirrors lib/copilot/techTermDetailStore.js: subscribe / getSnapshot for
// useSyncExternalStore, a per-key issue token against a superseded in-flight
// load, a bounded least-recently-used Map.
//
// WHAT IT IS FOR. The walkthrough reads the loaded plan record here, and a
// reveal or a grade is applied to the in-memory `progress` immediately
// (read-modify-render) while the durable write is handed to an injected writer.
// It does NOT own the walkthrough's reducer -- advancing the cursor to the next
// card, picking what is due -- it holds the record and applies exactly the one
// card it is told about.
//
// WHY INJECTED. The reader and the writer are passed in rather than imported,
// so this whole module is unit-testable with fakes and safe to bundle for the
// browser: the caller binds the reader to its own client and user, and the
// writer to the one progress write path. Nothing here knows how a record is
// stored.
//
// THE ONE-CARD RULE. recordProgress builds its delta with buildProgressDelta
// and refuses anything that is not exactly one seen entry before it touches
// state or the writer. The data layer re-asserts the same rule before its RPC;
// the check lives at BOTH boundaries on purpose, because a whole-map write is a
// silent two-device clobber with no local error.
//
// A FAILED PERSIST KEEPS THE OPTIMISTIC STATE. The card stays shown as done,
// the failure is surfaced (on the returned result AND on the record's `error`),
// and the next load reconciles the record from the database. Whether a failed
// write should visibly revert the card is a UX call left to the walkthrough;
// this store only reports it. The divergence is real until that reload -- the
// other device will not see the card -- which is why the error is kept on the
// record rather than dropped once the call returns.

import {
  buildProgressDelta,
  isSingleItemSeenDelta,
  normalizeKnobs,
  normalizePlan,
  normalizeProgress,
} from "./studyPlanSchema.js";

// A small bound: a learner works one plan at a time. Eviction is harmless, the
// next load re-reads the record from the database.
export const STUDY_PLAN_RECORD_STORE_MAX = 50;

const SAVE_FAILED = "Could not save your progress.";
const LOAD_FAILED = "Could not load the study plan.";

// What an application nothing has been asked about reads as. Not a crash, not
// null: a record with every data field empty and `loaded` false.
const IDLE = Object.freeze({
  status: null,
  plan: null,
  knobs: null,
  progress: null,
  cachedResearch: null,
  loading: false,
  loaded: false,
  error: null,
});

// applicationId -> { status, plan, knobs, progress, cachedResearch, loading, loaded, error }
const records = new Map();
const listeners = new Set();

// applicationId -> the latest load number. A settling load is accepted only
// from the holder of the current number, so a superseded in-flight load's late
// arrival is dropped instead of overwriting a newer record. The synchronous
// loading write is NOT guarded: immediate feedback is always wanted. Numbers
// only ever increase, so a stale issuer can never collide with a later one.
const issueToken = new Map();

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
  while (records.size > STUDY_PLAN_RECORD_STORE_MAX) {
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
 * The record for one application. Reading TOUCHES it, which makes the bound
 * least-recently-USED rather than first-in-first-out: the plan a learner keeps
 * coming back to is the one worth keeping.
 */
export function getStudyPlanRecord(applicationId) {
  return touch(applicationId) || IDLE;
}

// A reader's result as a settled record. Plan, knobs and progress run through
// the schema again so a reader that is not the data layer's own cannot hand the
// walkthrough a malformed shape (the normalizers are idempotent on a shape they
// already produced). A null stays null: "no plan built yet" is a state the
// walkthrough branches on, and it is not the same as an empty plan.
function settledRecord(result) {
  const src = result !== null && typeof result === "object" ? result : {};
  return {
    status: typeof src.status === "string" ? src.status : null,
    plan: src.plan == null ? null : normalizePlan(src.plan),
    knobs: src.knobs == null ? null : normalizeKnobs(src.knobs),
    progress: src.progress == null ? null : normalizeProgress(src.progress),
    cachedResearch: src.cachedResearch ?? null,
    loading: false,
    loaded: true,
    error: typeof src.error === "string" && src.error !== "" ? src.error : null,
  };
}

/**
 * Load one application's record into memory. `reader` is injected:
 * `() => Promise<result>` shaped like the data layer's readStudyPlan return.
 *
 * The loading record is written SYNCHRONOUSLY, before any await, so a mount gets
 * feedback in the same frame. A settle is accepted only from the latest load for
 * the key. A reader that throws, or a result that carries an error, still
 * settles the key (loaded, with the error) -- `loading` is never terminal.
 * Loading again is how a record is reconciled with the database, e.g. after a
 * failed persist.
 */
export async function loadStudyPlanRecord(applicationId, reader) {
  if (!applicationId || typeof reader !== "function") return;

  const token = (issueToken.get(applicationId) ?? 0) + 1;
  issueToken.set(applicationId, token);

  write(applicationId, { ...IDLE, loading: true });

  const settle = (record) => {
    if (issueToken.get(applicationId) !== token) return;
    write(applicationId, record);
  };

  try {
    settle(settledRecord(await reader()));
  } catch (err) {
    settle({
      ...IDLE,
      loaded: true,
      error: typeof err?.message === "string" && err.message !== "" ? err.message : LOAD_FAILED,
    });
  }
}

/**
 * Apply ONE reveal or grade and persist it.
 *
 * `card` is `{ moduleId, topicId, itemId, revealedAt, grade?, dueAt? }`; the
 * caller supplies `revealedAt` so the delta stays pure. `writer` is injected:
 * `({ cursor, seenDelta }) => Promise<{ written, error }>`, bound by the caller
 * to the one progress write path for this application.
 *
 * Order: build the delta, refuse anything that is not exactly one seen entry
 * (before any state change and before the writer -- a card with no usable
 * itemId yields an empty delta, which would otherwise write a key named
 * "undefined"), merge it into the in-memory progress and set the cursor, then
 * await the writer. A failed or refused write returns `{ written: false, error }`
 * and ALSO stamps the error on the record, keeping the optimistic state (see the
 * file header). Never throws.
 */
export async function recordProgress(applicationId, card, writer) {
  if (!applicationId) return { written: false, error: SAVE_FAILED };
  if (typeof writer !== "function") return { written: false, error: SAVE_FAILED };

  const { cursor, seenDelta } = buildProgressDelta(card);
  if (!isSingleItemSeenDelta(seenDelta)) {
    return { written: false, error: "Pick a card to save progress for." };
  }

  // The optimistic merge. A record that was never loaded gets none: there is no
  // progress to merge into, and the next load reads the database's answer
  // anyway. The write is still attempted -- the database is the authority on
  // whether this application has a plan to record into.
  const existing = records.get(applicationId);
  const token = issueToken.get(applicationId);
  if (existing) {
    const base = normalizeProgress(existing.progress);
    write(applicationId, {
      ...existing,
      progress: { ...base, cursor, seen: { ...base.seen, ...seenDelta } },
    });
  }

  let outcome;
  try {
    outcome = await writer({ cursor, seenDelta });
  } catch (err) {
    outcome = { written: false, error: err?.message };
  }
  if (outcome?.written === true) return { written: true, error: null };

  const error = typeof outcome?.error === "string" && outcome.error !== "" ? outcome.error : SAVE_FAILED;
  // Stamp the failure on the record unless a load has superseded it since: a
  // newer load owns the record now, and its answer is the database's.
  const current = records.get(applicationId);
  if (current && issueToken.get(applicationId) === token) write(applicationId, { ...current, error });
  return { written: false, error };
}

/** Test-only. Never called from application code. */
export function resetStudyPlanProgressStore() {
  records.clear();
  notify();
}
