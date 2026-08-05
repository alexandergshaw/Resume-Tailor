import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { normalizePostingRows, fetchPracticePostings } from "./postings";
import { createClient } from "@/lib/supabase/client";

// Minimal chainable double for `supabase.from("applications").select(...).eq(...)`
// etc. Records every filter/order call so tests can assert the query shape
// (which mirrors the Tracking table's query), not just the resolved rows.
function makeFakeSupabase({ user = null, userError = null, data = [], queryError = null } = {}) {
  const calls = { from: [], select: [], eq: [], neq: [], order: [] };
  const builder = {
    select: vi.fn((...args) => {
      calls.select.push(args);
      return builder;
    }),
    eq: vi.fn((...args) => {
      calls.eq.push(args);
      return builder;
    }),
    neq: vi.fn((...args) => {
      calls.neq.push(args);
      return builder;
    }),
    order: vi.fn((...args) => {
      calls.order.push(args);
      return builder;
    }),
    // Lets `await supabase.from(...)....order(...)` resolve without a
    // terminal `.single()`/`.limit()` call, same as the real query builder.
    then: (resolve, reject) => Promise.resolve({ data, error: queryError }).then(resolve, reject),
  };
  return {
    calls,
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: userError })),
    },
    from: vi.fn((table) => {
      calls.from.push(table);
      return builder;
    }),
  };
}

describe("normalizePostingRows", () => {
  it("drops rows with no joined position", () => {
    const rows = [
      { id: "1", applied_at: "2024-01-01", positions: null },
      { id: "2", applied_at: "2024-01-02" },
    ];
    expect(normalizePostingRows(rows)).toEqual([]);
  });

  it("drops rows whose joined position has neither a title nor a company", () => {
    const rows = [
      { id: "1", applied_at: "2024-01-01", positions: { title: "", company: "   " } },
    ];
    expect(normalizePostingRows(rows)).toEqual([]);
  });

  it("labels a row with both title and company joined by an em dash", () => {
    const rows = [
      { id: "1", applied_at: "2024-01-01", positions: { title: "Engineer", company: "Acme" } },
    ];
    expect(normalizePostingRows(rows)[0].label).toBe("Engineer — Acme");
  });

  it("degrades the label to the title alone when the company is missing", () => {
    const rows = [
      { id: "1", applied_at: "2024-01-01", positions: { title: "Engineer", company: "" } },
    ];
    expect(normalizePostingRows(rows)[0].label).toBe("Engineer");
  });

  it("degrades the label to the company alone when the title is missing", () => {
    const rows = [
      { id: "1", applied_at: "2024-01-01", positions: { title: "", company: "Acme" } },
    ];
    expect(normalizePostingRows(rows)[0].label).toBe("Acme");
  });

  it("collapses duplicates on title+company case-insensitively, keeping the row with the newest applied_at regardless of input order", () => {
    const older = {
      id: "old",
      applied_at: "2024-01-01T00:00:00Z",
      positions: { title: "Engineer", company: "Acme" },
    };
    const newer = {
      id: "new",
      applied_at: "2024-06-01T00:00:00Z",
      positions: { title: "ENGINEER", company: "acme" },
    };

    const newerFirst = normalizePostingRows([newer, older]);
    expect(newerFirst).toHaveLength(1);
    expect(newerFirst[0].id).toBe("new");

    const olderFirst = normalizePostingRows([older, newer]);
    expect(olderFirst).toHaveLength(1);
    expect(olderFirst[0].id).toBe("new");
  });

  it("includes a row with a missing applied_at but sorts it after rows with a valid applied_at", () => {
    const dated = {
      id: "dated",
      applied_at: "2024-01-01T00:00:00Z",
      positions: { title: "A", company: "X" },
    };
    const undated = { id: "undated", applied_at: null, positions: { title: "B", company: "Y" } };

    const result = normalizePostingRows([undated, dated]);
    expect(result.map((p) => p.id)).toEqual(["dated", "undated"]);
  });

  it("includes a row with an unparseable applied_at but sorts it after rows with a valid applied_at", () => {
    const dated = {
      id: "dated",
      applied_at: "2024-01-01T00:00:00Z",
      positions: { title: "A", company: "X" },
    };
    const bad = {
      id: "bad",
      applied_at: "not-a-real-date",
      positions: { title: "B", company: "Y" },
    };

    const result = normalizePostingRows([bad, dated]);
    expect(result.map((p) => p.id)).toEqual(["dated", "bad"]);
  });

  it("returns [] for non-array input instead of throwing", () => {
    expect(normalizePostingRows(null)).toEqual([]);
    expect(normalizePostingRows(undefined)).toEqual([]);
    expect(normalizePostingRows("not-an-array")).toEqual([]);
    expect(normalizePostingRows({ positions: {} })).toEqual([]);
  });

  it("defaults description and url to empty strings when the joined position omits them", () => {
    const rows = [
      { id: "1", applied_at: "2024-01-01", positions: { title: "Engineer", company: "Acme" } },
    ];
    const [posting] = normalizePostingRows(rows);
    expect(posting.description).toBe("");
    expect(posting.url).toBe("");
  });
});

describe("fetchPracticePostings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] and never queries applications when there is no signed-in user", async () => {
    const fake = makeFakeSupabase({ user: null, userError: null });
    createClient.mockReturnValue(fake);

    const result = await fetchPracticePostings();

    expect(result).toEqual([]);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("throws the auth error message instead of treating it as signed-out", async () => {
    const fake = makeFakeSupabase({ user: null, userError: { message: "network down" } });
    createClient.mockReturnValue(fake);

    await expect(fetchPracticePostings()).rejects.toThrow("network down");
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("throws the Supabase message when the query errors", async () => {
    const fake = makeFakeSupabase({
      user: { id: "u1" },
      queryError: { message: "constraint boom" },
    });
    createClient.mockReturnValue(fake);

    await expect(fetchPracticePostings()).rejects.toThrow("constraint boom");
  });

  it("queries applications scoped to the user, excluding tracking and auto_tailored, newest applied_at first", async () => {
    const rows = [
      { id: "1", applied_at: "2024-01-01", positions: { title: "Engineer", company: "Acme" } },
    ];
    const fake = makeFakeSupabase({ user: { id: "u1" }, data: rows });
    createClient.mockReturnValue(fake);

    const result = await fetchPracticePostings();

    expect(fake.from).toHaveBeenCalledWith("applications");
    expect(fake.calls.eq).toContainEqual(["user_id", "u1"]);
    expect(fake.calls.neq).toContainEqual(["status", "tracking"]);
    expect(fake.calls.neq).toContainEqual(["status", "auto_tailored"]);
    expect(fake.calls.order).toContainEqual(["applied_at", { ascending: false }]);

    // The raw rows still went through normalizePostingRows on the way out.
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Engineer — Acme");
  });
});
