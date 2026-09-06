import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase, fakeBlob } from "../../test/helpers/supabaseMock.js";

// --- Module mocks -----------------------------------------------------------
vi.mock("@/lib/llm/tailorForUserHeadless", () => ({
  tailorResumeHeadless: vi.fn(),
  tailorCoverLetterHeadless: vi.fn(),
}));
vi.mock("@/lib/supabase/upsertApplication", () => ({
  upsertApplication: vi.fn(),
}));
vi.mock("@/lib/supabase/saveGeneratedResume", () => ({
  saveGeneratedResume: vi.fn(),
}));
vi.mock("@/lib/supabase/saveGeneratedCoverLetter", () => ({
  saveGeneratedCoverLetter: vi.fn(),
}));
vi.mock("@/lib/feed/selectQueueCandidates", () => ({
  postingToJob: vi.fn(),
}));

import {
  tailorAndQueueOne,
  loadAlreadyTrackedExternalIds,
  loadStorageBuffer,
  markFeedSaved,
} from "./tailorAndQueue.js";
import { tailorResumeHeadless, tailorCoverLetterHeadless } from "@/lib/llm/tailorForUserHeadless";
import { upsertApplication } from "@/lib/supabase/upsertApplication";
import { saveGeneratedResume } from "@/lib/supabase/saveGeneratedResume";
import { saveGeneratedCoverLetter } from "@/lib/supabase/saveGeneratedCoverLetter";
import { postingToJob } from "@/lib/feed/selectQueueCandidates";

const JOB = {
  id: "gh-1",
  title: "Senior Engineer",
  company: "Acme",
  location: "Remote",
  description: "Build things",
  url: "https://example.com/job/1",
};

function setHappyDefaults() {
  postingToJob.mockReturnValue({ ...JOB });
  tailorResumeHeadless.mockResolvedValue({ result: "RESUME TEXT", resultLines: ["a", "b"], jobTitle: "Senior Engineer" });
  tailorCoverLetterHeadless.mockResolvedValue({ result: "COVER TEXT", resultLines: ["c"] });
  saveGeneratedResume.mockResolvedValue("gen-resume-1");
  saveGeneratedCoverLetter.mockResolvedValue("gen-cover-1");
  upsertApplication.mockResolvedValue("app-1");
}

beforeEach(() => {
  vi.clearAllMocks();
  setHappyDefaults();
});

describe("tailorAndQueueOne", () => {
  it("tailors the resume and parks the application as auto_queued", async () => {
    const admin = makeSupabase({
      positions: { data: { id: "pos-1" } },
      applications: { data: null, error: null },
      feed_user_state: { data: null, error: null },
    });

    const result = await tailorAndQueueOne({
      admin,
      userId: "user-1",
      posting: { id: "feed-1" },
      resumeBuffer: Buffer.from("resume"),
      coverLetterBuffer: Buffer.from("cover"),
      savedSearchId: "search-1",
      sourceLabel: "the Live Feed",
    });

    expect(result).toMatchObject({
      applicationId: "app-1",
      positionId: "pos-1",
      generatedResumeId: "gen-resume-1",
      coverLetterId: "gen-cover-1",
      title: "Senior Engineer",
      company: "Acme",
      url: "https://example.com/job/1",
    });

    // upsertApplication created the row as "tracking" first.
    expect(upsertApplication).toHaveBeenCalledWith(admin, {
      userId: "user-1",
      positionId: "pos-1",
      status: "tracking",
    });

    // The metadata UPDATE runs FIRST and names no status at all — the queue
    // placement is a separate statement (below), guarded by the writer's
    // allow-list, so a race with a status change elsewhere can never see a
    // half-applied metadata write silently reinterpreted as a status claim.
    // See lib/feed/tailorAndQueue.js and 3-plan-dataloss.md PART 4 / F-7/F-8.
    const metadataArgs = admin.calls.applications.update[0][0];
    expect(metadataArgs).toMatchObject({
      resume_used_id: "gen-resume-1",
      cover_letter_id: "gen-cover-1",
      auto_search_id: "search-1",
    });
    expect(metadataArgs.status).toBeUndefined();
    expect(metadataArgs.auto_saved_at).toBeTruthy();

    // The SECOND update is the queue placement itself, issued by
    // writeApplicationStatus's guarded UPDATE (C1) — it is unmocked here, so
    // this is the real allow-list running against `makeSupabase`.
    const statusArgs = admin.calls.applications.update[1][0];
    expect(statusArgs).toEqual({ status: "auto_queued" });

    // markFeedSaved upserted feed_user_state for the source posting.
    expect(admin.calls.feed_user_state.upsert.length).toBe(1);
  });

  it("throws when the posting has no stable id", async () => {
    postingToJob.mockReturnValue({ id: "", title: "x" });
    const admin = makeSupabase({});
    await expect(
      tailorAndQueueOne({ admin, userId: "u", posting: {}, resumeBuffer: Buffer.from("r") }),
    ).rejects.toThrow(/missing a stable id/i);
  });

  it("throws when the position upsert returns no id", async () => {
    const admin = makeSupabase({ positions: { data: { id: null } } });
    await expect(
      tailorAndQueueOne({ admin, userId: "u", posting: {}, resumeBuffer: Buffer.from("r") }),
    ).rejects.toThrow(/no id returned/i);
  });

  it("throws when resume tailoring returns no content", async () => {
    tailorResumeHeadless.mockResolvedValue({ result: "" });
    const admin = makeSupabase({ positions: { data: { id: "pos-1" } } });
    await expect(
      tailorAndQueueOne({ admin, userId: "u", posting: {}, resumeBuffer: Buffer.from("r") }),
    ).rejects.toThrow(/returned no content/i);
  });

  it("throws when the final queue update errors", async () => {
    const admin = makeSupabase({
      positions: { data: { id: "pos-1" } },
      applications: { data: null, error: { message: "constraint boom" } },
    });
    await expect(
      tailorAndQueueOne({ admin, userId: "u", posting: {}, resumeBuffer: Buffer.from("r") }),
    ).rejects.toThrow(/Could not move the application into the queue: constraint boom/);
  });

  it("throws when upsertApplication fails", async () => {
    upsertApplication.mockResolvedValue(null);
    const admin = makeSupabase({ positions: { data: { id: "pos-1" } } });
    await expect(
      tailorAndQueueOne({ admin, userId: "u", posting: {}, resumeBuffer: Buffer.from("r") }),
    ).rejects.toThrow(/upsertApplication failed/i);
  });

  describe("cover letter (best-effort)", () => {
    it("skips the cover letter when no buffer is provided", async () => {
      const admin = makeSupabase({
        positions: { data: { id: "pos-1" } },
        applications: { data: null, error: null },
      });
      const result = await tailorAndQueueOne({
        admin,
        userId: "u",
        posting: {},
        resumeBuffer: Buffer.from("r"),
        coverLetterBuffer: null,
      });
      expect(tailorCoverLetterHeadless).not.toHaveBeenCalled();
      expect(result.coverLetterId).toBeNull();
    });

    it("swallows cover letter errors and still queues the resume", async () => {
      tailorCoverLetterHeadless.mockRejectedValue(new Error("LLM down"));
      const admin = makeSupabase({
        positions: { data: { id: "pos-1" } },
        applications: { data: null, error: null },
      });
      const result = await tailorAndQueueOne({
        admin,
        userId: "u",
        posting: {},
        resumeBuffer: Buffer.from("r"),
        coverLetterBuffer: Buffer.from("c"),
      });
      expect(result.coverLetterId).toBeNull();
      expect(result.generatedResumeId).toBe("gen-resume-1");
    });

    it("attaches the cover letter when tailoring succeeds", async () => {
      const admin = makeSupabase({
        positions: { data: { id: "pos-1" } },
        applications: { data: null, error: null },
      });
      const result = await tailorAndQueueOne({
        admin,
        userId: "u",
        posting: {},
        resumeBuffer: Buffer.from("r"),
        coverLetterBuffer: Buffer.from("c"),
      });
      expect(result.coverLetterId).toBe("gen-cover-1");
    });

    // jobPosting and jobPostingUrl are NOT additive (see
    // lib/feed/postingDescription.js's tailorPostingFields doc comment, and
    // commit aa98b17 which fixed the identical defect on the Live Feed path):
    // for Gemini the URL wins and the fetched text is discarded; for the
    // embedded engine the text wins. Sending both here throws away the full
    // `raw_data.description` this pipeline already selected and makes Gemini
    // re-fetch the URL instead -- slower, costlier, and worse when the fetch
    // fails. Exactly one of the two must reach tailorCoverLetterHeadless.
    describe("jobPosting/jobPostingUrl exclusivity (DEFECT 1)", () => {
      it("sends the full raw_data description as text, with no URL, when it's available", async () => {
        postingToJob.mockReturnValue({
          ...JOB,
          description: "The FULL posting text straight from raw_data.description.",
          url: "https://example.com/job/1",
        });
        const admin = makeSupabase({
          positions: { data: { id: "pos-1" } },
          applications: { data: null, error: null },
        });
        await tailorAndQueueOne({
          admin,
          userId: "u",
          posting: {
            id: "feed-1",
            raw_data: { description: "The FULL posting text straight from raw_data.description." },
          },
          resumeBuffer: Buffer.from("r"),
          coverLetterBuffer: Buffer.from("c"),
        });
        const callArgs = tailorCoverLetterHeadless.mock.calls[0][0];
        expect(callArgs.jobPosting).toBe("The FULL posting text straight from raw_data.description.");
        expect(callArgs.jobPostingUrl).toBe("");
      });

      it("sends only the URL, not the truncated snippet, when raw_data.description is missing", async () => {
        postingToJob.mockReturnValue({
          ...JOB,
          description: "A 400-character snippet…",
          url: "https://example.com/job/1",
        });
        const admin = makeSupabase({
          positions: { data: { id: "pos-1" } },
          applications: { data: null, error: null },
        });
        await tailorAndQueueOne({
          admin,
          userId: "u",
          // No raw_data.description -- postingToJob's own fallback means
          // job.description here is only the truncated description_snippet.
          posting: { id: "feed-1" },
          resumeBuffer: Buffer.from("r"),
          coverLetterBuffer: Buffer.from("c"),
        });
        const callArgs = tailorCoverLetterHeadless.mock.calls[0][0];
        expect(callArgs.jobPostingUrl).toBe("https://example.com/job/1");
        expect(callArgs.jobPosting).toBe("");
      });
    });
  });
});

describe("loadAlreadyTrackedExternalIds", () => {
  it("returns an empty set for empty input", async () => {
    const admin = makeSupabase({});
    const set = await loadAlreadyTrackedExternalIds(admin, "u", []);
    expect(set.size).toBe(0);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("returns the set of matched external ids", async () => {
    const admin = makeSupabase({
      positions: { data: [{ external_id: "gh-1" }, { external_id: "gh-2" }] },
    });
    const set = await loadAlreadyTrackedExternalIds(admin, "u", ["gh-1", "gh-2", "gh-3"]);
    expect([...set].sort()).toEqual(["gh-1", "gh-2"]);
  });

  it("applies a status filter only when statuses are provided", async () => {
    const admin = makeSupabase({ positions: { data: [] } });
    await loadAlreadyTrackedExternalIds(admin, "u", ["gh-1"], ["auto_queued", "applied"]);
    const inCalls = admin.calls.positions.in;
    // First .in() is on external_id; a second .in() applies the status filter.
    expect(inCalls).toContainEqual(["applications.status", ["auto_queued", "applied"]]);
  });

  it("does not apply a status filter when statuses is null", async () => {
    const admin = makeSupabase({ positions: { data: [] } });
    await loadAlreadyTrackedExternalIds(admin, "u", ["gh-1"], null);
    const statusFilter = admin.calls.positions.in.find((args) => args[0] === "applications.status");
    expect(statusFilter).toBeUndefined();
  });
});

describe("loadStorageBuffer", () => {
  it("returns a Buffer when the download succeeds", async () => {
    const admin = makeSupabase({}, { storage: { "user-1/resume": fakeBlob("hello") } });
    const buf = await loadStorageBuffer(admin, "user-1/resume");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe("hello");
  });

  it("returns null when the download errors", async () => {
    const admin = makeSupabase({}, { storage: { "user-1/resume": new Error("nope") } });
    const buf = await loadStorageBuffer(admin, "user-1/resume");
    expect(buf).toBeNull();
  });

  it("returns null when the file is missing", async () => {
    const admin = makeSupabase({}, { storage: {} });
    const buf = await loadStorageBuffer(admin, "user-1/missing");
    expect(buf).toBeNull();
  });
});

describe("markFeedSaved", () => {
  it("upserts feed_user_state with saved=true", async () => {
    const admin = makeSupabase({ feed_user_state: { data: null, error: null } });
    await markFeedSaved(admin, "user-1", "feed-1");
    expect(admin.calls.feed_user_state.upsert[0][0]).toEqual({
      user_id: "user-1",
      posting_id: "feed-1",
      saved: true,
    });
  });

  it("no-ops when there is no posting id", async () => {
    const admin = makeSupabase({});
    await markFeedSaved(admin, "user-1", null);
    expect(admin.from).not.toHaveBeenCalled();
  });
});
