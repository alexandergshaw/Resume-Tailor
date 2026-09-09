// R-345 / AC-C14, AC-C25, AC-R5, AC-SCH3, AC-SCH11.
//
// Every number this feature spends money against lives in ONE module, and this
// file is the arithmetic that ties them together. The point is NOT to restate
// each literal -- a test that only says `expect(X).toBe(12)` is a second copy of
// the constant and goes green on any coordinated edit. The point is the
// RELATIONS: a change to the batch size that does not also move the call caps,
// the `research_total` CHECK bound and the capacity claim fails HERE rather than
// in production, which is exactly what R-345 is for.

import { describe, it, expect } from "vitest";
import * as C from "./glossaryConstants.js";

describe("the term budget and the batch size derive the call count (AC-C14, AC-R5)", () => {
  it("divides the term ceiling into whole batches", () => {
    expect(C.MAX_TERMS_PER_POSTING % C.RESEARCH_BATCH_SIZE).toBe(0);
  });

  it("keeps the hard total at or under the sum of the two per-kind ceilings", () => {
    // 40 explicit + 100 anticipated = 140, and the hard total is 120: the two
    // per-kind ceilings are each reachable alone, never together. A total ABOVE
    // the sum would be unreachable and a lie; a total equal to it would make the
    // 120-term database CHECK unreachable and therefore untested.
    expect(C.MAX_TERMS_PER_POSTING).toBeLessThan(C.MAX_EXPLICIT_TERMS + C.MAX_ANTICIPATED_TERMS);
    expect(C.MAX_TERMS_PER_POSTING).toBeGreaterThan(C.MAX_ANTICIPATED_TERMS);
  });

  it("bounds `research_total` by exactly the derived batch count", () => {
    // The database CHECK says `research_total <= 10`. That 10 is not a policy
    // number: it is 120 / 12, and if the batch size moves the CHECK must move
    // with it or the worker writes a row the database rejects mid-generation.
    expect(C.RESEARCH_TOTAL_MAX).toBe(C.MAX_TERMS_PER_POSTING / C.RESEARCH_BATCH_SIZE);
  });

  it("derives the per-generation call cap from the batch count plus the retry allowance", () => {
    expect(C.MAX_CALLS_PER_GENERATION).toBe(
      1 + C.MAX_TERMS_PER_POSTING / C.RESEARCH_BATCH_SIZE + C.MAX_BATCH_RETRIES_PER_GENERATION,
    );
  });
});

describe("the four bounds are consistent and ordered (AC-C25)", () => {
  it("orders generation <= fingerprint <= absolute", () => {
    expect(C.MAX_CALLS_PER_GENERATION).toBeLessThanOrEqual(C.MAX_LIFETIME_MODEL_CALLS);
    expect(C.MAX_LIFETIME_MODEL_CALLS).toBeLessThanOrEqual(C.MAX_ABSOLUTE_MODEL_CALLS);
  });

  it("derives the fingerprint cap as attempts x generation", () => {
    expect(C.MAX_LIFETIME_MODEL_CALLS).toBe(C.MAX_AUTO_ATTEMPTS * C.MAX_CALLS_PER_GENERATION);
  });

  it("keeps one hour's per-posting exposure STRICTLY below the fingerprint cap", () => {
    // r4's contradiction, made falsifiable: its limiter authorised 44 calls per
    // user per hour against a 36-call per-posting lifetime cap, so a single hour
    // could retire a shared row permanently. GENERATION_COOLDOWN bounds a
    // posting to one generation an hour, so the hourly exposure is
    // MAX_CALLS_PER_GENERATION and it must not reach the cap.
    expect(C.MAX_CALLS_PER_GENERATION).toBeLessThan(C.MAX_LIFETIME_MODEL_CALLS);
    expect(C.GENERATION_COOLDOWN_MS).toBe(3_600_000);
  });
});

describe("the invocation deadline is arithmetic, not a guess (AC-SCH3)", () => {
  it("fits at least one worst-case batch inside the usable budget", () => {
    expect(C.BATCH_WORST_CASE_MS).toBeLessThanOrEqual(
      C.INVOCATION_BUDGET_MS - C.INVOCATION_RESERVE_MS,
    );
  });

  it("derives the worst case from the digest route's own 45s + backoff + 45s figure", () => {
    expect(C.BATCH_WORST_CASE_MS).toBe(2 * C.RESEARCH_TIMEOUT_MS + 2_000);
    expect(C.RESEARCH_MAX_RETRIES).toBe(1);
  });

  it("derives the worst-case batches per invocation, and it is 2", () => {
    const usable = C.INVOCATION_BUDGET_MS - C.INVOCATION_RESERVE_MS;
    expect(C.BATCHES_PER_INVOCATION_WORST_CASE).toBe(Math.floor(usable / C.BATCH_WORST_CASE_MS));
    expect(C.BATCHES_PER_INVOCATION_WORST_CASE).toBe(2);
  });

  it("holds the lease past the end of the invocation it covers", () => {
    expect(C.LEASE_MS).toBeGreaterThan(C.INVOCATION_BUDGET_MS);
    expect(C.INVOCATION_BUDGET_MS).toBe(C.CRON_MAX_DURATION_S * 1000);
  });
});

describe("the schedule has the throughput the design claims (AC-SCH11)", () => {
  it("supplies more batches per day than the expected posting rate needs", () => {
    const supply = C.CRON_INVOCATIONS_PER_DAY * C.BATCHES_PER_INVOCATION_WORST_CASE;
    const demand =
      (C.MAX_TERMS_PER_POSTING / C.RESEARCH_BATCH_SIZE) * C.EXPECTED_POSTINGS_PER_DAY;
    expect(supply).toBeGreaterThanOrEqual(demand);
  });

  it("derives the daily invocation count from the declared cadence", () => {
    // A 2-minute cadence. If the vercel.json entry changes, this number must
    // change with it, and R-370 pins the entry itself.
    expect(C.CRON_CADENCE_MINUTES).toBe(2);
    expect(C.CRON_INVOCATIONS_PER_DAY).toBe((60 / C.CRON_CADENCE_MINUTES) * 24);
  });
});

describe("the predicate's own constants (AC-C14)", () => {
  it("compares precision strictly above one half, which is what makes at-most-one a theorem", () => {
    expect(C.CITATION_PRECISION_MIN).toBe(0.5);
    expect(C.MIN_CITATION_OVERLAP_CHARS).toBe(20);
    expect(C.MAX_CITATION_DEFINITIONS).toBe(2);
  });

  it("sets the research floor at one half", () => {
    expect(C.RESEARCH_FLOOR).toBe(0.5);
  });
});
