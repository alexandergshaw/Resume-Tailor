// N143 seam 4 (T7). Falsifier for lib/copilot/projectPoolPrewarm.js — the cost
// gate that decides which applications the lazy prewarm fires for. RED at the
// import line until the module lands.
//
// CONTRACT (plan S6, design r2 §2.2): selectAutoProjectPoolTargets selects an
// application when it has NO pool row OR a 'pending' row older than
// POOL_PENDING_MAX_AGE (crash-recovery), and EXCLUDES 'ready', 'failed', and
// young 'pending'. The stale-pending arm is the R-I guard: without it a
// generation that crashed mid-run never retries and the card shows WARMING
// forever.
//
//   selectAutoProjectPoolTargets(applications, poolsById, { now }) -> applicationId[]
//   AUTO_PROJECT_POOL_CONCURRENCY exported
//
// POOL_PENDING_MAX_AGE is imported from the browser-safe selector module (its
// home — see projectExampleSelect.js), so the young/stale boundary is computed
// against the REAL constant rather than a copied literal.

import { describe, it, expect } from "vitest";
import {
  selectAutoProjectPoolTargets,
  AUTO_PROJECT_POOL_CONCURRENCY,
  AUTO_PROJECT_POOL_MAX_AGE_HOURS,
} from "./projectPoolPrewarm.js";
import { POOL_PENDING_MAX_AGE } from "./projectExampleSelect.js";
import { selectAutoDigestTargets } from "../tracking/applicationDigest.js";

const AT = Date.parse("2026-10-08T00:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

const apps = (ids) => ids.map((id) => ({ id }));
// A row tracked an hour before AT: inside the recency limit, with a READABLE
// timestamp. Rows without one are no longer targets (see the ruled block below),
// so a fixture that must be targeted has to carry it.
const recentApp = (id) => ({ id, tracked_at: iso(AT - 3600000) });

describe("selectAutoProjectPoolTargets — no-row and stale-pending select; ready/failed/young-pending excluded", () => {
  // RULED TEST CHANGE (N143 fix round F1, M3). This control used to select
  // `apps(["a"])` -- a row with NO tracked_at -- and expect it to be targeted.
  // That pinned the stampede defect: a pool-less row with no readable timestamp
  // was auto-targeted, where selectAutoDigestTargets (the gate this one mirrors)
  // excludes it. The fixture now carries a readable recent timestamp, and the
  // missing-timestamp behaviour has its own cases in the block below.
  it("[positive control] selects a recently tracked application that has no pool row", () => {
    const targets = selectAutoProjectPoolTargets([recentApp("a")], {}, { now: AT });
    expect(targets).toEqual(["a"]);
  });

  it("excludes a ready pool row", () => {
    const targets = selectAutoProjectPoolTargets(
      apps(["a"]),
      { a: { status: "ready", updated_at: iso(AT) } },
      { now: AT },
    );
    expect(targets).toEqual([]);
  });

  it("excludes a failed pool row (no auto-retry — that is the Try again button's job)", () => {
    const targets = selectAutoProjectPoolTargets(
      apps(["a"]),
      { a: { status: "failed", updated_at: iso(AT) } },
      { now: AT },
    );
    expect(targets).toEqual([]);
  });

  it("excludes a YOUNG pending row (another request is genuinely in flight)", () => {
    const targets = selectAutoProjectPoolTargets(
      apps(["a"]),
      { a: { status: "pending", updated_at: iso(AT) } },
      { now: AT + (POOL_PENDING_MAX_AGE - 1000) },
    );
    expect(targets).toEqual([]);
  });

  it("[mutation control] selects a STALE pending row for retry (crash recovery, R-I)", () => {
    // A gate that excludes stale-pending from retry reds here — the exact
    // named silent failure.
    const targets = selectAutoProjectPoolTargets(
      apps(["a"]),
      { a: { status: "pending", updated_at: iso(AT) } },
      { now: AT + (POOL_PENDING_MAX_AGE + 1000) },
    );
    expect(targets).toEqual(["a"]);
  });

  it("mixes the four cases in one call and returns only the eligible ids", () => {
    const poolsById = {
      ready: { status: "ready", updated_at: iso(AT) },
      failed: { status: "failed", updated_at: iso(AT) },
      young: { status: "pending", updated_at: iso(AT) },
      stale: { status: "pending", updated_at: iso(AT - (POOL_PENDING_MAX_AGE + 5000)) },
      // "missing" has no entry at all; "legacy" has none either and no tracked_at
    };
    const targets = selectAutoProjectPoolTargets(
      [...apps(["ready", "failed", "young", "stale", "legacy"]), recentApp("missing")],
      poolsById,
      { now: AT },
    );
    // RULED TEST CHANGE (M3): "missing" used to carry no tracked_at and be
    // expected here, which is the bug. It carries one now; "legacy" is the row
    // that is correctly left out.
    expect(new Set(targets)).toEqual(new Set(["stale", "missing"]));
  });

  it("tolerates a non-array applications / absent clock without throwing", () => {
    expect(selectAutoProjectPoolTargets(null, {}, { now: AT })).toEqual([]);
    expect(() => selectAutoProjectPoolTargets(apps(["a"]), {}, {})).not.toThrow();
  });

  it("exposes a concurrency bound", () => {
    expect(typeof AUTO_PROJECT_POOL_CONCURRENCY).toBe("number");
    expect(AUTO_PROJECT_POOL_CONCURRENCY).toBeGreaterThanOrEqual(1);
  });
});

// The recency limit — the spend control that stops a first load on a
// long-standing tracking table from generating a pool for every pool-less row.
// It mirrors selectAutoDigestTargets' AUTO_DIGEST_MAX_AGE_HOURS limit: only a
// recently tracked application with no pool auto-targets; an older one is warmed
// lazily (the copilot asking for the one selected application, or force), never
// auto-backfilled. The fixtures in the first block mostly carry no tracked_at
// (they exercise the pool-row arms), so this block and the missing-timestamp
// block after it are what pin the cap.
describe("selectAutoProjectPoolTargets — the recency limit (auto-population is a spend control)", () => {
  const HOUR = 3600000;
  const tracked = (id, ageHours) => ({ id, tracked_at: iso(AT - ageHours * HOUR) });

  it("[positive control] a recently tracked row with no pool IS auto-targeted", () => {
    expect(selectAutoProjectPoolTargets([tracked("new", 1)], {}, { now: AT })).toEqual(["new"]);
  });

  it("[mutation control] a long-standing row with no pool is NOT auto-targeted", () => {
    // A gate with no recency limit reds here: this is the stampede a first load
    // on a backlog table would otherwise start.
    const thirtyDays = 30 * 24;
    expect(selectAutoProjectPoolTargets([tracked("old", thirtyDays)], {}, { now: AT })).toEqual([]);
  });

  it("draws the line at AUTO_PROJECT_POOL_MAX_AGE_HOURS (inclusive of the limit itself)", () => {
    const targets = selectAutoProjectPoolTargets(
      [
        tracked("at-the-limit", AUTO_PROJECT_POOL_MAX_AGE_HOURS),
        tracked("just-past", AUTO_PROJECT_POOL_MAX_AGE_HOURS + 1),
      ],
      {},
      { now: AT },
    );
    expect(targets).toEqual(["at-the-limit"]);
  });

  it("does not target a row tracked in the future (a clock or data fault, not a new row)", () => {
    expect(selectAutoProjectPoolTargets([tracked("future", -5)], {}, { now: AT })).toEqual([]);
  });

  it("returns the newest-tracked row first, like the digest gate", () => {
    const targets = selectAutoProjectPoolTargets(
      [tracked("middle", 10), tracked("oldest", 20), tracked("newest", 2)],
      {},
      { now: AT },
    );
    expect(targets).toEqual(["newest", "middle", "oldest"]);
  });

  it("applies the limit only to rows with no pool: ready and failed stay excluded however new", () => {
    const poolsById = {
      ready: { status: "ready", updated_at: iso(AT) },
      failed: { status: "failed", updated_at: iso(AT) },
    };
    const targets = selectAutoProjectPoolTargets(
      [tracked("ready", 1), tracked("failed", 1), tracked("fresh", 1)],
      poolsById,
      { now: AT },
    );
    expect(targets).toEqual(["fresh"]);
  });

  it("does not age out crash recovery: a stale pending row on an old application is still retried", () => {
    // A pending row means a generation was deliberately started (copilot open or
    // Try again), so recovering it is not a backfill and the recency limit must
    // not strand it in WARMING-then-FAILED forever.
    const poolsById = { old: { status: "pending", updated_at: iso(AT - (POOL_PENDING_MAX_AGE + 5000)) } };
    const targets = selectAutoProjectPoolTargets([tracked("old", 30 * 24)], poolsById, { now: AT });
    expect(targets).toEqual(["old"]);
  });
});

// RULED (N143 fix round F1, M3). A pool-less row whose `tracked_at` is missing
// or unreadable is NOT a target. The first version of this gate skipped the age
// check when the timestamp could not be parsed, so such a row was targeted
// unconditionally: on a legacy table whose rows predate the column, sixty rows
// meant sixty model calls on one load, where selectAutoDigestTargets -- the gate
// this one mirrors -- targets none of them. These cases pin the digest's
// behaviour, and the first test measures the two gates against each other so a
// change to either one cannot drift them apart unnoticed.
describe("selectAutoProjectPoolTargets — a pool-less row with no readable tracked_at is excluded (digest parity)", () => {
  const HOUR = 3600000;
  const dated = (id, ageHours) => ({ id, tracked_at: iso(AT - ageHours * HOUR) });
  const UNREADABLE = [
    ["absent", {}],
    ["null", { tracked_at: null }],
    ["undefined", { tracked_at: undefined }],
    ["empty string", { tracked_at: "" }],
    ["garbage string", { tracked_at: "whenever" }],
    ["a non-date object", { tracked_at: { not: "a date" } }],
  ];

  it("[positive control] a recent, readable tracked_at IS targeted, so the exclusions below are not a dead gate", () => {
    expect(selectAutoProjectPoolTargets([dated("recent", 1)], {}, { now: AT })).toEqual(["recent"]);
  });

  it.each(UNREADABLE)("excludes a pool-less row whose tracked_at is %s", (_label, extra) => {
    expect(selectAutoProjectPoolTargets([{ id: "legacy", ...extra }], {}, { now: AT })).toEqual([]);
  });

  it("the stampede, measured: sixty legacy rows with no tracked_at yield zero targets", () => {
    const legacy = Array.from({ length: 60 }, (_, i) => ({ id: `legacy-${i}` }));
    expect(selectAutoProjectPoolTargets(legacy, {}, { now: AT })).toEqual([]);
  });

  it("agrees with selectAutoDigestTargets row for row, in the same order", () => {
    const rows = [
      dated("ten-hours", 10),
      dated("one-hour", 1),
      dated("thirty-hours", 30),
      dated("future", -5),
      { id: "no-date" },
      { id: "bad-date", tracked_at: "whenever" },
      { id: "null-date", tracked_at: null },
    ];
    const digest = selectAutoDigestTargets(rows, {}, { now: AT });
    const pool = selectAutoProjectPoolTargets(rows, {}, { now: AT });
    // Canary: the digest gate selected something, so equality is not two empties.
    expect(digest).toEqual(["one-hour", "ten-hours"]);
    expect(pool).toEqual(digest);
  });

  it("the exclusion covers only pool-less rows: a stale pending row with no tracked_at is still retried", () => {
    // Crash recovery reads the POOL row's updated_at, and the generation it
    // recovers was deliberately started; the application's own timestamp is not
    // its evidence.
    const poolsById = { stuck: { status: "pending", updated_at: iso(AT - (POOL_PENDING_MAX_AGE + 5000)) } };
    expect(selectAutoProjectPoolTargets([{ id: "stuck" }], poolsById, { now: AT })).toEqual(["stuck"]);
  });

  it("a ready or failed row stays excluded whatever its tracked_at", () => {
    const poolsById = { r: { status: "ready", updated_at: iso(AT) }, f: { status: "failed", updated_at: iso(AT) } };
    expect(selectAutoProjectPoolTargets([dated("r", 1), dated("f", 1)], poolsById, { now: AT })).toEqual([]);
  });
});
