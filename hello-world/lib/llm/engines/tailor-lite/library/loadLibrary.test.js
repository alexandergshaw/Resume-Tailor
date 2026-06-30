import { describe, it, expect } from "vitest";
import { loadLibrary } from "./loadLibrary.js";
import { defaultLibraryData } from "./defaults.js";

// A minimal fake of the Supabase query builder: awaiting it yields the list result,
// and .maybeSingle() yields the single-row result. Enough for loadLibrary's reads.
function makeFakeSupabase(rows) {
  const builder = (single, list) => ({
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return Promise.resolve(single); },
    then(resolve, reject) { return Promise.resolve(list).then(resolve, reject); },
  });
  return {
    from(table) {
      if (table === "tailor_profile") {
        return builder({ data: rows.tailor_profile, error: null }, { data: [rows.tailor_profile], error: null });
      }
      return builder({ data: null, error: null }, { data: rows[table] || [], error: null });
    },
  };
}

describe("loadLibrary", () => {
  it("returns the bundled defaults when there is no userId", async () => {
    expect(await loadLibrary({})).toBe(defaultLibraryData);
    expect(await loadLibrary()).toBe(defaultLibraryData);
  });

  it("falls back to the bundled defaults when the DB read throws", async () => {
    const throwing = { from() { throw new Error("db down"); } };
    expect(await loadLibrary({ userId: "u-err", supabase: throwing })).toBe(defaultLibraryData);
  });

  it("falls back to defaults when a seeded user somehow has no taxonomy rows", async () => {
    const supabase = makeFakeSupabase({
      tailor_profile: { library_version: 1, values: {}, default_teaching_subjects: [] },
      tailor_taxonomy: [],
    });
    expect(await loadLibrary({ userId: "u-empty", supabase })).toBe(defaultLibraryData);
  });

  it("assembles a per-user library from rows; stopwords come from the bundle", async () => {
    const supabase = makeFakeSupabase({
      tailor_profile: { library_version: 7, values: { FULL_NAME: "Test User" }, default_teaching_subjects: ["Algebra"] },
      tailor_taxonomy: [{ canonical: "Zebra", category: "domain", aliases: ["zebra"], match_canonical: true, sort_order: 0 }],
      tailor_focus_areas: [],
      tailor_skill_groups: [],
      tailor_content_library: [],
    });
    const lib = await loadLibrary({ userId: "u-real", supabase });
    expect(lib.taxonomy.entries[0].canonical).toBe("Zebra");
    expect(lib.profile.values.FULL_NAME).toBe("Test User");
    expect(lib.profile.default_teaching_subjects).toEqual(["Algebra"]);
    expect(lib.stopwords).toBe(defaultLibraryData.stopwords);
  });
});
