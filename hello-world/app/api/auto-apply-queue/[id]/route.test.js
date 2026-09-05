import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeStatefulSupabase } from "../../../../../test/helpers/supabaseFake.js";
import { PRE_APPLY_STATUSES } from "../../../../../lib/applications/statusVocabulary.js";

// Migrated off test/helpers/supabaseMock.js's canned-result fake (R2-M6): the
// new DELETE guard chains `.in("status", PRE_APPLY_STATUSES).is("applied_at",
// null).select("id")` onto the delete, and `supabaseMock.js`'s builder
// re-labels the verb to "select" the moment `.select()` is called (its own
// header, and C9 in 3-plan-dataloss.md), so that chain would silently
// resolve against a table spec's `select` entry rather than `delete` —
// making the guard untestable. `makeStatefulSupabase` actually filters rows,
// so the guard's behaviour (not just the shape of the call) is what these
// tests exercise.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { DELETE } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

function params(id) {
  return { params: Promise.resolve({ id }) };
}

function deleteCallsOn(sb) {
  return sb.calls.filter((c) => c.table === "applications" && c.verb === "delete");
}

describe("DELETE /api/auto-apply-queue/[id]", () => {
  it("returns 401 when not signed in", async () => {
    createClient.mockResolvedValue(makeStatefulSupabase({}, { user: null }));
    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the row is not found for the user", async () => {
    createClient.mockResolvedValue(makeStatefulSupabase({}, { user: USER }));
    createAdminClient.mockReturnValue(
      makeStatefulSupabase(
        { applications: [{ id: "app-1", user_id: "someone-else", status: "auto_queued", applied_at: null }] },
        { user: USER },
      ),
    );
    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(404);
  });

  it("hard-deletes a pre-apply row with no applied_at, via the admin client scoped to id + user + status + date", async () => {
    createClient.mockResolvedValue(makeStatefulSupabase({}, { user: USER }));
    const admin = makeStatefulSupabase(
      { applications: [{ id: "app-1", user_id: "user-1", status: "auto_queued", applied_at: null }] },
      { user: USER },
    );
    createAdminClient.mockReturnValue(admin);

    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "app-1", deleted: true });

    const deletes = deleteCallsOn(admin);
    expect(deletes.length).toBe(1);
    expect(deletes[0].filters).toContainEqual({ column: "id", operator: "eq", value: "app-1", negated: false });
    expect(deletes[0].filters).toContainEqual({ column: "user_id", operator: "eq", value: "user-1", negated: false });
    expect(deletes[0].filters).toContainEqual({
      column: "status",
      operator: "in",
      value: PRE_APPLY_STATUSES,
      negated: false,
    });
    expect(deletes[0].filters).toContainEqual({ column: "applied_at", operator: "is", value: null, negated: false });
    expect(admin.rows("applications")).toEqual([]);
  });

  it("returns 500 when the delete fails", async () => {
    createClient.mockResolvedValue(makeStatefulSupabase({}, { user: USER }));
    const admin = makeStatefulSupabase(
      { applications: [{ id: "app-1", user_id: "user-1", status: "auto_queued", applied_at: null }] },
      { user: USER, errors: { applications: { delete: { message: "del boom" } } } },
    );
    createAdminClient.mockReturnValue(admin);
    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "del boom" });
  });

  it("falls back to the user client when the admin client is unavailable", async () => {
    const user = makeStatefulSupabase(
      { applications: [{ id: "app-1", user_id: "user-1", status: "auto_queued", applied_at: null }] },
      { user: USER },
    );
    createClient.mockResolvedValue(user);
    createAdminClient.mockImplementation(() => {
      throw new Error("no service key");
    });
    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(200);
    expect(deleteCallsOn(user).length).toBe(1);
    expect(user.rows("applications")).toEqual([]);
  });

  it("refuses to delete a row that has moved to an applied-or-later status, and reports why", async () => {
    // The exact shape test/repro/appliedStatusDataLoss.test.js's "offer →
    // Live Feed rocket → queue → remove" case reproduces: a queue card whose
    // application has since moved to "offer".
    createClient.mockResolvedValue(makeStatefulSupabase({}, { user: USER }));
    const admin = makeStatefulSupabase(
      { applications: [{ id: "app-1", user_id: "user-1", status: "offer", applied_at: "2026-07-04T15:32:11.000Z" }] },
      { user: USER },
    );
    createAdminClient.mockReturnValue(admin);

    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "app-1", deleted: false, reason: "protected", status: "offer" });
    expect(admin.rows("applications")).toHaveLength(1);
    expect(admin.row("applications", (r) => r.id === "app-1").applied_at).toBe("2026-07-04T15:32:11.000Z");
  });

  it("refuses to delete a row that still carries a stranded applied_at, and reports why", async () => {
    createClient.mockResolvedValue(makeStatefulSupabase({}, { user: USER }));
    const admin = makeStatefulSupabase(
      {
        applications: [
          { id: "app-1", user_id: "user-1", status: "auto_queued", applied_at: "2026-07-04T15:32:11.000Z" },
        ],
      },
      { user: USER },
    );
    createAdminClient.mockReturnValue(admin);

    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      id: "app-1",
      deleted: false,
      reason: "protected",
      status: "auto_queued",
    });
    expect(admin.rows("applications")).toHaveLength(1);
  });
});
