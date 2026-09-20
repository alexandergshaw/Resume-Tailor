// @vitest-environment node
//
// V-8 fix (verify.r1.md, N29/N41 fix round 2, item 5): route.triggerClass.test.js
// proves the PURE `triggerClassOf` throws on an unrecognized value; this
// file proves the other half of the owner's ruling -- "make it fail loudly
// at the seam" -- by driving the REAL POST handler and asserting the throw
// is caught at GATE 5 and turned into a genuine 400 response, BEFORE GATE 6
// ever queries the database. A pure-function unit test alone cannot show
// that: if a future edit removed GATE 5's own try/catch, the unhandled
// throw would surface as a framework-level 500 (or worse, crash the whole
// request handler in a way Next.js swallows differently in different
// environments) instead of the documented, client-visible 400 -- this file
// is what would catch that regression.
//
// Mocks only the network-facing edge (`@/lib/supabase/server`'s
// createClient) -- the rate limiter and every other gate run for real,
// matching route.trustedNamesWiring.test.js's own mocking discipline.
//
// Correction (regression fix, same day): `null` was originally listed here
// as a rejected value, but the owner's corrected ruling treats an ABSENT
// triggerClass (undefined, null, or the key missing from the body) as
// legitimate -- it defaults to "B1", exactly as it did before the V-8 fix --
// and only a SUPPLIED-but-unrecognized value is the telemetry lie worth a
// 400 for. `null` moved to the "defaults to B1" group below, alongside the
// key-omitted case; this file's own header line 6-13 on why a real POST is
// needed (not just the pure-function test) applies equally to proving the
// default still reaches GATE 6 unrejected.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { POST } from "./route.js";

const USER_ID = "user-1";

function request(body) {
  return new Request("http://localhost/api/interview-prep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A minimal chainable Supabase fake -- `.from(...).select(...).eq(...).eq(...).maybeSingle()`
 *  resolves to no matching row, so a request that DOES pass GATE 5 reaches
 *  GATE 6 and terminates there (404), distinguishing "GATE 5 let it through"
 *  from "GATE 5 rejected it" without needing a full seeded fixture. */
function fakeSupabase() {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    from: vi.fn(() => chain),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/interview-prep -- GATE 5 rejects an unrecognized triggerClass with a 400, never reaching GATE 6", () => {
  it.each([["bogus"], [""]])(
    "triggerClass=%p is rejected with a 400 and the database is never queried",
    async (bad) => {
      const sb = fakeSupabase();
      createClient.mockResolvedValue(sb);

      const res = await POST(request({ applicationId: "app-1", triggerClass: bad }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
      expect(sb.from).not.toHaveBeenCalled();
    },
  );

  it("a known triggerClass (B2) passes GATE 5 unrejected and reaches GATE 6 (the database is queried)", async () => {
    const sb = fakeSupabase();
    createClient.mockResolvedValue(sb);

    const res = await POST(request({ applicationId: "app-1", triggerClass: "B2" }));

    // GATE 6 finds no matching application row (the fake always resolves
    // null) and returns 404 -- distinct from GATE 5's own 400, and only
    // reachable at all if GATE 5 let "B2" through.
    expect(res.status).toBe(404);
    expect(sb.from).toHaveBeenCalled();
  });
});

describe("POST /api/interview-prep -- GATE 5 treats an ABSENT triggerClass as B1, never rejecting it", () => {
  it("triggerClass=null passes GATE 5 unrejected and reaches GATE 6 (the database is queried)", async () => {
    const sb = fakeSupabase();
    createClient.mockResolvedValue(sb);

    const res = await POST(request({ applicationId: "app-1", triggerClass: null }));

    // Same discriminator as the B2 case above: a 404 from GATE 6 is only
    // reachable if GATE 5 let the (defaulted) value through.
    expect(res.status).toBe(404);
    expect(sb.from).toHaveBeenCalled();
  });

  it("triggerClass omitted from the body entirely passes GATE 5 unrejected and reaches GATE 6", async () => {
    const sb = fakeSupabase();
    createClient.mockResolvedValue(sb);

    const res = await POST(request({ applicationId: "app-1" }));

    expect(res.status).toBe(404);
    expect(sb.from).toHaveBeenCalled();
  });
});
