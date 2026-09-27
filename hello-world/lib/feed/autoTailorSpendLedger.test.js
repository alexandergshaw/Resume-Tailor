// N60 S4 -- AC-S1: a per-user, per-UTC-day ceiling on unattended paid
// generations, enforced by a DURABLE, ATOMIC counter.
//
// OWNER RULING THAT DEFINES THIS FILE (2026-09-20, supersedes plan.r1 6.4):
// the plan's readDaySpend/recordDaySpend read-modify-write with a bulk
// increment at the end was ruled UNSOUND. The contract these tests pin is:
//
//   * ONE atomic conditional increment PER POSTING, evaluated BEFORE each
//     tailor -- the module delegates the cap decision to a single server-side
//     `reserve_auto_tailor_slot` rpc and NEVER reads-then-writes.
//   * Two overlapping cron runs cannot both spend against one read count.
//   * A run that dies AFTER tailoring but before any "record" step cannot let
//     the next run spend past the ceiling, because the increment is durable at
//     RESERVE time -- there is no deferred record step to skip.
//   * REFUSE WHEN IT CANNOT COUNT: an unreadable counter refuses, and that
//     refusal is DISTINGUISHABLE from an idle count of 0 (a broken column that
//     reads as 0 must not be indistinguishable from a genuinely-empty day --
//     the M5 defect a previous seat proved).
//   * The day key is a UTC day, from getUTC* only.
//
// CONTRACT (supersedes plan 6.4's readDaySpend/recordDaySpend):
//   reserveDailyTailor(admin, userId, { cap, now }) ->
//     { ok:true,  reserved:true,  usedToday:n }                       (n <= cap)
//     { ok:true,  reserved:false, reason:"per_day_ceiling_reached", usedToday:n }
//     { ok:false, reason:"counter_unreadable" }                       (rpc errored)
//
// WHAT IS NOT PROVEN HERE, stated plainly: that Postgres serialises the reserve
// statement. PGlite is not installed in this checkout, so no migration or rpc
// is executed. This file proves the APPLICATION CODE uses a single atomic
// operation; n60SpendLedgerMigrationShape.test.js is the separate witness that
// the rpc it calls is itself cap-guarded.

import { describe, it, expect } from "vitest";
import { makeAtomicLedgerFake } from "@/test/helpers/atomicLedgerFake.js";

const USER = "11111111-1111-1111-1111-111111111111";

// Loaded lazily so an absent module is a real collection failure (RED for the
// right reason), not a silently-skipped file.
let mod = null;
let loadErr = null;
async function load() {
  if (mod || loadErr) return mod;
  try {
    mod = await import("./autoTailorSpendLedger.js");
  } catch (err) {
    loadErr = err;
  }
  return mod;
}
async function reserve(admin, userId, o) {
  const m = await load();
  if (!m?.reserveDailyTailor) {
    throw new Error(`reserveDailyTailor unavailable: ${loadErr?.message || "not exported"}`);
  }
  return m.reserveDailyTailor(admin, userId, o);
}

function at(iso) {
  const d = new Date(iso);
  return () => d;
}

describe("reserveDailyTailor -- the cap boundary (permit + refuse, paired)", () => {
  it("PERMITS when the day count is below the cap, returning the post-increment count", async () => {
    const { admin, store, autoKey } = makeAtomicLedgerFake();
    store.autoTailor.set(autoKey(USER, "2026-09-27"), 19);
    const r = await reserve(admin, USER, { cap: 20, now: at("2026-09-27T12:00:00.000Z") });
    expect(r).toEqual({ ok: true, reserved: true, usedToday: 20 });
    // durable: the shared store advanced.
    expect(store.autoTailor.get(autoKey(USER, "2026-09-27"))).toBe(20);
  });

  it("REFUSES at the cap with a distinct reason, and does NOT advance the counter", async () => {
    const { admin, store, autoKey } = makeAtomicLedgerFake();
    store.autoTailor.set(autoKey(USER, "2026-09-27"), 20);
    const r = await reserve(admin, USER, { cap: 20, now: at("2026-09-27T12:00:00.000Z") });
    expect(r.ok).toBe(true);
    expect(r.reserved).toBe(false);
    expect(r.reason).toBe("per_day_ceiling_reached");
    expect(store.autoTailor.get(autoKey(USER, "2026-09-27"))).toBe(20);
  });

  it("PERMITS an idle day (count 0) -- the control that keeps 'refuses everything' from passing", async () => {
    const { admin } = makeAtomicLedgerFake();
    const r = await reserve(admin, USER, { cap: 20, now: at("2026-09-27T00:00:00.000Z") });
    expect(r).toEqual({ ok: true, reserved: true, usedToday: 1 });
  });
});

describe("reserveDailyTailor -- REFUSE WHEN IT CANNOT COUNT (broken != idle)", () => {
  it("returns counter_unreadable on an rpc error -- NOT reserved:true, and NOT a guessed usedToday:0", async () => {
    const { admin } = makeAtomicLedgerFake({ failRpc: new Set(["reserve_auto_tailor_slot"]) });
    const r = await reserve(admin, USER, { cap: 20, now: at("2026-09-27T12:00:00.000Z") });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("counter_unreadable");
    // The load-bearing distinction: a broken counter must not look like an
    // idle one. An idle counter (previous test) returned reserved:true; a
    // broken counter must NOT.
    expect(r.reserved).not.toBe(true);
  });

  it("a broken counter and an idle counter are distinguishable outcomes", async () => {
    const idle = await reserve(makeAtomicLedgerFake().admin, USER, {
      cap: 20,
      now: at("2026-09-27T12:00:00.000Z"),
    });
    const broken = await reserve(
      makeAtomicLedgerFake({ failRpc: new Set(["reserve_auto_tailor_slot"]) }).admin,
      USER,
      { cap: 20, now: at("2026-09-27T12:00:00.000Z") },
    );
    expect(idle).not.toEqual(broken);
    expect(idle.ok).toBe(true);
    expect(broken.ok).toBe(false);
  });
});

describe("reserveDailyTailor -- it is ATOMIC, not read-modify-write", () => {
  it("issues exactly ONE db operation per reserve, and it is the atomic rpc (never select+write)", async () => {
    const { admin, calls } = makeAtomicLedgerFake();
    await reserve(admin, USER, { cap: 20, now: at("2026-09-27T12:00:00.000Z") });
    expect(calls).toHaveLength(1);
    expect(calls[0].verb).toBe("rpc");
    expect(calls[0].fn).toBe("reserve_auto_tailor_slot");
    // A read-modify-write build would show a 'select' followed by an
    // 'upsert'/'update'/'insert' -- two calls, the second depending on the
    // first's value. That shape is the double-spend defect and must not exist.
    expect(calls.some((c) => c.verb === "select")).toBe(false);
    expect(calls.some((c) => c.verb === "upsert")).toBe(false);
  });

  it("passes the cap and the UTC day into the single atomic call, not a client-side comparison", async () => {
    const { admin, calls } = makeAtomicLedgerFake();
    await reserve(admin, USER, { cap: 7, now: at("2026-09-27T12:00:00.000Z") });
    expect(calls[0].args).toMatchObject({ p_user_id: USER, p_day: "2026-09-27", p_cap: 7 });
  });
});

describe("reserveDailyTailor -- two overlapping runs share one count (genuine interleave)", () => {
  it("total reservations never exceed the cap when two runs race the same user/day", async () => {
    const CAP = 3;
    const { admin, store, autoKey } = makeAtomicLedgerFake();
    const now = at("2026-09-27T12:00:00.000Z");

    // Each "run" is a separate cron invocation trying to reserve CAP postings.
    // Two of them run concurrently against ONE shared counter. Real promise
    // interleaving via Promise.all -- both loops are in flight at once.
    async function run() {
      const outcomes = [];
      for (let i = 0; i < CAP; i += 1) {
        outcomes.push(await reserve(admin, USER, { cap: CAP, now }));
      }
      return outcomes;
    }
    const [a, b] = await Promise.all([run(), run()]);
    const all = [...a, ...b];

    const reserved = all.filter((r) => r.ok && r.reserved).length;
    const refused = all.filter((r) => r.ok && !r.reserved).length;

    // Non-vacuity: both runs really executed and together ATTEMPTED more than
    // the cap. A test where only one run ran, or where fewer than 2*CAP
    // attempts happened, is the trap the brief names.
    expect(all).toHaveLength(2 * CAP);
    expect(2 * CAP).toBeGreaterThan(CAP);
    // The property: the shared ceiling held. No more than CAP succeeded.
    expect(reserved).toBe(CAP);
    expect(refused).toBe(CAP);
    // And the durable store agrees -- never overshot.
    expect(store.autoTailor.get(autoKey(USER, "2026-09-27"))).toBe(CAP);
  });
});

describe("reserveDailyTailor -- crash after tailoring cannot re-open the ceiling", () => {
  it("reservations are durable at reserve time, so a run that dies mid-flight does not free slots", async () => {
    const CAP = 2;
    const { admin, store, autoKey } = makeAtomicLedgerFake();
    const now = at("2026-09-27T12:00:00.000Z");

    // Run 1 reserves both slots, then "crashes" -- it never reaches any record
    // or commit step (there is none; that is the point). The increments it
    // already made are durable in the shared store.
    const r1a = await reserve(admin, USER, { cap: CAP, now });
    const r1b = await reserve(admin, USER, { cap: CAP, now });
    expect(r1a.reserved).toBe(true);
    expect(r1b.reserved).toBe(true);
    // Simulate the crash: nothing else happens for run 1. No cleanup, no
    // deferred bulk-record. If the design deferred recording to the end of the
    // run, this crash would lose the count and run 2 below would over-spend.

    // Run 2 (the next cron invocation) now tries to reserve a NEW posting.
    const r2 = await reserve(admin, USER, { cap: CAP, now });
    expect(r2.ok).toBe(true);
    expect(r2.reserved).toBe(false);
    expect(r2.reason).toBe("per_day_ceiling_reached");
    expect(store.autoTailor.get(autoKey(USER, "2026-09-27"))).toBe(CAP);
  });
});

describe("reserveDailyTailor -- UTC-day boundary", () => {
  it("a reservation at 23:59:59.999Z counts against that UTC day, not the next", async () => {
    const { admin, calls } = makeAtomicLedgerFake();
    await reserve(admin, USER, { cap: 20, now: at("2026-09-27T23:59:59.999Z") });
    expect(calls[0].args.p_day).toBe("2026-09-27");
  });

  it("a reservation at 00:00:00.000Z the next day starts a fresh count", async () => {
    const { admin, store, autoKey } = makeAtomicLedgerFake();
    // Fill 2026-09-27 to the cap.
    store.autoTailor.set(autoKey(USER, "2026-09-27"), 20);
    const late = await reserve(admin, USER, { cap: 20, now: at("2026-09-27T23:59:59.999Z") });
    expect(late.reserved).toBe(false);
    // One millisecond later, in UTC, is a new day with a fresh (zero) counter.
    const fresh = await reserve(admin, USER, { cap: 20, now: at("2026-09-28T00:00:00.000Z") });
    expect(fresh.reserved).toBe(true);
    expect(fresh.usedToday).toBe(1);
    expect(store.autoTailor.get(autoKey(USER, "2026-09-28"))).toBe(1);
  });

  it("derives the day from getUTC* -- a local-time boundary would put this timestamp on a different day", async () => {
    // 2026-09-27T23:30:00Z is still the 27th in UTC. A local-time (e.g. UTC+2)
    // implementation would call it the 28th. Pin UTC.
    const { admin, calls } = makeAtomicLedgerFake();
    await reserve(admin, USER, { cap: 20, now: at("2026-09-27T23:30:00.000Z") });
    expect(calls[0].args.p_day).toBe("2026-09-27");
  });
});
