import { describe, it, expect } from "vitest";
import {
  toLowerList,
  postingText,
  matchesAllKeywords,
  matchesNoExcludedTitleKeywords,
  matchesNoExcludedCompany,
  passesMaxYears,
  postingExternalId,
  postingToJob,
  selectQueueCandidates,
} from "./selectQueueCandidates.js";

function posting(overrides = {}) {
  return {
    source_posting_id: "gh-1",
    title: "Senior Software Engineer",
    company: "Acme Corp",
    location: "Remote",
    remote_type: "remote",
    description_snippet: "Build great things with React and Node.",
    min_years_required: null,
    url: "https://example.com/job/1",
    posted_at: "2026-06-01T00:00:00Z",
    raw_data: { id: "gh-1", description: "We need 3 years of experience with React and Node." },
    ...overrides,
  };
}

describe("toLowerList", () => {
  it("lowercases, trims, and drops empties/non-strings", () => {
    expect(toLowerList([" React ", "NODE", "", 5, null])).toEqual(["react", "node"]);
  });
  it("returns [] for non-arrays", () => {
    expect(toLowerList(undefined)).toEqual([]);
    expect(toLowerList("react")).toEqual([]);
  });
});

describe("postingText", () => {
  it("combines title and raw_data.description, lowercased", () => {
    expect(postingText(posting())).toContain("senior software engineer");
    expect(postingText(posting())).toContain("3 years");
  });
  it("falls back to description_snippet when no raw_data description", () => {
    const p = posting({ raw_data: { id: "gh-1" } });
    expect(postingText(p)).toContain("react and node");
  });
  it("returns '' for invalid input", () => {
    expect(postingText(null)).toBe("");
  });
});

describe("matchesAllKeywords", () => {
  it("returns true when no keywords given", () => {
    expect(matchesAllKeywords(posting(), [])).toBe(true);
  });
  it("requires every keyword to be present", () => {
    expect(matchesAllKeywords(posting(), ["react", "node"])).toBe(true);
    expect(matchesAllKeywords(posting(), ["react", "python"])).toBe(false);
  });
});

describe("matchesNoExcludedTitleKeywords", () => {
  it("rejects when an excluded keyword is in the title", () => {
    expect(matchesNoExcludedTitleKeywords(posting(), ["senior"])).toBe(false);
    expect(matchesNoExcludedTitleKeywords(posting(), ["intern"])).toBe(true);
  });
});

describe("matchesNoExcludedCompany", () => {
  it("rejects matching companies by substring", () => {
    expect(matchesNoExcludedCompany(posting(), ["acme"])).toBe(false);
    expect(matchesNoExcludedCompany(posting(), ["globex"])).toBe(true);
  });
});

describe("passesMaxYears", () => {
  it("passes when cap is 'any' or missing", () => {
    expect(passesMaxYears(posting(), "any")).toBe(true);
    expect(passesMaxYears(posting(), null)).toBe(true);
  });
  it("uses persisted min_years_required when present", () => {
    expect(passesMaxYears(posting({ min_years_required: 8 }), "5")).toBe(false);
    expect(passesMaxYears(posting({ min_years_required: 3 }), "5")).toBe(true);
  });
  it("falls back to parsing text when min_years_required is null", () => {
    const p = posting({ raw_data: { id: "gh-1", description: "Requires 10 years experience." } });
    expect(passesMaxYears(p, "5")).toBe(false);
  });
  it("does not over-filter when no years mentioned", () => {
    const p = posting({ raw_data: { id: "gh-1", description: "Great team." } });
    expect(passesMaxYears(p, "5")).toBe(true);
  });
});

describe("postingExternalId", () => {
  it("prefers source_posting_id", () => {
    expect(postingExternalId(posting())).toBe("gh-1");
  });
  it("falls back to raw_data.id", () => {
    expect(postingExternalId(posting({ source_posting_id: null }))).toBe("gh-1");
  });
  it("returns '' for invalid input", () => {
    expect(postingExternalId(null)).toBe("");
  });
});

describe("postingToJob", () => {
  it("maps a feed posting into the upsertPosition job shape", () => {
    const job = postingToJob(posting());
    expect(job).toMatchObject({
      id: "gh-1",
      title: "Senior Software Engineer",
      company: "Acme Corp",
      isRemote: true,
      url: "https://example.com/job/1",
    });
  });
  it("falls back to description_snippet when raw_data is absent", () => {
    const job = postingToJob(posting({ raw_data: null }));
    expect(job.id).toBe("gh-1");
    expect(job.description).toBe("Build great things with React and Node.");
  });
});

describe("selectQueueCandidates", () => {
  const savedSearch = {
    job_keywords: ["react"],
    excluded_title_keywords: ["intern"],
    excluded_companies: ["globex"],
    max_years_exp: "5",
  };

  it("returns [] when cap is 0 or invalid", () => {
    expect(selectQueueCandidates([posting()], savedSearch, new Set(), 0)).toEqual([]);
    expect(selectQueueCandidates([posting()], savedSearch, new Set(), NaN)).toEqual([]);
  });

  it("filters by keywords, excludes, and year cap", () => {
    const list = [
      posting({ source_posting_id: "gh-1" }), // matches
      posting({ source_posting_id: "gh-2", title: "React Intern" }), // excluded title
      posting({ source_posting_id: "gh-3", company: "Globex" }), // excluded company
      posting({ source_posting_id: "gh-4", min_years_required: 9 }), // over cap
      posting({ source_posting_id: "gh-5", raw_data: { id: "gh-5", description: "Python only" } }), // no keyword
    ];
    const out = selectQueueCandidates(list, savedSearch, new Set(), 10);
    expect(out.map(postingExternalId)).toEqual(["gh-1"]);
  });

  it("skips already-queued ids", () => {
    const list = [posting({ source_posting_id: "gh-1" }), posting({ source_posting_id: "gh-9" })];
    const out = selectQueueCandidates(list, savedSearch, new Set(["gh-1"]), 10);
    expect(out.map(postingExternalId)).toEqual(["gh-9"]);
  });

  it("dedups repeated external ids within the batch", () => {
    const list = [posting({ source_posting_id: "gh-1" }), posting({ source_posting_id: "gh-1" })];
    const out = selectQueueCandidates(list, savedSearch, new Set(), 10);
    expect(out).toHaveLength(1);
  });

  it("respects the cap", () => {
    const list = [
      posting({ source_posting_id: "gh-1" }),
      posting({ source_posting_id: "gh-2" }),
      posting({ source_posting_id: "gh-3" }),
    ];
    const out = selectQueueCandidates(list, savedSearch, new Set(), 2);
    expect(out).toHaveLength(2);
  });
});
