// N60 S1 (4b) -- AC-R4's pure "a run explains itself" core.
//
// The cron today ends a run with a bare `break` (route.js:89,106) and its response
// (route.js:315-327) carries no eligibility count and no machine reason -- so an
// `ok:true, totalQueued:0` run that found no enabled search is byte-identical to one
// whose flag column errored. AC-R4's failure direction: "the response must never
// report success-shaped output for a run that could not evaluate eligibility."
//
// This pins the PURE core the route delegates to (`lib/feed/autoTailorRunLog.js`,
// plan 6.1): `SKIP_REASONS` and `summarizeRun`'s invariant that a zero outcome
// ALWAYS carries a distinguishing machine reason and a non-zero outcome NEVER does,
// AND that a broken-column zero is DISTINGUISHABLE from an idle zero.
//
// It imports only what S1 PRODUCTION consumes (summarizeRun + SKIP_REASONS). The
// distinguishability is asserted over summarizeRun's own output rather than by
// importing the ZERO_REASONS enum: importing an export the route does not also use
// would create a test-only export and move exportReachability.sweep's pinned 363
// (brief hard constraint / [[loop-traps-tests]] rule 6). renderRunLogMarkdown /
// runLogFileName (AC-R5) are deferred to S7, where their download consumer lands.
//
// RED ON HEAD: the module does not exist; the import fails collection.
//
// CONTROLS: every "zero => a reason" assertion is paired with a "non-zero => null"
// control, so a summarizeRun that hardwires a reason on (over-fires) and one that
// never emits a reason (under-fires) are both caught. See tests.r1.md mutants.

import { describe, it, expect } from "vitest";
import { SKIP_REASONS, summarizeRun } from "./autoTailorRunLog.js";

function raw(overrides = {}) {
  return {
    userId: "user-1",
    autoEligible: 2,
    autoProcessed: 2,
    tailored: 3,
    skipped: {},
    emailEligible: 1,
    emailed: 1,
    autoFeatureError: null,
    emailFeatureError: null,
    ...overrides,
  };
}

describe("SKIP_REASONS names the distinct skip causes AC-R4 requires", () => {
  it("has a distinct machine string for each of the five causes plus counter-unreadable", () => {
    for (const key of [
      "PER_RUN_CAP",
      "PER_DAY_CEILING",
      "NO_RESUME",
      "ALREADY_TRACKED",
      "TAILOR_THREW",
      "COUNTER_UNREADABLE",
    ]) {
      expect(SKIP_REASONS[key], `SKIP_REASONS.${key} is missing`).toBeTypeOf("string");
      expect(SKIP_REASONS[key].length).toBeGreaterThan(0);
    }
    const values = Object.values(SKIP_REASONS);
    expect(new Set(values).size, "skip-reason values are not all distinct").toBe(values.length);
  });
});

describe("summarizeRun: a zero outcome always carries a machine reason (AC-R4)", () => {
  it("[control] a run that tailored > 0 reports NO zero-reason", () => {
    expect(summarizeRun(raw({ tailored: 3 })).zeroReason).toBeNull();
  });

  it("a zero run ALWAYS yields a non-empty reason string (never null)", () => {
    const out = summarizeRun(
      raw({ tailored: 0, autoProcessed: 1, autoEligible: 1, skipped: { [SKIP_REASONS.NO_RESUME]: 1 } }),
    );
    expect(out.zeroReason).toBeTypeOf("string");
    expect(out.zeroReason.length).toBeGreaterThan(0);
  });

  it("distinguishes a broken-column zero from an idle zero (the whole point of R4)", () => {
    const broken = summarizeRun(raw({ tailored: 0, autoProcessed: 0, autoEligible: 0, autoFeatureError: "column boom" }));
    const idle = summarizeRun(raw({ tailored: 0, autoProcessed: 0, autoEligible: 0 }));
    expect(broken.zeroReason).toBeTypeOf("string");
    expect(idle.zeroReason).toBeTypeOf("string");
    // A build that ignores the feature error would collapse these into one reason.
    expect(broken.zeroReason).not.toBe(idle.zeroReason);
  });

  it("is deterministic for a given input", () => {
    const a = summarizeRun(raw({ tailored: 0, autoEligible: 0 })).zeroReason;
    const b = summarizeRun(raw({ tailored: 0, autoEligible: 0 })).zeroReason;
    expect(a).toBe(b);
  });

  it("mirrors the same rule for the email-only feature", () => {
    expect(summarizeRun(raw({ emailed: 2 })).emailZeroReason).toBeNull();
    const broken = summarizeRun(raw({ emailed: 0, emailEligible: 0, emailFeatureError: "email boom" }));
    const idle = summarizeRun(raw({ emailed: 0, emailEligible: 0 }));
    expect(broken.emailZeroReason).toBeTypeOf("string");
    expect(idle.emailZeroReason).toBeTypeOf("string");
    expect(broken.emailZeroReason).not.toBe(idle.emailZeroReason);
  });
});
