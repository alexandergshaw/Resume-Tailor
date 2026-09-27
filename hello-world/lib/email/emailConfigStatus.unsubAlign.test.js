// N60 S6 (4b/TDD) -- the "looks-fine-but-refuses" alignment the brief routes to
// this seat. emailAlertsAvailable(env) reports availability from the SENDING key
// and from-address only. But the cron refuses to send when it cannot mint an
// unsubscribe link -- cron/tailor/route.js: `if (mailKill.disabled || !unsubUrl)
// continue;`, where unsubUrl = unsubscribeUrl(signUnsubscribeToken(userId),
// RESUME_TAILOR_API_URL) and is null when ALERT_UNSUBSCRIBE_SECRET (or the base
// URL) is unset. So today the status can say "configured" to a user while the
// cron silently sends nothing -- a second lie of the same class AC-E5 closes for
// the unconfigured sender.
//
// THE INVARIANT: the status a user is shown must match what the cron will
// actually do. If the cron cannot mint the unsubscribe link, alerts are NOT
// available and the status must say so.
//
// RED on HEAD: emailAlertsAvailable ignores the unsubscribe inputs, so a
// key+EMAIL_FROM env reports available:true while the cron refuses.
//
// *** CONFLICT WITH A LANDED S5 ASSERTION -- FLAGGED, NOT RESOLVED HERE. ***
// Making these green requires emailAlertsAvailable to also require the
// unsubscribe-link inputs. That turns lib/email/emailConfigStatus.test.js:17
// ("both RESEND_API_KEY and EMAIL_FROM set -> available") RED, because it sets
// no ALERT_UNSUBSCRIBE_SECRET. That assertion is S5's and is NOT plumbing. Per
// this seat's brief I do NOT edit it; the orchestrator rules on re-authoring it
// (the least-ripple fix is to add ALERT_UNSUBSCRIBE_SECRET + RESUME_TAILOR_API_URL
// to :17's env and the S5 status route test's fully-configured control).
//
// The exact env set that gates mintability is the architect's call; the property
// pinned here is "available:true implies the cron can mint the link".

import { describe, it, expect } from "vitest";
import { emailAlertsAvailable } from "./emailConfigStatus.js";

const KEY = "re_test_key";
const FROM = "Resume Tailor <jobs@configured-domain.com>";
const SECRET = "unit-test-unsub-secret";
const BASE = "https://app.example.com";

describe("emailAlertsAvailable -- status must match what the cron will do (unsubscribe link)", () => {
  it("key + EMAIL_FROM but NO unsubscribe secret -> unavailable [RED on HEAD]", () => {
    const r = emailAlertsAvailable({ RESEND_API_KEY: KEY, EMAIL_FROM: FROM, RESUME_TAILOR_API_URL: BASE });
    // The cron would `continue` past every send here (no link can be minted),
    // so reporting available:true is the lie this closes.
    expect(r.available).toBe(false);
    expect(typeof r.reason).toBe("string");
    expect(r.reason.length).toBeGreaterThan(0);
    expect(r.reason).toMatch(/unsub|ALERT_UNSUBSCRIBE_SECRET/i);
  });

  it("key + EMAIL_FROM + secret but NO base URL -> unavailable (link still cannot be built) [RED on HEAD]", () => {
    // unsubscribeUrl(token, baseUrl) returns null without a base URL, so the
    // cron refuses even with a secret. The class guard: BOTH mint inputs count.
    const r = emailAlertsAvailable({ RESEND_API_KEY: KEY, EMAIL_FROM: FROM, ALERT_UNSUBSCRIBE_SECRET: SECRET });
    expect(r.available).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("[control] fully configured (key + EMAIL_FROM + secret + base) -> available, no reason", () => {
    const r = emailAlertsAvailable({
      RESEND_API_KEY: KEY,
      EMAIL_FROM: FROM,
      ALERT_UNSUBSCRIBE_SECRET: SECRET,
      RESUME_TAILOR_API_URL: BASE,
    });
    expect(r.available).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("[control] the existing sender gates still bind -- no RESEND_API_KEY is still unavailable", () => {
    const r = emailAlertsAvailable({ EMAIL_FROM: FROM, ALERT_UNSUBSCRIBE_SECRET: SECRET, RESUME_TAILOR_API_URL: BASE });
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/RESEND_API_KEY/);
  });
});
