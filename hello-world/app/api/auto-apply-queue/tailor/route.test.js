import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase, jsonRequest } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/feed/selectQueueCandidates", () => ({ postingExternalId: vi.fn() }));
vi.mock("@/lib/feed/tailorAndQueue", () => ({
  loadStorageBuffer: vi.fn(),
  loadAlreadyTrackedExternalIds: vi.fn(),
  tailorAndQueueOne: vi.fn(),
}));

import { POST } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { postingExternalId } from "@/lib/feed/selectQueueCandidates";
import {
  loadStorageBuffer,
  loadAlreadyTrackedExternalIds,
  tailorAndQueueOne,
} from "@/lib/feed/tailorAndQueue";

const USER = { id: "user-1" };

function setHappyDefaults() {
  createClient.mockResolvedValue(makeSupabase({}, { user: USER }));
  createAdminClient.mockReturnValue(
    makeSupabase({ feed_postings: { data: { id: "feed-1", title: "Eng", source_posting_id: "gh-1" } } }),
  );
  postingExternalId.mockReturnValue("");
  loadAlreadyTrackedExternalIds.mockResolvedValue(new Set());
  loadStorageBuffer.mockResolvedValue(Buffer.from("doc"));
  tailorAndQueueOne.mockResolvedValue({
    applicationId: "app-1",
    positionId: "pos-1",
    generatedResumeId: "res-1",
    coverLetterId: "cov-1",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setHappyDefaults();
});

describe("POST /api/auto-apply-queue/tailor", () => {
  it("returns 401 when not signed in", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));
    const res = await POST(jsonRequest({ postingId: "feed-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 500 when the admin client is unavailable", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("no service key");
    });
    const res = await POST(jsonRequest({ postingId: "feed-1" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/admin client unavailable/i);
  });

  it("returns 400 when no posting can be resolved", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/could not resolve the posting/i);
  });

  it("resolves a posting by feed id and returns the queued ids", async () => {
    const res = await POST(jsonRequest({ postingId: "feed-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      applicationId: "app-1",
      positionId: "pos-1",
      generatedResumeId: "res-1",
      coverLetterId: "cov-1",
    });
  });

  it("accepts an inline posting object", async () => {
    const res = await POST(jsonRequest({ posting: { source_posting_id: "gh-9", title: "Inline" } }));
    expect(res.status).toBe(200);
    const posted = tailorAndQueueOne.mock.calls[0][0].posting;
    expect(posted).toMatchObject({ source_posting_id: "gh-9" });
  });

  it("short-circuits when the posting is already queued or applied", async () => {
    postingExternalId.mockReturnValue("gh-1");
    loadAlreadyTrackedExternalIds.mockResolvedValue(new Set(["gh-1"]));
    const res = await POST(jsonRequest({ postingId: "feed-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadyQueued: true });
    expect(tailorAndQueueOne).not.toHaveBeenCalled();
    // Dedup is scoped to the active pipeline statuses only.
    expect(loadAlreadyTrackedExternalIds).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      ["gh-1"],
      ["auto_queued", "applied"],
    );
  });

  it("returns 400 when the user has no resume on file", async () => {
    loadStorageBuffer.mockResolvedValueOnce(null); // resume lookup fails
    const res = await POST(jsonRequest({ postingId: "feed-1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no resume found/i);
    expect(tailorAndQueueOne).not.toHaveBeenCalled();
  });

  it("passes the cover letter buffer through when present", async () => {
    loadStorageBuffer
      .mockResolvedValueOnce(Buffer.from("resume"))
      .mockResolvedValueOnce(Buffer.from("cover"));
    await POST(jsonRequest({ postingId: "feed-1" }));
    const args = tailorAndQueueOne.mock.calls[0][0];
    expect(Buffer.isBuffer(args.coverLetterBuffer)).toBe(true);
  });

  it("returns 500 when tailorAndQueueOne returns null", async () => {
    tailorAndQueueOne.mockResolvedValue(null);
    const res = await POST(jsonRequest({ postingId: "feed-1" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed to tailor and queue/i);
  });

  it("returns 500 when tailorAndQueueOne throws", async () => {
    tailorAndQueueOne.mockRejectedValue(new Error("tailoring exploded"));
    const res = await POST(jsonRequest({ postingId: "feed-1" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/tailoring exploded/i);
  });
});
