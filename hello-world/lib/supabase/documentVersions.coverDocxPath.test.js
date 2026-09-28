// N59 step 4 (4b) -- the cover-letter version list must now select docx_path.
// AC-4.
//
// CONTEXT / A LANDED TEST THIS CONTRADICTS ON PURPOSE. The migration 66ea826
// (already pushed) added `generated_cover_letters.docx_path`. Before it, the
// cover select deliberately OMITTED docx_path, because asking PostgREST for a
// column that does not exist errors, and documentVersions.js swallows that error
// to [] -- silently disappearing the whole cover version history. That guard is
// pinned by lib/supabase/documentVersions.test.js's "must not ask for docx_path
// (X-13)" describe and its COLUMNS.generated_cover_letters fixture (which lists
// no docx_path). Now that the column EXISTS, that guard is factually stale: this
// file asserts the OPPOSITE, and the two cannot both be green. The step-4
// implementer must reconcile documentVersions.test.js (invert X-13 + add
// docx_path to its cover COLUMNS fixture) in the same diff that lands the select
// change. Flagged in the report -- not edited here (it is not on this seat's
// brief).
//
// RED-ON-HEAD REASON: COLUMNS_BY_SCOPE.cover is "id, content, content_lines,
// created_at" -- no docx_path -- so the select string does not name it and the
// returned rows carry no docx_path pointer for selectDocumentVersion to use.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchDocumentVersions } from "./documentVersions.js";

// A PostgREST stand-in that reflects the POST-MIGRATION schema: the cover table
// now HAS docx_path, so requesting it is legal and returned. Asking for a column
// no table has is still an error (the behaviour documentVersions.js swallows) --
// so a select that misspells or over-selects is still caught.
const COLUMNS = {
  generated_resumes: ["id", "content", "content_lines", "created_at", "docx_path", "position_id", "user_id"],
  // The migration's addition:
  generated_cover_letters: ["id", "content", "content_lines", "created_at", "docx_path", "position_id", "user_id"],
};

const ROWS = {
  generated_cover_letters: [
    {
      id: "c2",
      content: "NEWEST COVER",
      content_lines: ["NEWEST COVER"],
      created_at: "2026-08-02T00:00:00.000Z",
      docx_path: "user-1/generated/c2.docx",
      position_id: "pos-1",
      user_id: "user-1",
    },
    {
      id: "c1",
      content: "FIRST COVER",
      content_lines: ["FIRST COVER"],
      created_at: "2026-08-01T00:00:00.000Z",
      docx_path: "user-1/generated/c1.docx",
      position_id: "pos-1",
      user_id: "user-1",
    },
  ],
};

function parseColumns(select) {
  return String(select)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function makeClient() {
  const calls = [];
  return {
    calls,
    from(table) {
      const state = { table, columns: [], filters: {}, order: null, limit: null };
      const builder = {
        select(select) {
          state.columns = parseColumns(select);
          calls.push({ table, select: String(select) });
          return builder;
        },
        eq(column, value) {
          state.filters[column] = value;
          return builder;
        },
        order(column, opts) {
          state.order = { column, ...opts };
          return builder;
        },
        limit(n) {
          state.limit = n;
          calls[calls.length - 1].state = state;
          return Promise.resolve(resolve(state));
        },
      };
      return builder;
    },
  };
}

function resolve(state) {
  const known = COLUMNS[state.table];
  const missing = state.columns.find((c) => !known.includes(c));
  if (missing) {
    return { data: null, error: { code: "42703", message: `column ${state.table}.${missing} does not exist` } };
  }
  const rows = (ROWS[state.table] || [])
    .filter((r) => Object.entries(state.filters).every(([k, v]) => r[k] === v))
    .slice(0, state.limit ?? undefined)
    .map((r) => {
      const out = {};
      for (const c of state.columns) if (c in r) out[c] = r[c];
      return out;
    });
  return { data: rows, error: null };
}

let warn;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("the cover version list carries the per-version docx_path (AC-4)", () => {
  it("names docx_path in the cover-letter select", async () => {
    // RED on HEAD: COLUMNS_BY_SCOPE.cover omits docx_path.
    const client = makeClient();
    await fetchDocumentVersions(client, "cover", "pos-1");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].table).toBe("generated_cover_letters");
    expect(client.calls[0].select).toMatch(/docx_path/);
  });

  it("returns docx_path on every cover version", async () => {
    // The whole point: selectDocumentVersion writes coverLetterDocxPath =
    // version.docx_path. Without the column here that is undefined on every row
    // and the step-4 fix is a no-op that looks correct in the diff.
    // RED on HEAD (rows come back with no docx_path key).
    const versions = await fetchDocumentVersions(makeClient(), "cover", "pos-1");
    expect(versions.map((v) => v.docx_path)).toEqual([
      "user-1/generated/c2.docx",
      "user-1/generated/c1.docx",
    ]);
  });

  it("still returns the fields the version control already renders (non-regression)", async () => {
    const versions = await fetchDocumentVersions(makeClient(), "cover", "pos-1");
    expect(versions.map((v) => v.id)).toEqual(["c2", "c1"]);
    expect(versions[0]).toMatchObject({
      id: "c2",
      content: "NEWEST COVER",
      content_lines: ["NEWEST COVER"],
      created_at: "2026-08-02T00:00:00.000Z",
    });
  });

  it("POSITIVE CONTROL: the select does not error against the post-migration cover schema", async () => {
    // Without this, "returns rows" above could be an empty [] from a swallowed
    // 42703 -- which would look like a pass for a completely broken select.
    // Here the client models the migrated schema, so a select that STILL omits
    // docx_path returns rows-without-the-column (the RED above) rather than [];
    // a select that names a bogus column would 42703 -> []. This asserts we are
    // in neither failure mode: rows come back non-empty.
    const versions = await fetchDocumentVersions(makeClient(), "cover", "pos-1");
    expect(versions.length).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });
});
