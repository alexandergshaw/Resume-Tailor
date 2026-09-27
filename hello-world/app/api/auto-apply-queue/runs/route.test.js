// N60 S7 (4b) -- AC-R5's read surface: the user can see their OWN run log.
//
// The cron writes auto_tailor_runs as service_role (design-structure.r1.md §4);
// this GET is how the signed-in owner reads their rows back for the automation
// panel. The table is select-own by RLS, and this route ALSO filters on the
// authenticated user's id -- the same belt-and-braces the sibling queue route
// uses (auto-apply-queue/route.js:28, `.eq("user_id", user.id)`), so a
// mis-scoped query can never return another account's runs even if RLS were
// mis-provisioned.
//
// RED ON HEAD: app/api/auto-apply-queue/runs/route.js does not exist, so the
// import below fails collection. MEASURED: ABSENT in the S7-target probe.
//
// Own-rows is asserted structurally (the user_id filter carries the AUTHED
// user's id, and a different user yields a different filter) and behaviourally
// (an empty history is a 200 with an empty list, never an error).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";

const USER = { id: "user-1" };

const RUNS = [
  { id: "r2", ran_at: "2026-09-27T13:00:00Z", payload: { userId: "user-1", tailored: 1, zeroReason: null } },
  { id: "r1", ran_at: "2026-09-27T12:00:00Z", payload: { userId: "user-1", tailored: 0, zeroReason: "no_search_enabled" } },
];

function bodyRuns(body) {
  // The route may name the array `runs` or `items`; accept either so this test
  // pins the CONTRACT (own rows, reachable), not a bikeshed over the key.
  return body.runs || body.items;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auto-apply-queue/runs", () => {
  it("returns 401 when not signed in", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the signed-in user's runs, scoped to their own user_id", async () => {
    const client = makeSupabase({ auto_tailor_runs: { data: RUNS } }, { user: USER });
    createClient.mockResolvedValue(client);

    const res = await GET();
    expect(res.status).toBe(200);
    const runs = bodyRuns(await res.json());
    expect(Array.isArray(runs)).toBe(true);
    expect(runs).toHaveLength(2);
    // Own-rows: the query carried the authenticated user's id.
    expect(client.calls.auto_tailor_runs.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("scopes to the ACTUAL authed user, not a fixed id (non-vacuity for own-rows)", async () => {
    const client = makeSupabase({ auto_tailor_runs: { data: [] } }, { user: { id: "user-9" } });
    createClient.mockResolvedValue(client);
    await GET();
    expect(client.calls.auto_tailor_runs.eq).toContainEqual(["user_id", "user-9"]);
    expect(client.calls.auto_tailor_runs.eq).not.toContainEqual(["user_id", "user-1"]);
  });

  it("returns 200 with an empty list for a user with no runs (nothing yet, not an error)", async () => {
    createClient.mockResolvedValue(makeSupabase({ auto_tailor_runs: { data: [] } }, { user: USER }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(bodyRuns(await res.json())).toEqual([]);
  });
});
