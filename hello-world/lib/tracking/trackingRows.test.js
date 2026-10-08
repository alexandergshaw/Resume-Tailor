import { describe, it, expect } from "vitest";
import { selectVisibleApplications, classificationsByAppId, indexApplicationsById } from "./trackingRows.js";
import { normalizeInterviewValue } from "./stages.js";

// The filter + sort as it was written inline in app/page.js before it moved
// here, copied verbatim, so the move is checked against the original rather
// than against a re-derivation of what it should do.
function legacyVisible(applicationData, interviewSearch, interviewSort) {
  return [...applicationData]
    .filter((app) => {
      const query = normalizeInterviewValue(interviewSearch);
      if (!query) return true;
      const company = normalizeInterviewValue(app.positions?.company);
      const role = normalizeInterviewValue(app.positions?.title);
      return company.includes(query) || role.includes(query);
    })
    .sort((a, b) => {
      if (!interviewSort.field) return 0;
      const field = interviewSort.field;
      let av;
      let bv;
      if (field === "company" || field === "title") {
        av = (a.positions?.[field] || "").toString().toLowerCase();
        bv = (b.positions?.[field] || "").toString().toLowerCase();
      } else if (field === "status") {
        av = (a.status || "").toString().toLowerCase();
        bv = (b.status || "").toString().toLowerCase();
      } else if (field === "applied_at") {
        av = a.applied_at ? new Date(a.applied_at).getTime() : NaN;
        bv = b.applied_at ? new Date(b.applied_at).getTime() : NaN;
        const aMissing = Number.isNaN(av);
        const bMissing = Number.isNaN(bv);
        if (aMissing && !bMissing) return 1;
        if (!aMissing && bMissing) return -1;
        if (aMissing && bMissing) return 0;
        return interviewSort.dir === "asc" ? av - bv : bv - av;
      } else {
        return 0;
      }
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      if (!av && !bv) return 0;
      const cmp = av.localeCompare(bv);
      return interviewSort.dir === "asc" ? cmp : -cmp;
    });
}

const app = (id, company, title, status, appliedAt) => ({
  id,
  status,
  applied_at: appliedAt,
  positions: company === null ? null : { company, title },
});

const ROWS = [
  app("1", "Stripe", "Frontend Engineer", "applied", "2026-03-02T00:00:00Z"),
  app("2", "acme", "Backend Engineer", "interviewing", null),
  app("3", "Zeta Corp", "", "rejected", "2026-01-10T00:00:00Z"),
  app("4", "", "Data Scientist", "tracking", "2026-02-01T00:00:00Z"),
  app("5", null, null, "offer", undefined),
  app("6", "Bravo", "Frontend Lead", "applied", "not-a-date"),
];

const FIELDS = [null, "company", "title", "status", "applied_at", "unknown"];
const DIRS = ["asc", "desc"];
const QUERIES = ["", "  ", "frontend", "  ACME ", "zzz", "engineer"];

describe("selectVisibleApplications", () => {
  it("matches the inline implementation it replaced, for every field x direction x query", () => {
    for (const field of FIELDS) {
      for (const dir of DIRS) {
        for (const query of QUERIES) {
          const sort = { field, dir };
          const ids = (list) => list.map((a) => a.id);
          expect(ids(selectVisibleApplications(ROWS, query, sort)), `${field}/${dir}/"${query}"`).toEqual(
            ids(legacyVisible(ROWS, query, sort)),
          );
        }
      }
    }
  });

  it("filters on company or role, trimmed and case-insensitive", () => {
    const ids = (q) => selectVisibleApplications(ROWS, q, { field: null, dir: "asc" }).map((a) => a.id);
    expect(ids("  ACME ")).toEqual(["2"]);
    expect(ids("frontend")).toEqual(["1", "6"]);
    expect(ids("zzz")).toEqual([]);
  });

  it("keeps fetch order when no sort field is set", () => {
    const ids = selectVisibleApplications(ROWS, "", { field: null, dir: "desc" }).map((a) => a.id);
    expect(ids).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("sorts empty values and missing dates to the bottom in both directions", () => {
    const company = (dir) => selectVisibleApplications(ROWS, "", { field: "company", dir }).map((a) => a.id);
    expect(company("asc").slice(-2).sort()).toEqual(["4", "5"]);
    expect(company("desc").slice(-2).sort()).toEqual(["4", "5"]);
    const applied = (dir) => selectVisibleApplications(ROWS, "", { field: "applied_at", dir }).map((a) => a.id);
    expect(applied("asc").slice(0, 3)).toEqual(["3", "4", "1"]);
    expect(applied("desc").slice(0, 3)).toEqual(["1", "4", "3"]);
  });

  it("returns a new array, never the input", () => {
    const out = selectVisibleApplications(ROWS, "", { field: null, dir: "asc" });
    expect(out).not.toBe(ROWS);
    expect(out).toEqual(ROWS);
  });
});

describe("classificationsByAppId", () => {
  const msg = (id, classification) => ({ application: id === null ? null : { id }, classification });

  it("keeps the highest-priority classification per application", () => {
    const out = classificationsByAppId([
      msg("a", "confirmation"),
      msg("a", "rejection"),
      msg("a", "interview"),
      msg("b", "interview"),
      msg("b", "confirmation"),
      msg("c", "confirmation"),
    ]);
    expect(out).toEqual({ a: "rejection", b: "interview", c: "confirmation" });
  });

  it("skips messages with no matched application or no classification", () => {
    expect(classificationsByAppId([msg(null, "interview"), msg("a", null), msg("b", "")])).toEqual({});
    expect(classificationsByAppId([])).toEqual({});
  });
});

describe("indexApplicationsById", () => {
  it("maps each id to its position", () => {
    const index = indexApplicationsById([{ id: "x" }, { id: "y" }, { id: "z" }]);
    expect(index.get("x")).toBe(0);
    expect(index.get("z")).toBe(2);
    expect(index.get("nope")).toBeUndefined();
  });

  it("keeps the FIRST index for a duplicate id, as the findIndex it replaces did", () => {
    const rows = [{ id: "x" }, { id: "y" }, { id: "x" }];
    expect(indexApplicationsById(rows).get("x")).toBe(rows.findIndex((r) => r.id === "x"));
  });
});
