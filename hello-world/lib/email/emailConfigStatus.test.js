// N60 S5 (4b/TDD) -- AC-E5: the config status must be SERVER-REPORTED (a client
// cannot see a server env var, and guessing is how "alerts are on" becomes a
// second lie). `emailAlertsAvailable(env)` is the pure decision the status route
// (app/api/alerts/status/route.js) reports; this file pins the decision, the
// route test pins that a signed-in user actually gets it.
//
// RED on HEAD: lib/email/emailConfigStatus.js does not exist -> collection failure
// (a real Cannot-find-module import error, never a vacuous pass).
//
// NON-VACUITY: the fully-configured "available:true" case is the control that
// separates this from a function that always returns unavailable.

import { describe, it, expect } from "vitest";
import { emailAlertsAvailable } from "./emailConfigStatus.js";

describe("emailAlertsAvailable (AC-E5, server-reported)", () => {
  it("both RESEND_API_KEY and EMAIL_FROM set -> available, no reason", () => {
    // N60 S6 (owner ruling): "fully configured" now also means the cron can
    // mint the unsubscribe link -- see emailConfigStatus.unsubAlign.test.js.
    // Env setup only; the assertion below is unchanged.
    const r = emailAlertsAvailable({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Resume Tailor <jobs@configured-domain.com>",
      ALERT_UNSUBSCRIBE_SECRET: "unit-test-unsub-secret",
      RESUME_TAILOR_API_URL: "https://app.example.com",
    });
    expect(r.available).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("no RESEND_API_KEY -> unavailable with a non-empty reason naming the key", () => {
    const r = emailAlertsAvailable({
      EMAIL_FROM: "Resume Tailor <jobs@configured-domain.com>",
    });
    expect(r.available).toBe(false);
    expect(typeof r.reason).toBe("string");
    expect(r.reason.length).toBeGreaterThan(0);
    expect(r.reason).toMatch(/RESEND_API_KEY/);
  });

  it("key present but no EMAIL_FROM -> unavailable with a reason naming EMAIL_FROM", () => {
    const r = emailAlertsAvailable({ RESEND_API_KEY: "re_test_key" });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/EMAIL_FROM/);
  });

  it("an empty/whitespace EMAIL_FROM counts as unset (not a valid sender)", () => {
    const r = emailAlertsAvailable({ RESEND_API_KEY: "re_test_key", EMAIL_FROM: "   " });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/EMAIL_FROM/);
  });

  it("nothing set -> unavailable (never throws, never guesses available)", () => {
    const r = emailAlertsAvailable({});
    expect(r.available).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
