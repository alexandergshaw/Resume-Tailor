import { describe, it, expect } from "vitest";
import { postingToJob } from "@/lib/feed/selectQueueCandidates";
import { jobToPositionRow } from "@/lib/feed/tailorAndQueue";

// R-202 recorded the defect this pins: `positions.source` was inferred from an
// id prefix (`gh-` => greenhouse, everything else => jsearch), and postingToJob
// dropped the feed row's real source on the floor. Lever, Ashby and RSS
// postings have therefore all been recorded as jsearch, and an AI-search
// posting would inherit the same lie.

const feedRow = (over = {}) => ({
  source: "ai_search",
  source_posting_id: "ai-abc123",
  title: "Senior React Engineer",
  company: "Acme",
  location: "Remote",
  remote_type: "remote",
  url: "https://acme.com/jobs/1",
  raw_data: { description: "Responsibilities: ship things." },
  ...over,
});

describe("postingToJob", () => {
  it("carries the feed row's source through to the job", () => {
    expect(postingToJob(feedRow()).source).toBe("ai_search");
  });

  it("still maps every field it mapped before", () => {
    // Guard against the source addition being made by rewriting the mapper.
    const job = postingToJob(feedRow());
    expect(job).toMatchObject({
      id: "ai-abc123",
      title: "Senior React Engineer",
      company: "Acme",
      location: "Remote",
      isRemote: true,
      url: "https://acme.com/jobs/1",
      description: "Responsibilities: ship things.",
    });
  });
});

describe("jobToPositionRow", () => {
  it("records the real source when the job carries one", () => {
    expect(jobToPositionRow(postingToJob(feedRow())).source).toBe("ai_search");
  });

  it("records lever and ashby honestly instead of calling them jsearch", () => {
    expect(jobToPositionRow(postingToJob(feedRow({ source: "lever" }))).source).toBe("lever");
    expect(jobToPositionRow(postingToJob(feedRow({ source: "ashby" }))).source).toBe("ashby");
  });

  it("keeps the legacy inference for a job with no source at all", () => {
    // The single-posting API route and any older caller still hand over a job
    // built elsewhere; their behaviour must not change.
    expect(jobToPositionRow({ id: "gh-123" }).source).toBe("greenhouse");
    expect(jobToPositionRow({ id: "xyz-9" }).source).toBe("jsearch");
  });

  it("still sets external_id from the job id", () => {
    expect(jobToPositionRow({ id: "gh-123" }).external_id).toBe("gh-123");
  });
});
