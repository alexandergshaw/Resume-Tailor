// N60 SECOND CHUNK, Step A (4b) -- the LEGIBILITY of the new cadence skip at the
// run-summary level (brief item 5, AC-R4). Verified as part of item 5's remit:
// the existing autoTailorRunLogMarkdown.test.js:146 class guard forces human COPY
// for any new SKIP_REASONS/ZERO_REASONS value, and autoTailorRunLog.test.js:46-59
// (fixed key list + distinctness) does NOT break when a new distinct value is
// added -- both re-confirmed by reading those files. What NEITHER covers, and the
// plan's Step A edits but leaves untested, is the RANKING: an all-not-due run must
// report the cadence reason, not be mislabelled "no new postings matched".
//
// This is the AC-R4 mislabel defect for the new reason: a run where every enabled
// search was skipped for cadence has autoProcessed=0, tailored=0, and
// skipped={cadence_not_due:N}. If autoZeroReason does not rank cadence_not_due
// above NO_NEW_POSTINGS, the user reads "No new postings matched this search yet"
// when the truth is "not time to check yet" -- exactly the "success-shaped output
// for a run that could not/ did not do the work" R4 forbids.
//
// RED ON HEAD (MEASURED): SKIP_REASONS.CADENCE_NOT_DUE is undefined and
// autoZeroReason falls through to NO_NEW_POSTINGS, so an all-not-due run's
// zeroReason is "no_new_matching_postings" today.
//
// CONTROLS: a run with NO cadence skip and no new postings STILL reports
// no_new_matching_postings (proves the ranking did not clobber the fallback), and
// a tailored>0 run reports NO zero-reason (over-fire control).

import { describe, it, expect } from "vitest";
import { summarizeRun, SKIP_REASONS } from "./autoTailorRunLog.js";

const CADENCE_NOT_DUE = "cadence_not_due";

function raw(overrides = {}) {
  return {
    userId: "user-1",
    autoEligible: 2,
    autoProcessed: 0,
    tailored: 0,
    skipped: {},
    emailEligible: 0,
    emailed: 0,
    autoFeatureError: null,
    emailFeatureError: null,
    ...overrides,
  };
}

describe("an all-not-due run explains itself as a cadence wait, not 'no new postings' (AC-R4)", () => {
  it("SKIP_REASONS carries the cadence value the route records", () => {
    expect(SKIP_REASONS.CADENCE_NOT_DUE).toBe(CADENCE_NOT_DUE);
  });

  it("a run skipped entirely for cadence does NOT report 'no new postings'", async () => {
    const out = summarizeRun(raw({ skipped: { [CADENCE_NOT_DUE]: 2 } }));
    // The mislabel this pin exists to prevent.
    expect(out.zeroReason).not.toBe("no_new_matching_postings");
    // The specific, legible reason the AC fixes.
    expect(out.zeroReason).toBe(CADENCE_NOT_DUE);
  });

  it("[control] a run with no cadence skip and no matches STILL reports 'no new postings'", () => {
    // Proves the cadence ranking did not clobber the existing fallback for a
    // genuinely idle run.
    const out = summarizeRun(raw({ skipped: {} }));
    expect(out.zeroReason).toBe("no_new_matching_postings");
  });

  it("[over-fire control] a run that tailored > 0 reports NO zero-reason", () => {
    const out = summarizeRun(raw({ tailored: 3, autoProcessed: 3, skipped: { [CADENCE_NOT_DUE]: 1 } }));
    expect(out.zeroReason).toBeNull();
  });
});
