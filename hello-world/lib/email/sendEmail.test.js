// N60 S5 (4b/TDD) -- AC-E5: an unconfigured sender is a VISIBLE REFUSAL, never a
// silent no-op and never a silent substitution of Resend's shared sandbox sender
// `onboarding@resend.dev` (a domain this product does not control).
//
// At HEAD (lib/email/sendEmail.js): a missing RESEND_API_KEY returns a `skipped`
// refusal (already correct); a KEY-WITHOUT-EMAIL_FROM substitutes DEFAULT_FROM =
// "Resume Tailor <onboarding@resend.dev>" (:13,:36) and sends anyway. AC-E5
// removes the fallback: a missing EMAIL_FROM is a *refusal to send*, named, and
// the sandbox sender is never used.
//
// Reachability: these tests drive the real exported `sendEmail`, and the network
// boundary is `fetch` (spied), so "did an email actually go out" is observable as
// "was fetch called, and with what `from`". A build that refuses correctly never
// calls fetch; a build that substitutes the sandbox calls fetch with the sandbox
// address -- both are visible here.
//
// NON-VACUITY: every "did not send" assertion is paired with a configured control
// in which fetch IS called with the configured EMAIL_FROM, so the refusal is a
// suppression of a live path, not an assertion over a dead one.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "./sendEmail.js";

const SANDBOX = "onboarding@resend.dev";

let fetchSpy;

beforeEach(() => {
  // A fetch that would SUCCEED if reached, so a build that wrongly sends is not
  // rescued by a network error -- the only thing that stops the send is the
  // refusal under test.
  fetchSpy = vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: "resend-id-1" }),
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const args = () => ({
  to: "user@example.com",
  subject: "New job matches",
  html: "<p>hi</p>",
  text: "hi",
});

describe("sendEmail refuses visibly when the sender is not configured (AC-E5)", () => {
  it("KEY BUT NO EMAIL_FROM: refuses, names EMAIL_FROM, and never sends (no fetch, no sandbox)", async () => {
    // RED on HEAD: HEAD substitutes DEFAULT_FROM and calls fetch, returning ok:true.
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "");

    const res = await sendEmail(args());

    // A user-visible refusal: ok:false with a reason that names the missing var.
    expect(res.ok).toBe(false);
    expect(typeof res.reason).toBe("string");
    expect(res.reason.length).toBeGreaterThan(0);
    expect(res.reason).toMatch(/EMAIL_FROM/);
    // The refusal is distinct from a missing-key "skipped" so callers/reporting
    // can tell "no key" from "no from" (AC-E5: a refusal, not a skip).
    expect(res.skipped).not.toBe(true);

    // The load-bearing half: NOTHING went out. No fetch at all -> the sandbox
    // sender cannot have been used. (Asserting no-fetch is stronger than
    // inspecting the body, and it is the behaviour AC-E5 requires.)
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the sandbox sender onboarding@resend.dev is never the From on any request", async () => {
    // Class-flavoured: even if a future build DID call fetch on the no-from path,
    // the sandbox address must never be the From. Today HEAD sends with exactly
    // that address, so if fetch is called this asserts it was not the sandbox.
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "");

    await sendEmail(args());

    for (const call of fetchSpy.mock.calls) {
      const body = call?.[1]?.body ? JSON.parse(call[1].body) : {};
      expect(body.from).not.toBe(`Resume Tailor <${SANDBOX}>`);
      expect(String(body.from || "")).not.toContain(SANDBOX);
    }
    // (When the refusal is correct, fetchSpy has zero calls and this loop is a
    // no-op; the previous test proves the zero-call refusal itself.)
  });

  it("[control] fully configured: DOES send, with the configured From (proves the path is live)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Resume Tailor <jobs@configured-domain.com>");

    const res = await sendEmail(args());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.from).toBe("Resume Tailor <jobs@configured-domain.com>");
    expect(sentBody.from).not.toContain(SANDBOX);
    expect(res.ok).toBe(true);
  });

  it("MISSING RESEND_API_KEY: refuses and names the key (disclosed: GREEN on HEAD -- a control, not a red)", async () => {
    // HEAD already returns {ok:false, skipped:true, reason:"RESEND_API_KEY not set"}
    // and does not fetch. Kept as the second half of the "unconfigured => refusal"
    // contract and to pin that the missing-key path stays a refusal after S5.
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "Resume Tailor <jobs@configured-domain.com>");

    const res = await sendEmail(args());

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/RESEND_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
