// N60 S7 (4b) -- AC-R4's PERSISTED half and AC-R5's own-rows read.
//
// The pure summariser (autoTailorRunLog.js) turns a run into a machine-readable
// outcome; THIS module is the durable I/O around it (plan S7: the prepLog/
// prepStore split, so only the pure ...Log.js module trips the feature-log
// sweep -- ...Store.js does not). It writes one row per user per run to
// `auto_tailor_runs` (design-structure.r1.md §4: RLS enabled, select-own, no
// write policy -- the cron writes it as service_role) and reads a user's own
// recent runs back.
//
// RED ON HEAD: lib/feed/autoTailorRunStore.js does not exist, so the import
// below fails collection. MEASURED: the S7-target-existence probe reported
// ABSENT.
//
// TWO PROPERTIES THIS MODULE MUST HAVE, both from the brief's failure directions:
//   1. LOGGING IS NOT A GATE. recordRun must NEVER throw and must NEVER surface
//      an error that could break the run or, worse, cause a re-tailor (double
//      spend). A DB error and a thrown insert both resolve to {ok:false}, not a
//      rejection. The route-level consequence (no double spend) is pinned in
//      route.runLog.test.js; this file pins the module's own fail-soft contract.
//   2. READS ARE OWN-ROWS. loadRecentRuns filters on user_id (belt-and-braces
//      with the table's select-own RLS) and, on any error or empty history,
//      returns [] so the surface renders "nothing yet" rather than an error.
//
// CONTROLS: every fail-soft assertion is paired with a success control, so a
// module that always returns {ok:false} (or always []) cannot pass vacuously.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../../test/helpers/supabaseMock.js";
import { recordRun, loadRecentRuns } from "./autoTailorRunStore.js";

// A run summary as summarizeRun produces it -- what recordRun must persist.
function summary(overrides = {}) {
  return {
    userId: "user-1",
    autoEligible: 2,
    autoProcessed: 2,
    tailored: 3,
    skipped: { already_tracked: 1 },
    emailEligible: 0,
    emailed: 0,
    autoFeatureError: null,
    emailFeatureError: null,
    zeroReason: null,
    emailZeroReason: null,
    ...overrides,
  };
}

// An admin whose insert throws (not just returns an error) -- the harshest
// fail-soft case. makeSupabase cannot express a throw, so this is hand-built.
function throwingAdmin() {
  return {
    from: () => ({
      insert: () => {
        throw new Error("connection reset");
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordRun persists one row to auto_tailor_runs", () => {
  it("inserts { user_id, payload } into auto_tailor_runs and returns ok:true", async () => {
    const admin = makeSupabase({ auto_tailor_runs: { insert: { error: null } } });
    const run = summary();
    const res = await recordRun(admin, run);

    expect(res.ok).toBe(true);
    // The right table, not another.
    expect(admin.from).toHaveBeenCalledWith("auto_tailor_runs");
    const inserted = admin.calls.auto_tailor_runs.insert[0][0];
    expect(inserted.user_id).toBe("user-1");
    // The whole summary is persisted as the payload, so the record is durable
    // (AC-R4 "persists per user ... for every run").
    expect(inserted.payload).toMatchObject({ tailored: 3, autoEligible: 2 });
  });

  it("persists WHY a run did nothing -- the zeroReason travels into the row", async () => {
    // AC-R4: "a run that queues nothing because no search is enabled is
    // distinguishable in that output". The distinguishing reason is only useful
    // if it becomes DURABLE here, not just returned in the HTTP response.
    const admin = makeSupabase({ auto_tailor_runs: { insert: { error: null } } });
    await recordRun(admin, summary({ tailored: 0, zeroReason: "no_search_enabled" }));
    const inserted = admin.calls.auto_tailor_runs.insert[0][0];
    expect(inserted.payload.zeroReason).toBe("no_search_enabled");
  });

  it("[fail-soft] a DB error is returned as ok:false, never thrown", async () => {
    const admin = makeSupabase({ auto_tailor_runs: { insert: { error: { message: "rls denied" } } } });
    // Must not reject: logging is not a gate.
    const res = await recordRun(admin, summary());
    expect(res.ok).toBe(false);
  });

  it("[fail-soft] a THROWN insert is caught and returned as ok:false, never rethrown", async () => {
    // The route wraps nothing around recordRun on the assumption it cannot
    // throw. A build that let this propagate would abort the user's run AFTER
    // the spend already happened -- the double-spend risk this contract exists
    // to remove.
    const res = await recordRun(throwingAdmin(), summary());
    expect(res.ok).toBe(false);
  });
});

describe("loadRecentRuns reads only the caller's own runs (AC-R5)", () => {
  const RUNS = [
    { id: "r2", ran_at: "2026-09-27T13:00:00Z", payload: summary({ tailored: 1 }) },
    { id: "r1", ran_at: "2026-09-27T12:00:00Z", payload: summary({ tailored: 0, zeroReason: "no_search_enabled" }) },
  ];

  it("filters on user_id, orders by ran_at desc, and returns the rows", async () => {
    const client = makeSupabase({ auto_tailor_runs: { data: RUNS } });
    const out = await loadRecentRuns(client, "user-1");

    expect(client.from).toHaveBeenCalledWith("auto_tailor_runs");
    // Own-rows: the query is scoped to this user (belt-and-braces with RLS).
    expect(client.calls.auto_tailor_runs.eq).toContainEqual(["user_id", "user-1"]);
    // Newest first.
    expect(client.calls.auto_tailor_runs.order[0][0]).toBe("ran_at");
    expect(client.calls.auto_tailor_runs.order[0][1]).toMatchObject({ ascending: false });
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("scopes to whatever user id it is given (non-vacuity for the filter)", async () => {
    const client = makeSupabase({ auto_tailor_runs: { data: [] } });
    await loadRecentRuns(client, "someone-else");
    expect(client.calls.auto_tailor_runs.eq).toContainEqual(["user_id", "someone-else"]);
    // And NOT the previous test's user.
    expect(client.calls.auto_tailor_runs.eq).not.toContainEqual(["user_id", "user-1"]);
  });

  it("returns [] on a query error -- 'nothing yet', not a throw or an error object", async () => {
    const client = makeSupabase({ auto_tailor_runs: { data: null, error: { message: "boom" } } });
    const out = await loadRecentRuns(client, "user-1");
    expect(out).toEqual([]);
  });

  it("returns [] for an empty history", async () => {
    const client = makeSupabase({ auto_tailor_runs: { data: [] } });
    expect(await loadRecentRuns(client, "user-1")).toEqual([]);
  });
});
