// N60 S5 (4b/TDD) -- AC-E3: a one-click unsubscribe that works from the email
// itself, with NO login. This drives the REAL GET handler exactly as a click on
// the emailed link does: an unauthenticated Request whose URL carries the token
// (no session cookie). It uses the REAL token module (a signed token minted for
// the test) rather than a stub, so the route+token JOIN is exercised, not faked.
//
// Pinned:
//   * a valid token turns email alerts OFF for that account and confirms it;
//   * the ONLY write is email_on_new_jobs=false (scope: it cannot change or read
//     anything else);
//   * following it twice is harmless (idempotent);
//   * an absent / malformed / foreign token changes nothing AND does no DB work,
//     so the endpoint reveals nothing about whether an address is known (no
//     enumeration signal).
//
// RED on HEAD: app/api/alerts/unsubscribe/route.js does not exist -> collection
// failure.
//
// NON-VACUITY: the valid-token control (a write DOES happen, createAdminClient IS
// reached) is what proves the bad-token "no write / no DB reach" assertions are
// measuring a suppression, not a route that never does anything.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET } from "./route.js";
import { createAdminClient } from "@/lib/supabase/admin";
import { signUnsubscribeToken } from "@/lib/email/alertUnsubscribeToken";

const UID = "11111111-2222-3333-4444-555555555555";

function reqWithToken(token) {
  const u = new URL("http://localhost/api/alerts/unsubscribe");
  if (token !== undefined && token !== null) u.searchParams.set("token", token);
  return new Request(u.toString(), { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret-value");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/alerts/unsubscribe (AC-E3)", () => {
  it("a valid token turns email alerts off for that account and confirms it", async () => {
    const admin = makeSupabase({ saved_searches: { data: null, error: null } });
    createAdminClient.mockReturnValue(admin);
    const token = signUnsubscribeToken(UID);

    const res = await GET(reqWithToken(token));
    expect(res.status).toBe(200);

    // Scope: the ONE and only write is email_on_new_jobs=false, for THIS user.
    expect(admin.calls.saved_searches.update).toHaveLength(1);
    expect(admin.calls.saved_searches.update[0][0]).toEqual({ email_on_new_jobs: false });
    expect(admin.calls.saved_searches.eq).toContainEqual(["user_id", UID]);
    // It only flips a flag: never deletes or inserts anything.
    expect(admin.calls.saved_searches.delete).toHaveLength(0);
    expect(admin.calls.saved_searches.insert).toHaveLength(0);

    // Confirms what it turned off (a remedy that WORKS and says so).
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toMatch(/alert|email|off/);
  });

  it("following the link twice is harmless: the second call still just sets the flag off", async () => {
    const admin = makeSupabase({ saved_searches: { data: null, error: null } });
    createAdminClient.mockReturnValue(admin);
    const token = signUnsubscribeToken(UID);

    const r1 = await GET(reqWithToken(token));
    const r2 = await GET(reqWithToken(token));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Idempotent by construction: each valid follow writes the same off-flag and
    // nothing destructive; twice is not an error.
    for (const call of admin.calls.saved_searches.update) {
      expect(call[0]).toEqual({ email_on_new_jobs: false });
    }
    expect(admin.calls.saved_searches.delete).toHaveLength(0);
  });

  it("an ABSENT token changes nothing and does no DB work (no enumeration)", async () => {
    createAdminClient.mockReturnValue(makeSupabase({ saved_searches: { data: null } }));
    const res = await GET(reqWithToken(undefined));
    expect(res.status).toBe(200); // generic, not a 404 that would confirm/deny
    // No DB reach at all -> nothing to leak about whether an address is known.
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("a MALFORMED token changes nothing and does no DB work", async () => {
    createAdminClient.mockReturnValue(makeSupabase({ saved_searches: { data: null } }));
    const res = await GET(reqWithToken("not-a-real-token"));
    expect(res.status).toBe(200);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("a FOREIGN token (valid shape, wrong secret) changes nothing and does no DB work", async () => {
    // Mint under a different secret, then present it to the route running under
    // the real secret: it must refuse without touching the database.
    vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "attacker-secret");
    const foreign = signUnsubscribeToken(UID);
    vi.stubEnv("ALERT_UNSUBSCRIBE_SECRET", "unit-test-secret-value");

    createAdminClient.mockReturnValue(makeSupabase({ saved_searches: { data: null } }));
    const res = await GET(reqWithToken(foreign));
    expect(res.status).toBe(200);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
