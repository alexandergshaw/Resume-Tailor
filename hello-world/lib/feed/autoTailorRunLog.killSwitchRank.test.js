// N60 S4 (4b, OWED run-log coverage -- verifier finding N60-V2). The kill-switch
// zero-reasons were added to `autoTailorRunLog.js` (SKIP_REASONS/ZERO_REASONS and
// the ranking at autoZeroReason lines 54-55), but NO assertion anywhere exercised
// them: deleting those two ranking lines would make a switched-off run report
// itself as "no new matching postings" -- a switched-off feature mislabelled as
// "checked and found nothing" -- and every one of the 14,000+ tests would still
// pass. This file closes that: it pins that a switched-off run reports the SWITCH,
// and that the switch reason OUTRANKS both NO_ENABLED_SEARCH and NO_NEW_POSTINGS,
// while an eligibility error still outranks the switch.
//
// It imports only what production consumes here (SKIP_REASONS + summarizeRun).
// ZERO_REASONS stays module-private on purpose -- importing it would create a
// test-only export and move exportReachability.sweep's pinned counts (the same
// discipline as autoTailorRunLog.test.js). The expected zero-reason strings are
// therefore asserted as literals; they are the frozen wire values.
//
// GREEN ON HEAD: the ranking exists and is correct, so these PASS on the working
// tree; their power is proven by a mutant that DELETES lines 54-55 (which these
// then kill) plus a no-op control that survives -- see tests.route-wiring.md.
//
// CONTROLS: an over-fire control (a tailored>0 run reports NO reason even with a
// kill-switch skip recorded) and an under-fire control (a zero run with neither
// switch skip falls through to NO_NEW_POSTINGS) bracket every assertion, so a
// summarizeRun that hardwired the switch reason on, or never emitted it, is caught.

import { describe, it, expect } from "vitest";
import { SKIP_REASONS, summarizeRun } from "./autoTailorRunLog.js";

// The frozen wire strings (ZERO_REASONS is module-private -- see header).
const DISABLED_BY_KILL_SWITCH = "disabled_by_kill_switch";
const KILL_SWITCH_UNREADABLE = "kill_switch_unreadable";
const NO_ENABLED_SEARCH = "no_search_enabled";
const NO_NEW_POSTINGS = "no_new_matching_postings";
const ELIGIBILITY_QUERY_FAILED = "eligibility_query_failed";

function raw(overrides = {}) {
  return {
    userId: "user-1",
    autoEligible: 2,
    autoProcessed: 2,
    tailored: 0,
    skipped: {},
    emailEligible: 0,
    emailed: 0,
    autoFeatureError: null,
    emailFeatureError: null,
    ...overrides,
  };
}

describe("summarizeRun: a switched-off run reports the kill switch (N60 S4)", () => {
  it("a disabled-by-kill-switch zero reports the switch, not 'no new postings'", () => {
    // autoEligible > 0 and no other skip: without the ranking line this falls
    // through to NO_NEW_POSTINGS. KILLS the deletion of autoTailorRunLog.js:55.
    const out = summarizeRun(
      raw({ autoEligible: 2, tailored: 0, skipped: { [SKIP_REASONS.KILL_SWITCH]: 2 } }),
    );
    expect(out.zeroReason).toBe(DISABLED_BY_KILL_SWITCH);
    expect(out.zeroReason).not.toBe(NO_NEW_POSTINGS);
  });

  it("an unreadable-switch zero reports kill_switch_unreadable, not 'no new postings'", () => {
    // KILLS the deletion of autoTailorRunLog.js:54.
    const out = summarizeRun(
      raw({ autoEligible: 2, tailored: 0, skipped: { [SKIP_REASONS.KILL_SWITCH_UNREADABLE]: 2 } }),
    );
    expect(out.zeroReason).toBe(KILL_SWITCH_UNREADABLE);
    expect(out.zeroReason).not.toBe(NO_NEW_POSTINGS);
  });

  it("the switch reason OUTRANKS 'no enabled search' when both would apply", () => {
    // autoEligible === 0 would give NO_ENABLED_SEARCH, but the switch line sits
    // ABOVE the eligibility check, so it must win. Pins the ordering, not just
    // presence -- a deletion or a reorder below `if (!autoEligible)` fails here.
    const out = summarizeRun(
      raw({ autoEligible: 0, tailored: 0, skipped: { [SKIP_REASONS.KILL_SWITCH]: 1 } }),
    );
    expect(out.zeroReason).toBe(DISABLED_BY_KILL_SWITCH);
    expect(out.zeroReason).not.toBe(NO_ENABLED_SEARCH);
  });

  it("kill_switch_unreadable outranks a plain kill-switch when both are recorded", () => {
    const out = summarizeRun(
      raw({
        autoEligible: 2,
        tailored: 0,
        skipped: { [SKIP_REASONS.KILL_SWITCH]: 1, [SKIP_REASONS.KILL_SWITCH_UNREADABLE]: 1 },
      }),
    );
    expect(out.zeroReason).toBe(KILL_SWITCH_UNREADABLE);
  });

  it("an eligibility error STILL outranks the kill switch (the switch does not over-fire)", () => {
    // Control that the ranking above the switch is preserved: a broken column is
    // the one thing that outranks a switched-off run.
    const out = summarizeRun(
      raw({ autoEligible: 2, tailored: 0, autoFeatureError: "column boom", skipped: { [SKIP_REASONS.KILL_SWITCH]: 2 } }),
    );
    expect(out.zeroReason).toBe(ELIGIBILITY_QUERY_FAILED);
  });

  it("[over-fire control] a run that tailored > 0 reports NO reason even with a switch skip recorded", () => {
    const out = summarizeRun(
      raw({ autoEligible: 2, tailored: 3, skipped: { [SKIP_REASONS.KILL_SWITCH]: 1 } }),
    );
    expect(out.zeroReason).toBeNull();
  });

  it("[under-fire control] a zero run with NEITHER switch skip falls through to 'no new postings'", () => {
    // Proves the switch reasons are not hardwired on: with no switch skip and
    // an eligible, resume-ready, uncapped run, the reason is the ordinary one.
    const out = summarizeRun(raw({ autoEligible: 2, tailored: 0, skipped: {} }));
    expect(out.zeroReason).toBe(NO_NEW_POSTINGS);
  });
});
