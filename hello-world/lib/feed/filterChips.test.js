// `buildFilterChips` and `countActiveFilters` came out of LiveFeedTab.js
// unchanged, so this file's job is to pin the behaviour the inline versions had
// -- ordering, labels, keys, what each `onDelete` actually removes, and the
// deliberate difference between the chip count and the badge count -- rather
// than to describe a new contract. Nothing could reach these branches before:
// they live inside the filter panel (now a phone sheet) on a component that
// owns four fetches and two intervals.

import { describe, it, expect, vi } from "vitest";
import { buildFilterChips, countActiveFilters } from "./filterChips.js";
import { DEFAULT_FILTERS, DEFAULT_ADVANCED } from "./liveFeedClient.js";

function setters() {
  return {
    updateFilter: vi.fn(),
    setMaxYearsExp: vi.fn(),
    setJobKeywords: vi.fn(),
    setSelectedCategories: vi.fn(),
    setSelectedCompanies: vi.fn(),
    setExcludedCompanies: vi.fn(),
    setExcludedTitleKeywords: vi.fn(),
  };
}

const build = (filters = {}, advanced = {}, s = setters()) => ({
  chips: buildFilterChips({
    filters: { ...DEFAULT_FILTERS, ...filters },
    advanced: { ...DEFAULT_ADVANCED, ...advanced },
    ...s,
  }),
  s,
});

describe("buildFilterChips - what is shown", () => {
  it("returns nothing when no filter is applied", () => {
    // `maxYearsExp` defaults to the string "any", which is truthy -- the guard
    // that has to compare against it, not just check for a value.
    expect(build().chips).toEqual([]);
  });

  it("quotes the free-text query and passes location through as-is", () => {
    const { chips } = build({ q: "staff engineer", location: "London" });
    expect(chips.map((c) => c.key)).toEqual(["q", "location"]);
    expect(chips[0].label).toBe("“staff engineer”");
    expect(chips[1].label).toBe("London");
  });

  it("maps remote and since through their label tables", () => {
    const { chips } = build({ remote: "hybrid", since: "7" });
    expect(chips.map((c) => c.label)).toEqual(["Hybrid", "Last 7 days"]);
  });

  it("falls back to the raw value for a remote/since value with no label", () => {
    // A label table that has not caught up must not blank the chip out --
    // an unlabelled filter the user cannot see is one they cannot remove.
    const { chips } = build({ remote: "flexible", since: "90" });
    expect(chips.map((c) => c.label)).toEqual(["flexible", "Since 90d"]);
  });

  it("shows a years-of-experience chip only when it is not 'any'", () => {
    expect(build({}, { maxYearsExp: "any" }).chips).toEqual([]);
    const { chips } = build({}, { maxYearsExp: "5" });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("≤ 5 yrs");
  });

  it("emits one chip per keyword, category and company, marking the exclusions", () => {
    const { chips } = build(
      {},
      {
        jobKeywords: ["react", "node"],
        selectedCategories: ["Engineering"],
        selectedCompanies: [{ slug: "acme", name: "Acme" }, "Freeform Co"],
        excludedCompanies: [{ slug: "zzz", name: "Zzz Corp" }],
        excludedTitleKeywords: ["intern"],
      },
    );
    expect(chips.map((c) => c.label)).toEqual([
      "react",
      "node",
      "Engineering",
      "Acme",
      "Freeform Co",
      "Exclude: Zzz Corp",
      "Exclude: intern",
    ]);
    // Keys must stay unique -- they are React list keys, and an exclusion
    // sharing a company's key would collide with the inclusion chip.
    expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
    expect(chips.map((c) => c.key)).toContain("exco:Zzz Corp");
    expect(chips.map((c) => c.key)).toContain("co:Acme");
  });

  it("orders quick filters before advanced ones", () => {
    const { chips } = build({ q: "x" }, { jobKeywords: ["y"] });
    expect(chips.map((c) => c.key)).toEqual(["q", "kw:y"]);
  });
});

describe("buildFilterChips - what each onDelete removes", () => {
  it("clears a quick filter by writing an empty string through updateFilter", () => {
    const { chips, s } = build({ q: "x", location: "L", remote: "remote", since: "1" });
    for (const chip of chips) chip.onDelete();
    expect(s.updateFilter.mock.calls).toEqual([
      ["q", ""],
      ["location", ""],
      ["remote", ""],
      ["since", ""],
    ]);
  });

  it("resets years of experience to 'any' rather than to empty", () => {
    const { chips, s } = build({}, { maxYearsExp: "3" });
    chips[0].onDelete();
    expect(s.setMaxYearsExp).toHaveBeenCalledWith("any");
  });

  it("removes only the chip's own list entry, leaving the rest", () => {
    const { chips, s } = build({}, { jobKeywords: ["react", "node", "go"] });
    chips[1].onDelete();
    expect(s.setJobKeywords).toHaveBeenCalledWith(["react", "go"]);
  });

  it("matches companies by display name, so {slug,name} and freeform entries both delete", () => {
    const acme = { slug: "acme", name: "Acme" };
    const { chips, s } = build({}, { selectedCompanies: [acme, "Freeform Co"] });
    chips[0].onDelete();
    expect(s.setSelectedCompanies).toHaveBeenCalledWith(["Freeform Co"]);
    chips[1].onDelete();
    expect(s.setSelectedCompanies).toHaveBeenLastCalledWith([acme]);
  });

  it("routes an exclusion's delete to the exclusion setter, not the inclusion one", () => {
    const { chips, s } = build(
      {},
      {
        selectedCompanies: [{ slug: "acme", name: "Acme" }],
        excludedCompanies: [{ slug: "zzz", name: "Zzz Corp" }],
        excludedTitleKeywords: ["intern", "junior"],
      },
    );
    chips.find((c) => c.key === "exco:Zzz Corp").onDelete();
    expect(s.setExcludedCompanies).toHaveBeenCalledWith([]);
    expect(s.setSelectedCompanies).not.toHaveBeenCalled();

    chips.find((c) => c.key === "exkw:junior").onDelete();
    expect(s.setExcludedTitleKeywords).toHaveBeenCalledWith(["intern"]);
  });
});

describe("countActiveFilters - the toolbar badge", () => {
  const count = (filters = {}, advanced = {}) =>
    countActiveFilters({
      filters: { ...DEFAULT_FILTERS, ...filters },
      advanced: { ...DEFAULT_ADVANCED, ...advanced },
    });

  it("is zero for the defaults, including maxYearsExp's truthy 'any'", () => {
    expect(count()).toBe(0);
  });

  it("counts each LIST as one filter, not one per entry", () => {
    // This is the whole reason it is not `buildFilterChips(...).length`: eight
    // keywords are one active filter on the badge and eight removable chips.
    const advanced = { jobKeywords: ["a", "b", "c"], selectedCategories: ["x", "y"] };
    expect(count({}, advanced)).toBe(2);
    expect(build({}, advanced).chips).toHaveLength(5);
  });

  it("counts each quick filter separately", () => {
    expect(count({ q: "a", location: "b", remote: "remote", since: "7" })).toBe(4);
  });

  it("counts every advanced list plus the years bound", () => {
    expect(
      count(
        {},
        {
          jobKeywords: ["a"],
          maxYearsExp: "5",
          selectedCategories: ["x"],
          selectedCompanies: ["y"],
          excludedCompanies: [{ slug: "z", name: "Z" }],
          excludedTitleKeywords: ["intern"],
        },
      ),
    ).toBe(6);
  });

  it("does not count an empty list or an empty query string", () => {
    expect(count({ q: "" }, { jobKeywords: [], selectedCompanies: [] })).toBe(0);
  });
});

describe("buildFilterChips - missing list fields", () => {
  it("treats an absent array as empty rather than throwing", () => {
    // The advanced object is restored from localStorage, so a value written by
    // an older build can be missing keys the current one reads.
    const chips = buildFilterChips({
      filters: DEFAULT_FILTERS,
      advanced: { maxYearsExp: "any" },
      ...setters(),
    });
    expect(chips).toEqual([]);
  });
});
