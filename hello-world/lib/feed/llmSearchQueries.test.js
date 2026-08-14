import { describe, it, expect } from "vitest";
import { buildSearchQueries } from "@/lib/feed/llmSearchQueries";

// `feed_postings` is global (R-202), and a grounded search costs a model call,
// so queries are derived from saved searches ONCE and shared across every user
// who asked for the same thing.

const search = (over = {}) => ({
  id: "s1",
  user_id: "u1",
  name: "Remote React",
  job_keywords: ["react", "remote"],
  excluded_title_keywords: [],
  excluded_companies: [],
  max_years_exp: "any",
  auto_tailor_enabled: true,
  email_on_new_jobs: false,
  ...over,
});

describe("buildSearchQueries", () => {
  it("builds one query carrying the saved search's keywords", () => {
    const [q] = buildSearchQueries([search()]);
    expect(q.keywords).toEqual(["react", "remote"]);
    expect(q.query.toLowerCase()).toContain("react");
    expect(q.query.toLowerCase()).toContain("remote");
  });

  it("collapses two users asking for the same thing into a single query", () => {
    const queries = buildSearchQueries([
      search({ id: "s1", user_id: "u1", job_keywords: ["react", "remote"] }),
      search({ id: "s2", user_id: "u2", job_keywords: ["Remote", "REACT"] }),
    ]);
    expect(queries).toHaveLength(1);
  });

  // Positive control for the dedupe above: an implementation that always
  // returns one query would pass that test while destroying the feature.
  it("keeps genuinely different searches as separate queries", () => {
    const queries = buildSearchQueries([
      search({ id: "s1", job_keywords: ["react"] }),
      search({ id: "s2", job_keywords: ["rust"] }),
    ]);
    expect(queries).toHaveLength(2);
    expect(queries.map((q) => q.key)).toHaveLength(new Set(queries.map((q) => q.key)).size);
  });

  it("skips a search with no usable keywords", () => {
    // An empty query returns whatever the web feels like and would poison a
    // global table for every user.
    expect(buildSearchQueries([search({ job_keywords: [] })])).toEqual([]);
    expect(buildSearchQueries([search({ job_keywords: ["   ", ""] })])).toEqual([]);
    expect(buildSearchQueries([search({ job_keywords: null })])).toEqual([]);
  });

  it("ignores searches that asked for no automated work at all", () => {
    expect(
      buildSearchQueries([search({ auto_tailor_enabled: false, email_on_new_jobs: false })]),
    ).toEqual([]);
    expect(
      buildSearchQueries([search({ auto_tailor_enabled: false, email_on_new_jobs: true })]),
    ).toHaveLength(1);
  });

  it("caps the number of queries per run", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      search({ id: `s${i}`, job_keywords: [`skill${i}`] }),
    );
    expect(buildSearchQueries(many, { maxQueries: 3 })).toHaveLength(3);
  });

  it("caps at the default of 3 when maxQueries is not passed, since that's what production uses", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      search({ id: `s${i}`, job_keywords: [`skill${i}`] }),
    );
    expect(buildSearchQueries(many)).toHaveLength(3);
  });

  it("carries the search's exclusions and experience cap through", () => {
    const [q] = buildSearchQueries([
      search({ excluded_title_keywords: ["Senior"], excluded_companies: ["Initech"], max_years_exp: "5" }),
    ]);
    expect(q.excludedTitleKeywords).toEqual(["senior"]);
    expect(q.excludedCompanies).toEqual(["initech"]);
    expect(q.maxYears).toBe("5");
  });

  it("returns [] for junk input rather than throwing", () => {
    for (const bad of [null, undefined, "nope", {}, [null, 3]]) {
      expect(buildSearchQueries(bad)).toEqual([]);
    }
  });
});
