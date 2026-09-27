// N60 S6 (4b/TDD) -- AC-E4 + contract §6.4: a PAUSED run must report that it was
// paused, not that it found no new postings. The same mislabelling the auto-side
// kill switch already fixed (autoTailorRunLog.killSwitchRank.test.js) is still
// open on the EMAIL side: emailZeroReason at HEAD knows nothing about a pause or
// the mail kill switch, so a suppressed-mail run with eligible searches falls
// through to "no_new_matching_postings" -- which tells the user "nothing
// matched" when in fact the app chose not to send.
//
// This was flagged OWED for this seat in tests.route-wiring.md ("The email side
// of emailZeroReason for a mail kill switch / pause ... is the S5/S6 seam and is
// not shipped at HEAD"). It ships here.
//
// CONTRACT: summarizeRun accepts raw.emailPaused / raw.emailKillSwitch booleans
// (the cron sets them from readAlertsPaused / isFeatureDisabled), and
// emailZeroReason, when emailed === 0, ranks:
//   emailFeatureError  >  emailKillSwitch  >  emailPaused  >  (no eligible) > no new postings
// so a switched-off or paused run is never mislabelled, and neither masks an
// actual eligibility error.
//
// RED on HEAD: emailZeroReason ignores these fields -> a paused run reports
// "no_new_matching_postings". The two controls below (over-fire, under-fire)
// pass on HEAD and are disclosed as controls, not coverage.

import { describe, it, expect } from "vitest";
import { summarizeRun } from "./autoTailorRunLog.js";

const PAUSED_REASON = "alerts_paused";
const KILL_SWITCH_REASON = "disabled_by_kill_switch";
const NO_NEW = "no_new_matching_postings";
const ELIGIBILITY_FAILED = "eligibility_query_failed";

describe("summarizeRun -- a paused run says so, it does not claim 'no new postings' (AC-E4)", () => {
  it("PAUSED with eligible searches and zero sent -> emailZeroReason is the pause reason [RED on HEAD]", () => {
    const r = summarizeRun({ userId: "u1", emailEligible: 2, emailed: 0, emailPaused: true });
    expect(r.emailZeroReason).toBe(PAUSED_REASON);
    // The specific mislabel this closes: it must NOT read as "nothing matched".
    expect(r.emailZeroReason).not.toBe(NO_NEW);
  });

  it("mail KILL SWITCH with eligible searches and zero sent -> the kill-switch reason [RED on HEAD]", () => {
    const r = summarizeRun({ userId: "u1", emailEligible: 2, emailed: 0, emailKillSwitch: true });
    expect(r.emailZeroReason).toBe(KILL_SWITCH_REASON);
    expect(r.emailZeroReason).not.toBe(NO_NEW);
  });

  it("an eligibility error still OUTRANKS a pause -- the pause must not mask an outage [control, green on HEAD]", () => {
    const r = summarizeRun({
      userId: "u1",
      emailEligible: 2,
      emailed: 0,
      emailPaused: true,
      emailFeatureError: "select failed",
    });
    expect(r.emailZeroReason).toBe(ELIGIBILITY_FAILED);
  });

  it("[over-fire control] emailed > 0 -> NO zero-reason even with the pause flag set", () => {
    const r = summarizeRun({ userId: "u1", emailEligible: 2, emailed: 3, emailPaused: true });
    expect(r.emailZeroReason).toBeNull();
  });

  it("[under-fire control] NOT paused, zero sent -> the ordinary 'no new postings' reason", () => {
    const r = summarizeRun({ userId: "u1", emailEligible: 2, emailed: 0, emailPaused: false });
    expect(r.emailZeroReason).toBe(NO_NEW);
  });
});
