import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const USER = { id: "user-1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auto-apply-queue", () => {
  it("returns 401 when not signed in", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 500 when the applications query errors", async () => {
    createClient.mockResolvedValue(
      makeSupabase({ applications: { data: null, error: { message: "db boom" } } }, { user: USER }),
    );
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "db boom" });
  });

  it("returns an empty list when nothing is queued", async () => {
    createClient.mockResolvedValue(makeSupabase({ applications: { data: [] } }, { user: USER }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it("filters applications by user and auto_queued status", async () => {
    const user = makeSupabase({ applications: { data: [] } }, { user: USER });
    createClient.mockResolvedValue(user);
    await GET();
    expect(user.calls.applications.eq).toContainEqual(["user_id", "user-1"]);
    expect(user.calls.applications.eq).toContainEqual(["status", "auto_queued"]);
  });

  it("stitches positions and generated docs onto each row", async () => {
    const rows = [
      {
        id: "app-1",
        status: "auto_queued",
        auto_saved_at: "2026-06-01T00:00:00Z",
        applied_at: null,
        auto_apply_opened_at: "2026-06-02T00:00:00Z",
        position_id: "pos-1",
        resume_used_id: "res-1",
        cover_letter_id: "cov-1",
        auto_search_id: "search-1",
      },
      {
        id: "app-2",
        status: "auto_queued",
        auto_saved_at: "2026-06-01T00:00:00Z",
        applied_at: null,
        auto_apply_opened_at: null,
        position_id: null,
        resume_used_id: null,
        cover_letter_id: null,
        auto_search_id: null,
      },
    ];
    const user = makeSupabase(
      {
        applications: { data: rows },
        positions: { data: [{ id: "pos-1", title: "Eng", company: "Acme", location: "Remote", url: "u" }] },
      },
      { user: USER },
    );
    const admin = makeSupabase({
      generated_resumes: { data: [{ id: "res-1", content: "R", content_lines: ["r"] }] },
      generated_cover_letters: { data: [{ id: "cov-1", content: "C", content_lines: ["c"] }] },
    });
    createClient.mockResolvedValue(user);
    createAdminClient.mockReturnValue(admin);

    const res = await GET();
    const body = await res.json();

    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: "app-1",
      auto_apply_opened_at: "2026-06-02T00:00:00Z",
      positions: { id: "pos-1", title: "Eng" },
      generated_resumes: { id: "res-1", content: "R" },
      generated_cover_letters: { id: "cov-1", content: "C" },
    });
    // Row with no relation ids resolves to nulls.
    expect(body.items[1]).toMatchObject({
      id: "app-2",
      positions: null,
      generated_resumes: null,
      generated_cover_letters: null,
    });
  });

  it("reads generated docs via the admin client by id (no user_id filter)", async () => {
    const rows = [
      {
        id: "app-1",
        status: "auto_queued",
        position_id: null,
        resume_used_id: "res-1",
        cover_letter_id: "cov-1",
      },
    ];
    const user = makeSupabase({ applications: { data: rows } }, { user: USER });
    const admin = makeSupabase({
      generated_resumes: { data: [{ id: "res-1", content: "R", content_lines: [] }] },
      generated_cover_letters: { data: [{ id: "cov-1", content: "C", content_lines: [] }] },
    });
    createClient.mockResolvedValue(user);
    createAdminClient.mockReturnValue(admin);

    await GET();

    expect(admin.calls.generated_resumes.in).toContainEqual(["id", ["res-1"]]);
    expect(admin.calls.generated_cover_letters.in).toContainEqual(["id", ["cov-1"]]);
    // No user_id scoping on the generated-doc reads.
    const resumeEqs = admin.calls.generated_resumes.eq || [];
    expect(resumeEqs.find((a) => a[0] === "user_id")).toBeUndefined();
  });

  it("falls back to the user client when the admin client is unavailable", async () => {
    const rows = [{ id: "app-1", status: "auto_queued", position_id: null, resume_used_id: "res-1", cover_letter_id: null }];
    const user = makeSupabase(
      {
        applications: { data: rows },
        generated_resumes: { data: [{ id: "res-1", content: "R", content_lines: [] }] },
      },
      { user: USER },
    );
    createClient.mockResolvedValue(user);
    createAdminClient.mockImplementation(() => {
      throw new Error("no service key");
    });

    const res = await GET();
    const body = await res.json();
    expect(body.items[0].generated_resumes).toMatchObject({ id: "res-1" });
  });

  // LIVE DEFECT under test: `applications.application_url` is a per-user
  // override of the shared `positions.url`. AutoApplyQueueTab.js's own
  // `postingUrlFor(row)` already prefers `row.application_url`, but this
  // route neither selects the column from `applications` nor copies it onto
  // the item it returns -- so `row.application_url` is `undefined` in every
  // response this route has ever sent, and the tab's fix has nothing to read.
  it("selects application_url from applications so the per-user override can reach the client", async () => {
    const user = makeSupabase({ applications: { data: [] } }, { user: USER });
    createClient.mockResolvedValue(user);
    await GET();
    const selectArgs = user.calls.applications.select[0];
    expect(selectArgs.some((arg) => /\bapplication_url\b/.test(arg))).toBe(true);
  });

  it("returns application_url on each item alongside the shared position's url", async () => {
    const rows = [
      {
        id: "app-1",
        status: "auto_queued",
        position_id: "pos-1",
        resume_used_id: null,
        cover_letter_id: null,
        auto_search_id: null,
        application_url: "https://mine.example/1",
      },
      {
        id: "app-2",
        status: "auto_queued",
        position_id: "pos-1",
        resume_used_id: null,
        cover_letter_id: null,
        auto_search_id: null,
        application_url: null,
      },
    ];
    const user = makeSupabase(
      {
        applications: { data: rows },
        positions: { data: [{ id: "pos-1", title: "Eng", company: "Acme", location: "Remote", url: "https://acme.example/shared" }] },
      },
      { user: USER },
    );
    createClient.mockResolvedValue(user);

    const res = await GET();
    const body = await res.json();

    expect(body.items[0].application_url).toBe("https://mine.example/1");
    expect(body.items[0].positions).toMatchObject({ url: "https://acme.example/shared" });
    // No override on this row -- must come back null, not silently dropped
    // (dropped would read `undefined`, which is NOT what `toBeNull()` below
    // accepts; this pins the shape, not merely its truthiness).
    expect(body.items[1].application_url).toBeNull();
  });
});
