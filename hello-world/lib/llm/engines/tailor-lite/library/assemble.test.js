import { describe, it, expect } from "vitest";
import { defaultLibraryData } from "./defaults.js";
import { rowsToLibrary, libraryToRows } from "./assemble.js";

// Map libraryToRows() output (named per table) to the rowsToLibrary() input names.
function reassemble(rows) {
  return rowsToLibrary({
    taxonomyRows: rows.taxonomy,
    focusAreaRows: rows.focusAreas,
    skillGroupRows: rows.skillGroups,
    contentLibraryRows: rows.contentLibrary,
    profileRow: rows.profile,
  });
}

describe("library assemble converters", () => {
  it("round-trips the bundled defaults (shapes -> rows -> shapes) exactly", () => {
    const rows = libraryToRows(defaultLibraryData, "user-1");
    const back = reassemble(rows);

    expect(back.taxonomy.entries).toEqual(defaultLibraryData.taxonomy.entries);
    expect(back.skillGroups.groups).toEqual(defaultLibraryData.skillGroups.groups);
    expect(back.contentLibrary.entries).toEqual(defaultLibraryData.contentLibrary.entries);
    expect(back.profile.values).toEqual(defaultLibraryData.profile.values);
    expect(back.profile.default_teaching_subjects).toEqual(defaultLibraryData.profile.default_teaching_subjects);
    expect(back.profile.focus_areas).toEqual(defaultLibraryData.profile.focus_areas);
  });

  it("stamps every row with the user_id and a stable sort_order", () => {
    const rows = libraryToRows(defaultLibraryData, "user-9");
    expect(rows.taxonomy[0]).toMatchObject({ user_id: "user-9", sort_order: 0 });
    expect(rows.taxonomy.every((r) => r.user_id === "user-9")).toBe(true);
    expect(rows.profile.user_id).toBe("user-9");
    // match_canonical:false entries (e.g. "C", "Go") survive as a boolean column.
    const c = rows.taxonomy.find((r) => r.canonical === "C");
    expect(c.match_canonical).toBe(false);
  });

  it("treats empty input as an empty library (no crash)", () => {
    const lib = rowsToLibrary();
    expect(lib.taxonomy.entries).toEqual([]);
    expect(lib.profile.focus_areas).toEqual([]);
    expect(lib.profile.values).toEqual({});
    expect(lib.skillGroups.groups).toEqual([]);
    expect(lib.contentLibrary.entries).toEqual([]);
  });

  it("orders rows by sort_order regardless of input order", () => {
    const lib = rowsToLibrary({
      taxonomyRows: [
        { canonical: "B", category: "domain", aliases: [], sort_order: 1 },
        { canonical: "A", category: "domain", aliases: [], sort_order: 0 },
      ],
    });
    expect(lib.taxonomy.entries.map((e) => e.canonical)).toEqual(["A", "B"]);
  });
});
