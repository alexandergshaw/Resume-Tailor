"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { getProjectPool, listProjectPools } from "../../lib/supabase/applicationProjectPool";
import { runWithConcurrency } from "../../lib/tailor/runWithConcurrency";
import { isStalePending } from "../../lib/copilot/projectExampleSelect";
import { selectAutoProjectPoolTargets, AUTO_PROJECT_POOL_CONCURRENCY } from "../../lib/copilot/projectPoolPrewarm";
import { readEngine } from "../settings/engine";

// The lazy prewarm of the interview copilot's example-project pool: one pool of
// invented projects per tracked application, generated ahead of the interview so
// the copilot can pick from it instantly. Same shape as useApplicationDigests.js
// (read what is stored with the browser's own RLS-scoped client, then call the
// route only for the model work, which needs a server-side key), with two
// triggers instead of one:
//
//   PRIMARY, `applications` (page.js mounts it beside useApplicationDigests, so
//   the tracking table's rows are what it sees): the cost gate
//   selectAutoProjectPoolTargets decides which rows warm automatically. That
//   gate is a SPEND CONTROL, not a completeness filter -- it only auto-targets a
//   pool-less row tracked within AUTO_PROJECT_POOL_MAX_AGE_HOURS, so a
//   long-standing table does not fire a model call per untouched row. It reads
//   each row's `tracked_at`, which is why that column is carried through below:
//   a row that dropped it would silently lose the recency limit.
//
//   SECONDARY, `selectedApplicationId` (the copilot mounts it with the selected
//   posting's id): the one application the person has just chosen to interview
//   for is warmed DIRECTLY through the route, never through the age-limited
//   gate. That is what covers an older row the gate deliberately skipped, and
//   it is why this path carries its own small decision (shouldWarmSelected)
//   about whether a direct request is worth making for each stored state.
//
// A `ready` pool is never re-requested and a young `pending` one is another
// request genuinely generating. A `failed` pool is NOT retried by EITHER mount
// path: every copilot or practice mount would bill another call against the same
// stuck row, so a failed pool stays failed until someone explicitly asks again
// (regenerateOne, which no automatic path calls).
//
// SELF-HEAL, the one thing that can start a request AFTER mount. A pool that was
// missing or still being built when a question was answered comes back from the
// answer route as a `pending` Row 1; the copilot and practice hooks report each
// Row 1 status they see through `noteRowOneStatus`, and the first `pending` for
// an application with no request already in flight fires ONE prewarm, so the
// next question shows the example instead of "still being prepared" for the
// rest of the session. It fires once per cold EPISODE (until that application
// reports a status other than `pending`), never once per render or per question.
//

// `logEvent` is the copilot session log's recorder when the copilot supplies one.
// It is a no-op until a session has started, so a prewarm that settles before
// "Start" leaves nothing in the downloadable log; that is the accepted gap, and
// the tracking-tab mount passes none at all.

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// One POST to the prewarm route, shared by the auto fan-out, the selected-
// posting path and the explicit regenerate. Resolves with the stored pool row.
async function requestProjectPool(applicationId, { force = false } = {}) {
  const res = await fetch("/api/application-project-pool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId, engine: readEngine(), force }),
  });
  const json = await readJson(res);
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.pool;
}

// Whether a direct request for ONE application is worth making on selection,
// given the stored pool. A `false` spends nothing: the route would short-circuit
// ready and young-pending states anyway, so asking only costs a round trip and a
// slot in its rate limit. A FAILED pool is `false` for a different reason: the
// route would regenerate it only under `force`, and a mount is not an explicit
// request, so a stuck application would be re-billed on every visit.
function shouldWarmSelected(pool, now) {
  if (!pool) return true;
  if (pool.status === "ready" || pool.status === "failed") return false;
  if (pool.status === "pending") return isStalePending(pool, now);
  return true;
}

export function useApplicationProjectPool({ applications, selectedApplicationId, logEvent } = {}) {
  const [poolsById, setPoolsById] = useState({});
  const [prewarmingIds, setPrewarmingIds] = useState(() => new Set());
  const [userId, setUserId] = useState(null);
  // The id SET the primary path has already read-and-fired for, and the one id
  // the secondary path has: each runs exactly once per distinct value, not once
  // per render that happens to hand back a new array.
  const loadedKeyRef = useRef("");
  const selectedKeyRef = useRef("");

  const rows = useMemo(() => (Array.isArray(applications) ? applications : []), [applications]);
  const rowsKey = useMemo(() => rows.map((r) => r?.id).filter(Boolean).sort().join(","), [rows]);

  // Refs, not state, so the latest logger and the latest rows are readable from
  // the stable callbacks and the once-per-key effect below without making them
  // depend on identities that change far more often than their contents do.
  const logEventRef = useRef(logEvent);
  useEffect(() => {
    logEventRef.current = logEvent;
  }, [logEvent]);
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Best-effort end to end: a prewarm is a head start, never a requirement, so a
  // client that cannot be built or a session that cannot be read leaves the hook
  // inert (no user, nothing to warm) rather than throwing out of an effect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setUserId(data?.user?.id || null);
      } catch {
        if (!cancelled) setUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markPrewarming = useCallback((applicationId, on) => {
    setPrewarmingIds((prev) => {
      const has = prev.has(applicationId);
      if (on === has) return prev;
      const next = new Set(prev);
      if (on) next.add(applicationId);
      else next.delete(applicationId);
      return next;
    });
  }, []);

  // The SET of ids with a request in flight, checked synchronously before
  // anything else in runOne: React state would only ever show the closure from
  // the first render of a stable callback. Per id, so two applications still
  // warm concurrently; only a second call for the SAME id is a no-op.
  const inFlightIdsRef = useRef(new Set());

  // Shared by every trigger. The route records its own failures as an ordinary
  // 200 carrying a `failed` row; this catch covers only a request that never got
  // that far (offline, a 429, a 503 for the embedded engine). Its failure is
  // MERGED over whatever the id already held, never replacing it.
  const runOne = useCallback(
    async (applicationId, { force = false } = {}) => {
      if (!applicationId) return;
      // The embedded engine has no honest offline equivalent of an invented
      // project, and the route refuses it: asking would only spend a request.
      if (readEngine() === "embedded") return;
      if (inFlightIdsRef.current.has(applicationId)) return;
      inFlightIdsRef.current.add(applicationId);
      markPrewarming(applicationId, true);
      try {
        const pool = await requestProjectPool(applicationId, { force });
        if (pool) setPoolsById((prev) => ({ ...prev, [applicationId]: pool }));
        logPrewarm(logEventRef.current, applicationId, pool);
      } catch (err) {
        setPoolsById((prev) => ({
          ...prev,
          [applicationId]: {
            ...(prev[applicationId] || {}),
            application_id: applicationId,
            status: "failed",
            error: err?.message || "Example projects could not be prepared.",
          },
        }));
        logPrewarm(logEventRef.current, applicationId, null);
      } finally {
        markPrewarming(applicationId, false);
        inFlightIdsRef.current.delete(applicationId);
      }
    },
    [markPrewarming],
  );

  // The explicit retry: `force` is what lets a failed (or ready) pool be
  // regenerated, which no automatic path does.
  const regenerateOne = useCallback((applicationId) => runOne(applicationId, { force: true }), [runOne]);

  // PRIMARY. Read what is already stored, then -- only once poolsById reflects
  // reality -- decide what auto-populates, so the cost gate sees the real pools.
  useEffect(() => {
    if (!userId || !rowsKey || loadedKeyRef.current === rowsKey) return undefined;
    loadedKeyRef.current = rowsKey;
    let cancelled = false;
    const ids = rowsKey.split(",");
    // The gate reads only `id` and `tracked_at`; carrying `tracked_at` through
    // explicitly is what keeps its recency limit from silently vanishing.
    const gateRows = rowsRef.current.map((r) => ({ id: r?.id, tracked_at: r?.tracked_at }));

    (async () => {
      const supabase = createClient();
      const { pools } = await listProjectPools(supabase, userId, ids);
      if (cancelled || !pools) return;
      setPoolsById((prev) => ({ ...prev, ...pools }));

      const targets = selectAutoProjectPoolTargets(gateRows, pools, { now: new Date() });
      if (targets.length === 0 || cancelled) return;
      await runWithConcurrency(targets, AUTO_PROJECT_POOL_CONCURRENCY, (id) => runOne(id, { force: false }));
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on the id SET, not on `rows`' identity: this must fire once per
    // distinct rowsKey, and the rows themselves are read through `rowsRef`.
    // (`runOne` is stable.)
  }, [userId, rowsKey, runOne]);

  // SECONDARY. The selected posting, straight to the route -- not through the
  // age-limited gate -- so an older row the gate skipped still gets its pool.
  useEffect(() => {
    if (!userId || !selectedApplicationId || selectedKeyRef.current === selectedApplicationId) return undefined;
    // Nothing to warm for the embedded engine (see runOne); skipping here also
    // saves the stored-pool read.
    if (readEngine() === "embedded") return undefined;
    selectedKeyRef.current = selectedApplicationId;
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const { pool, error } = await getProjectPool(supabase, userId, selectedApplicationId);
      // A read that FAILED is not a miss: the route would be asked to generate
      // over a pool that may already exist.
      if (cancelled || error) return;
      if (pool) setPoolsById((prev) => ({ ...prev, [selectedApplicationId]: pool }));
      if (!shouldWarmSelected(pool, Date.now()) || cancelled) return;
      await runOne(selectedApplicationId, { force: false });
    })();

    return () => {
      cancelled = true;
    };
    // `runOne` is stable (its only dependency is a stable callback).
  }, [userId, selectedApplicationId, runOne]);

  // SELF-HEAL. The application ids whose current cold episode has already fired
  // its one request: added when a `pending` Row 1 starts a request, removed when
  // that application reports any other status, so a pool that went cold again
  // later in the session can heal again but a pool that stays cold cannot spam.
  const coldEpisodesRef = useRef(new Set());

  // Each producer of an answer (live draft, practice sample answer, room
  // question) reports the Row 1 status the answer carried, with the id of the
  // application it was drafted for. The producers hold this through a ref, so its
  // identity never matters to them. The embedded engine is skipped here for the
  // same reason runOne skips it, and so is an application whose request is
  // already on its way (the mount-time warm), which is not a cold pool anyone
  // needs to start again; neither starts an episode.
  const noteRowOneStatus = useCallback(
    (applicationId, status) => {
      if (!applicationId || typeof status !== "string") return;
      const episodes = coldEpisodesRef.current;
      if (status !== "pending") {
        episodes.delete(applicationId);
        return;
      }
      if (episodes.has(applicationId) || inFlightIdsRef.current.has(applicationId)) return;
      if (readEngine() === "embedded") return;
      episodes.add(applicationId);
      runOne(applicationId, { force: false });
    },
    [runOne],
  );

  return { poolsById, prewarmingIds, regenerateOne, noteRowOneStatus };
}

// One prewarm outcome for the copilot's session log: the application, the
// pool's status and how many projects it holds. Identity only -- no posting
// text, no project text, no person.
function logPrewarm(record, applicationId, pool) {
  if (typeof record !== "function") return;
  const count = Array.isArray(pool?.projects) ? pool.projects.length : 0;
  record("projectPool.prewarm", { applicationId, status: pool?.status || "failed", count });
}
