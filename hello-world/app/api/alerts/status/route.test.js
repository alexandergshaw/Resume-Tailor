// N60 S5 (4b/TDD) -- AC-E5: the config status must reach a surface a user could
// see. This is the server surface the alert UI reads (the jsdom "control renders
// unavailable" half is S8, when the control exists). This file drives the REAL
// GET /api/alerts/status the way the client fetches it, with a signed-in user.
//
// RED on HEAD: app/api/alerts/status/route.js does not exist -> collection failure.
//
// NON-VACUITY: the fully-configured control (emailConfigured:true) separates a
// real report from a route that hardcodes "unavailable"; the 401 control proves
// the surface is gated to the signed-in owner.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/alerts/status (AC-E5)", () => {
  it("401 when not signed in (the status is the owner's, not public)", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("reports emailConfigured:false with a reason when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "Resume Tailor <jobs@configured-domain.com>");
    createClient.mockResolvedValue(makeSupabase({}, { user: USER }));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.emailConfigured).toBe(false);
    expect(typeof body.reason).toBe("string");
    expect(body.reason.length).toBeGreaterThan(0);
    expect(body.reason).toMatch(/RESEND_API_KEY/);
  });

  it("reports emailConfigured:false naming EMAIL_FROM when the key is set but the sender is not", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "");
    createClient.mockResolvedValue(makeSupabase({}, { user: USER }));

    const res = await GET();
    const body = await res.json();
    expect(body.emailConfigured).toBe(false);
    expect(body.reason).toMatch(/EMAIL_FROM/);
  });

  it("[control] reports emailConfigured:true with no reason when fully configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Resume Tailor <jobs@configured-domain.com>");
    createClient.mockResolvedValue(makeSupabase({}, { user: USER }));

    const res = await GET();
    const body = await res.json();
    expect(body.emailConfigured).toBe(true);
    expect(body.reason).toBeNull();
  });
});
