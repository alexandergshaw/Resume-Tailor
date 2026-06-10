import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase, jsonRequest } from "../../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "./route.js";
import { createClient } from "@/lib/supabase/server";

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

function params(id) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/auto-apply-queue/[id]/apply", () => {
  it("returns 401 when not signed in", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));
    const res = await POST(jsonRequest({ action: "apply" }), params("app-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the row does not belong to the user", async () => {
    createClient.mockResolvedValue(
      makeSupabase({ applications: { select: { data: null } } }, { user: USER }),
    );
    const res = await POST(jsonRequest({ action: "apply" }), params("app-1"));
    expect(res.status).toBe(404);
  });

  it("treats skip as a DB no-op", async () => {
    const sb = makeSupabase({ applications: { select: { data: { id: "app-1", status: "auto_queued" } } } }, { user: USER });
    createClient.mockResolvedValue(sb);
    const res = await POST(jsonRequest({ action: "skip" }), params("app-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "app-1", action: "skip", openedAt: null });
    // No UPDATE was issued.
    expect(sb.calls.applications.update.length).toBe(0);
  });

  it("records auto_apply_opened_at on apply and keeps the row queued", async () => {
    const sb = makeSupabase(
      {
        applications: {
          select: { data: { id: "app-1", status: "auto_queued" } },
          update: { error: null },
        },
      },
      { user: USER },
    );
    createClient.mockResolvedValue(sb);
    const res = await POST(jsonRequest({ action: "apply" }), params("app-1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, id: "app-1", action: "apply" });
    expect(body.openedAt).toBeTruthy();
    const updateArgs = sb.calls.applications.update[0][0];
    expect(updateArgs).toHaveProperty("auto_apply_opened_at");
    expect(updateArgs).not.toHaveProperty("status");
  });

  it("defaults an unknown action to apply", async () => {
    const sb = makeSupabase(
      {
        applications: {
          select: { data: { id: "app-1", status: "auto_queued" } },
          update: { error: null },
        },
      },
      { user: USER },
    );
    createClient.mockResolvedValue(sb);
    const res = await POST(jsonRequest({ action: "bogus" }), params("app-1"));
    expect((await res.json()).action).toBe("apply");
  });

  it("returns 500 when the update fails", async () => {
    const sb = makeSupabase(
      {
        applications: {
          select: { data: { id: "app-1", status: "auto_queued" } },
          update: { error: { message: "update boom" } },
        },
      },
      { user: USER },
    );
    createClient.mockResolvedValue(sb);
    const res = await POST(jsonRequest({ action: "apply" }), params("app-1"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "update boom" });
  });
});
