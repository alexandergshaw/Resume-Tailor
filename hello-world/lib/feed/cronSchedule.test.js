// N60 SECOND CHUNK, Step A (4b) -- the cadence CONTRACT the first chunk left
// unbuilt (ac.chat.r1.md 0.2 / AC2-C4a). "frequency" -- the owner's own second
// word -- has no exported clamp, no describe helper, and no due-check today.
//
// This file pins the PURE core of the cadence module (`lib/feed/cronSchedule.js`,
// plan Step A / contract 5.1): `clampIntervalMinutes`, `describeCadence`, and
// `isAutoTailorDue`. The cron's own behaviour (skip-not-due, continue-not-break,
// no last_run_at bump) is driven through the real POST in
// app/api/cron/tailor/route.cadence.test.js; the vercel.json <-> constant drift
// pin lives in app/api/cron/tailor/cronSchedule.test.js (edited, F1) -- this file
// does NOT duplicate that pin.
//
// RED ON HEAD: MEASURED -- `lib/feed/cronSchedule.js` does not exist (Glob ->
// absent), so the import below fails collection. Every case here is red for the
// one reason "the subject module is absent", which is exactly AC2-C4a's
// "subject absent" red. Satisfiability + per-assertion mutation proof are in
// tests.stepA.md (reference build in an isolated scratchpad copy).
//
// WHY IMPORT clamp/describe/due BUT READ the floor by source text elsewhere:
// clampIntervalMinutes/describeCadence/isAutoTailorDue each have a PRODUCTION
// importer in Step A (the cron route uses clamp+due; FeedAutomationCard uses
// describe), so importing them here adds only a second (test) consumer and moves
// nothing in the export census. TAILOR_CRON_MINUTES has no runtime consumer, so
// it stays module-private and is pinned by SOURCE TEXT in the drift-pin file --
// importing it here would make it a test-only export and move the pinned
// 363/435 counts ([[loop-traps-tests]] rule 6 / brief hard constraint).

import { describe, it, expect } from "vitest";
import { clampIntervalMinutes, describeCadence, isAutoTailorDue } from "./cronSchedule.js";

// The floor the whole contract is built around == the vercel.json */15 period.
// Named here as a LOCAL literal only so the assertions read clearly; the
// authoritative link between this number and vercel.json is the drift pin in
// app/api/cron/tailor/cronSchedule.test.js, not this constant.
const FLOOR = 15;

describe("clampIntervalMinutes never returns below the cron floor (AC2-C4a)", () => {
  it("clamps a sub-floor finite request UP to the floor, not through it", () => {
    // The load-bearing case, and the one a `clamp` that just returns its input
    // passes a `>= floor` check for: assert the ACTUAL floor value, not >=.
    expect(clampIntervalMinutes(5)).toBe(FLOOR);
    expect(clampIntervalMinutes(1)).toBe(FLOOR);
    expect(clampIntervalMinutes(14)).toBe(FLOOR);
  });

  it("leaves a request AT the floor at the floor", () => {
    expect(clampIntervalMinutes(15)).toBe(FLOOR);
  });

  it("leaves an above-floor request UNCHANGED (does not force everything to the floor)", () => {
    // The over-clamp control: a build that returns the floor for EVERY input
    // would pass the sub-floor cases above; these fail it.
    expect(clampIntervalMinutes(30)).toBe(30);
    expect(clampIntervalMinutes(60)).toBe(60);
    expect(clampIntervalMinutes(120)).toBe(120);
  });

  it("falls back to a single consistent default (>= floor, finite) for a missing/non-finite request", () => {
    // NULL TOLERANCE (brief item 6): a null/absent interval must never yield
    // Infinity/NaN -- that is the "never run again" failure. It must be a finite
    // cadence at least the floor, and the SAME value for every non-finite input
    // (a deterministic default), so a stored null just means "use the default
    // cadence", not "stop forever".
    const fromNull = clampIntervalMinutes(null);
    expect(Number.isFinite(fromNull)).toBe(true);
    expect(fromNull).toBeGreaterThanOrEqual(FLOOR);
    expect(clampIntervalMinutes(undefined)).toBe(fromNull);
    expect(clampIntervalMinutes(NaN)).toBe(fromNull);
    expect(clampIntervalMinutes("not a number")).toBe(fromNull);
    // The default is the hourly cadence the AC set (owner ruling G.4); pinned so
    // a build that "defaults" to the floor (a shorter, more expensive cadence
    // than promised) is caught.
    expect(fromNull).toBe(60);
  });
});

describe("describeCadence states the DELIVERED cadence, a pure function of the stored value (AC2-C4c)", () => {
  it("returns non-empty copy that DIFFERS for different cadences (not a constant string)", () => {
    // Kills a describeCadence that ignores its argument and returns one fixed
    // sentence: distinct inputs must produce distinct copy.
    const q = describeCadence(15);
    const h = describeCadence(60);
    expect(q).toBeTypeOf("string");
    expect(q.length).toBeGreaterThan(0);
    expect(h).toBeTypeOf("string");
    expect(h.length).toBeGreaterThan(0);
    expect(q).not.toBe(h);
    expect(describeCadence(30)).not.toBe(h);
  });

  it("is deterministic for a given input", () => {
    expect(describeCadence(60)).toBe(describeCadence(60));
  });

  it("describes the CLAMPED value, so a sub-floor request reads as the floor it will actually get, never the request", () => {
    // The pure-function-of-STORED guard (plan A2): a user asking for 5 minutes
    // is delivered 15, and the copy for 5-then-clamped must equal the copy for
    // 15 and must NOT equal the hourly-default copy -- proving the delivered
    // string derives from the clamped value, not the raw request.
    expect(describeCadence(clampIntervalMinutes(5))).toBe(describeCadence(15));
    expect(describeCadence(clampIntervalMinutes(5))).not.toBe(describeCadence(60));
  });
});

describe("isAutoTailorDue gates a run on the elapsed interval (AC2-C4b core)", () => {
  const MIN = 60000;
  const now = 1_700_000_000_000; // fixed clock; the fn takes `now`, reads no I/O

  it("a search whose interval has fully elapsed is DUE", () => {
    const interval = 60;
    const lastRun = new Date(now - interval * MIN - 1000).toISOString(); // just past
    expect(isAutoTailorDue(lastRun, interval, now)).toBe(true);
  });

  it("a search still inside its interval is NOT due", () => {
    // The paired control for the "due" case: without it, a build that returns
    // true for everything (tailors every run, the HEAD behaviour) passes the
    // "due" assertions. This is the assertion HEAD violates.
    const interval = 60;
    const lastRun = new Date(now - 5 * MIN).toISOString(); // ran 5 min ago
    expect(isAutoTailorDue(lastRun, interval, now)).toBe(false);
  });

  it("at exactly the interval boundary it is DUE (>=, not >)", () => {
    const interval = 60;
    const lastRun = new Date(now - interval * MIN).toISOString();
    expect(isAutoTailorDue(lastRun, interval, now)).toBe(true);
  });

  it("a NULL / never-run / unparseable last_run_at is DUE, never 'never run again' (brief item 6)", () => {
    // NULL TOLERANCE: a search that has never run (null) -- or whose timestamp
    // is unreadable -- must run now, not be frozen out forever.
    expect(isAutoTailorDue(null, 60, now)).toBe(true);
    expect(isAutoTailorDue(undefined, 60, now)).toBe(true);
    expect(isAutoTailorDue("not a date", 60, now)).toBe(true);
  });

  it("a null interval (clamped to the default) still lets an old search run -- null != never (brief item 6)", () => {
    // The interval-side of NULL tolerance: clampIntervalMinutes(null) is a
    // finite default, so a search last run long ago with a null interval is
    // DUE, not stuck. Guards against a null interval reading as an infinite one.
    const lastRun = new Date(now - 24 * 60 * MIN).toISOString(); // a day ago
    expect(isAutoTailorDue(lastRun, clampIntervalMinutes(null), now)).toBe(true);
  });
});
