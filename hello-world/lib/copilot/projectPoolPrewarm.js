// The cost gate for the example-project pool's lazy prewarm: which tracked
// applications get a pool generated automatically when the tracking table
// mounts. Pure and synchronous, so the one decision that bounds spend is
// unit-testable without a network or a clock mock beyond passing `now`. It
// mirrors selectAutoDigestTargets in lib/tracking/applicationDigest.js,
// including that function's recency limit, with one difference that is
// load-bearing (the pending row, below).
//
// AUTO-POPULATION IS A SPEND CONTROL, NOT A COMPLETENESS FILTER. One generation
// per application, and only for an application with no pool row that was tracked
// within AUTO_PROJECT_POOL_MAX_AGE_HOURS of `now`. A user opening a long-standing
// tracking table with sixty untouched rows must not fire sixty model calls, so
// an older pool-less row is NOT auto-backfilled here. It is warmed lazily
// instead: the copilot asks for the one application the user selects, and the
// "Try again" / regenerate control sends `force`, both straight to the route and
// never through this gate.
//
// A 'ready' row is done; a 'failed' row is NOT retried here -- every page load
// would otherwise burn another model call on the same stuck row with nothing
// changing on screen, and retrying a failure is what the explicit control is for.
//
// THE DIFFERENCE FROM THE DIGEST: a 'pending' row. The digest route writes its
// row only when the call finishes, so a crashed digest leaves no row and is
// retried by being "no row". The pool route writes a timestamped 'pending' row
// BEFORE it calls the model (so the answer route can tell warming from failed),
// which means a generation that crashed mid-run leaves a pending row that would
// otherwise exclude its application forever. A pending row is therefore a target
// once it has outlived POOL_PENDING_MAX_AGE (isStalePending -- the same
// predicate the answer route uses to read that row as failed), and a younger
// one is excluded because another request is genuinely generating. That is crash
// recovery for a generation someone already started, not a backfill, so the
// recency limit does not apply to it.

import { isStalePending } from "./projectExampleSelect.js";

// A pool-less row auto-populates only if it was tracked within this many hours
// of the load that noticed it has no pool yet. Chosen to cover "just tracked
// this", not to backfill a long-standing table, exactly as the digest's own
// AUTO_DIGEST_MAX_AGE_HOURS; named and exported so it is tuned on its own
// rather than coupled to the digest's.
export const AUTO_PROJECT_POOL_MAX_AGE_HOURS = 24;

// How many pools are generated at once (through lib/tailor/runWithConcurrency).
// Small on purpose: this is a background fan-out the user did not ask for
// directly, so it should never be the thing saturating the model API. The same
// bound the digest prewarm uses.
export const AUTO_PROJECT_POOL_CONCURRENCY = 2;

const MS_PER_HOUR = 3600000;

// The application ids to prewarm, newest-tracked first. `now` is a Date or epoch
// milliseconds; an absent or unreadable clock falls back to the real one.
//
// The recency limit reads the application's `tracked_at`, and a pool-less row
// with no READABLE `tracked_at` is EXCLUDED, exactly as selectAutoDigestTargets
// excludes it. A row that cannot be shown to be recent cannot be shown to be
// worth a model call, and treating it as eligible is the stampede this gate
// exists to prevent: a legacy tracking table whose rows predate the column (or
// a caller that dropped it) would otherwise target every pool-less row at once.
// Measured against the digest gate on 60 such rows: 60 targeted here, 0 there.
// Every caller that feeds this the tracking table's rows supplies the column,
// which is why the recency cases in projectPoolPrewarm.test.js pin it.
//
// The stale-pending arm does NOT read `tracked_at`. Its evidence is the pool
// row's own `updated_at` (isStalePending), and the generation it recovers was
// deliberately started, so a missing application timestamp is no reason to
// strand it in a pending state it will never leave.
export function selectAutoProjectPoolTargets(applications, poolsById, { now } = {}) {
  const list = Array.isArray(applications) ? applications : [];
  const pools = poolsById && typeof poolsById === "object" ? poolsById : {};
  const given = now instanceof Date ? now.getTime() : now;
  const clock = Number.isFinite(given) ? given : Date.now();

  const candidates = [];
  for (const application of list) {
    if (!application || application.id === undefined || application.id === null) continue;
    const trackedMs = Date.parse(application.tracked_at);
    const pool = pools[application.id];

    if (!pool) {
      if (!Number.isFinite(trackedMs)) continue;
      const ageHours = (clock - trackedMs) / MS_PER_HOUR;
      if (ageHours < 0 || ageHours > AUTO_PROJECT_POOL_MAX_AGE_HOURS) continue;
    } else if (!isStalePending(pool, clock)) {
      // ready and failed rows, and a young pending one, are excluded.
      continue;
    }

    candidates.push({ id: application.id, trackedMs: Number.isFinite(trackedMs) ? trackedMs : -Infinity });
  }

  // Array.prototype.sort is stable, so a stale-pending row with no readable
  // application timestamp keeps its arrival order, after every dated row. (The
  // explicit equality arm is what keeps two -Infinity stamps from subtracting
  // to NaN.)
  candidates.sort((a, b) => (a.trackedMs === b.trackedMs ? 0 : b.trackedMs - a.trackedMs));
  return candidates.map((c) => c.id);
}
