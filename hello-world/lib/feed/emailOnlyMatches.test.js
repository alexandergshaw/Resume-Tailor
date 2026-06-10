import { describe, it, expect } from "vitest";
import { selectEmailOnlyJobs } from "./emailOnlyMatches.js";

// Build a minimal feed_postings-like row.
function posting(overrides = {}) {
  return {
    id: overrides.id || "row-1",
    source_posting_id: overrides.source_posting_id || "gh-1",
    title: overrides.title || "Senior Software Engineer",
    company: overrides.company || "Acme Corp",
    location: overrides.location || "Remote",
    url: overrides.url || "https://example.com/job/1",
    min_years_required: overrides.min_years_required ?? null,
    raw_data: overrides.raw_data || { id: overrides.source_posting_id || "gh-1", description: "" },
    ...overrides,
  };
}

// Build a saved_searches-like row.
function search(overrides = {}) {
  return {
    id: "ss-1",
    name: "Backend roles",
    job_keywords: [],
    excluded_title_keywords: [],
    excluded_companies: [],
    max_years_exp: "any",
    email_on_new_jobs: true,
    notify_email: null,
    auto_tailor_enabled: false,
    ...overrides,
  };
}

describe("selectEmailOnlyJobs", () => {
  it("emails matches even when auto-tailor is off", () => {
    const postings = [posting({ source_posting_id: "gh-1" })];
    const { jobs, externalIds } = selectEmailOnlyJobs(
      postings,
      [search({ auto_tailor_enabled: false })],
      new Set(),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      title: "Senior Software Engineer",
      company: "Acme Corp",
      savedSearchName: "Backend roles",
      emailOnNewJobs: true,
      externalId: "gh-1",
    });
    expect(externalIds).toEqual(["gh-1"]);
  });

  it("skips postings already notified", () => {
    const postings = [
      posting({ source_posting_id: "gh-1" }),
      posting({ id: "row-2", source_posting_id: "gh-2", title: "Backend Engineer" }),
    ];
    const { jobs, externalIds } = selectEmailOnlyJobs(
      postings,
      [search()],
      new Set(["gh-1"]),
    );
    expect(jobs).toHaveLength(1);
    expect(externalIds).toEqual(["gh-2"]);
  });

  it("never returns the same posting twice across searches", () => {
    const postings = [posting({ source_posting_id: "gh-1" })];
    const searches = [
      search({ id: "ss-1", name: "Search A" }),
      search({ id: "ss-2", name: "Search B" }),
    ];
    const { jobs, externalIds } = selectEmailOnlyJobs(postings, searches, new Set());
    expect(jobs).toHaveLength(1);
    expect(externalIds).toEqual(["gh-1"]);
  });

  it("ignores searches that did not opt into email", () => {
    const postings = [posting({ source_posting_id: "gh-1" })];
    const { jobs } = selectEmailOnlyJobs(
      postings,
      [search({ email_on_new_jobs: false })],
      new Set(),
    );
    expect(jobs).toEqual([]);
  });

  it("applies keyword and exclusion filters", () => {
    const postings = [
      posting({ source_posting_id: "gh-1", title: "Senior Backend Engineer" }),
      posting({ id: "row-2", source_posting_id: "gh-2", title: "Frontend Intern" }),
    ];
    const { jobs } = selectEmailOnlyJobs(
      postings,
      [search({ job_keywords: ["backend"], excluded_title_keywords: ["intern"] })],
      new Set(),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].externalId).toBe("gh-1");
  });

  it("passes the per-search notify_email override through", () => {
    const postings = [posting({ source_posting_id: "gh-1" })];
    const { jobs } = selectEmailOnlyJobs(
      postings,
      [search({ notify_email: "me@override.com" })],
      new Set(),
    );
    expect(jobs[0].notifyEmail).toBe("me@override.com");
  });

  it("returns empty for no postings or no searches", () => {
    expect(selectEmailOnlyJobs([], [search()], new Set()).jobs).toEqual([]);
    expect(selectEmailOnlyJobs([posting()], [], new Set()).jobs).toEqual([]);
  });
});
