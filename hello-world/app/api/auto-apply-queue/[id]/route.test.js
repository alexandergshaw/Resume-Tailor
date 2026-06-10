import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../../../../../test/helpers/supabaseMock.js";

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

describe("DELETE /api/auto-apply-queue/[id]", () => {
  it("returns 401 when not signed in", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));
    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the row is not found for the user", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: USER }));
    createAdminClient.mockReturnValue(makeSupabase({ applications: { select: { data: null } } }));
    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(404);
  });

  it("hard-deletes the row via the admin client scoped to id + user", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: USER }));
    const admin = makeSupabase({
      applications: { select: { data: { id: "app-1" } }, delete: { error: null } },
    });
    createAdminClient.mockReturnValue(admin);

    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "app-1" });
    expect(admin.calls.applications.delete.length).toBe(1);
    expect(admin.calls.applications.eq).toContainEqual(["id", "app-1"]);
    expect(admin.calls.applications.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("returns 500 when the delete fails", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: USER }));
    createAdminClient.mockReturnValue(
      makeSupabase({ applications: { select: { data: { id: "app-1" } }, delete: { error: { message: "del boom" } } } }),
    );
    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "del boom" });
  });

  it("falls back to the user client when the admin client is unavailable", async () => {
    const user = makeSupabase(
      { applications: { select: { data: { id: "app-1" } }, delete: { error: null } } },
      { user: USER },
    );
    createClient.mockResolvedValue(user);
    createAdminClient.mockImplementation(() => {
      throw new Error("no service key");
    });
    const res = await DELETE(null, params("app-1"));
    expect(res.status).toBe(200);
    expect(user.calls.applications.delete.length).toBe(1);
  });
});
