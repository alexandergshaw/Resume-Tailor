// Wave 1A -- fetchDocumentVersions, and the trap the D-1 fix introduces.
//
// D-1 (DATA.md rev 2, ARCH.md 3): selectDocumentVersion rewrites the entry's
// text but never touches entry.docxB64/docxPath, so resolveDocumentBlob's
// first branch keeps serving the NEWEST generation's bytes. The adopted fix
// is to select the per-generation `docx_path` here and write the SELECTED
// version's own path -- which preserves the engine's real formatting, where
// merely clearing docxB64 would discard it.
//
// THE TRAP. fetchDocumentVersions uses ONE select string for BOTH tables
// (TABLE_BY_SCOPE). generated_cover_letters has no docx_path column, so an
// UNCONDITIONAL `docx_path` in that select makes the cover-letter query fail
// with a PostgREST undefined-column error -- which lines 46-49 swallow
// (console.warn, then `return []`) -- and VersionControl hides itself below
// two entries. The cover letter's entire version history would vanish with no
// error, no failing test, and nothing visible on screen.
//
// Asserting "it does not throw" would therefore prove NOTHING: the failure
// path is a resolved empty array. The assertion has to be that the cover
// scope still comes back NON-EMPTY, paired with a positive control proving
// the fixture holds cover rows in the first place.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchDocumentVersions, pointApplicationAtVersion } from "./documentVersions.js";

// The real column sets, from the migrations:
//   generated_resumes       -- docx_path added by
//                              20260617000000_generated_resume_docx_path.sql
//   generated_cover_letters -- 20260610000000_auto_apply_queue.sql:11-20, no
//                              docx_path (persistGeneration.js:17-21 records why)
const COLUMNS = {
  generated_resumes: [
    "id",
    "content",
    "content_lines",
    "created_at",
    "docx_path",
    "position_id",
    "user_id",
  ],
  generated_cover_letters: ["id", "content", "content_lines", "created_at", "position_id", "user_id"],
};

const ROWS = {
  generated_resumes: [
    {
      id: "r2",
      content: "NEWEST RESUME",
      content_lines: ["NEWEST RESUME"],
      created_at: "2026-08-02T00:00:00.000Z",
      docx_path: "user-1/generated/r2.docx",
      position_id: "pos-1",
      user_id: "user-1",
    },
    {
      id: "r1",
      content: "FIRST RESUME",
      content_lines: ["FIRST RESUME"],
      created_at: "2026-08-01T00:00:00.000Z",
      docx_path: "user-1/generated/r1.docx",
      position_id: "pos-1",
      user_id: "user-1",
    },
  ],
  generated_cover_letters: [
    {
      id: "c2",
      content: "NEWEST COVER",
      content_lines: ["NEWEST COVER"],
      created_at: "2026-08-02T00:00:00.000Z",
      position_id: "pos-1",
      user_id: "user-1",
    },
    {
      id: "c1",
      content: "FIRST COVER",
      content_lines: ["FIRST COVER"],
      created_at: "2026-08-01T00:00:00.000Z",
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

/**
 * A Supabase stand-in that behaves like PostgREST does about columns: asking
 * a table for a column it does not have is an ERROR, not an ignored field.
 * `lenient: true` drops that behaviour and is used only for the positive
 * control.
 */
function makeClient({ lenient = false } = {}) {
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
          return Promise.resolve(resolve(state, lenient));
        },
      };
      return builder;
    },
  };
}

function resolve(state, lenient) {
  const known = COLUMNS[state.table];
  if (!known) {
    return { data: null, error: { code: "42P01", message: `relation "${state.table}" does not exist` } };
  }
  if (!lenient) {
    const missing = state.columns.find((c) => !known.includes(c));
    if (missing) {
      // The exact shape PostgREST returns, and the exact shape
      // documentVersions.js swallows.
      return {
        data: null,
        error: {
          code: "42703",
          message: `column ${state.table}.${missing} does not exist`,
        },
      };
    }
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

// ---------------------------------------------------------------------------
// The trap
// ---------------------------------------------------------------------------

describe("the cover-letter select must not ask for docx_path (X-13)", () => {
  it("still returns the cover letter's version history", async () => {
    // FAILS the moment `docx_path` is added to a select string shared by both
    // tables: the cover query errors, documentVersions.js:46-49 warns and
    // returns [], and the version control silently disappears.
    const client = makeClient();
    const versions = await fetchDocumentVersions(client, "cover", "pos-1");
    expect(versions.map((v) => v.id)).toEqual(["c2", "c1"]);
  });

  it("positive control: the fixture really does produce cover entries", async () => {
    // Without this, "non-empty" above could be passing for a reason that has
    // nothing to do with the select -- and, symmetrically, a fixture that
    // could never produce rows would make the assertion above unfalsifiable.
    const lenient = makeClient({ lenient: true });
    const versions = await fetchDocumentVersions(lenient, "cover", "pos-1");
    expect(versions.map((v) => v.id)).toEqual(["c2", "c1"]);
  });

  it("does not name docx_path in the cover-letter query", async () => {
    const client = makeClient();
    await fetchDocumentVersions(client, "cover", "pos-1");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].table).toBe("generated_cover_letters");
    expect(client.calls[0].select).not.toMatch(/docx_path/);
  });
});

// ---------------------------------------------------------------------------
// What D-1's fix actually needs from this module
// ---------------------------------------------------------------------------

describe("the resume select carries the per-generation docx_path (D-1)", () => {
  it("returns docx_path on every resume version", async () => {
    // The fix in selectDocumentVersion writes `docxPath: version.docx_path`.
    // Without the column here that is `undefined` on every row and the fix is
    // a no-op that looks correct in the diff.
    const versions = await fetchDocumentVersions(makeClient(), "resume", "pos-1");
    expect(versions.map((v) => v.docx_path)).toEqual([
      "user-1/generated/r2.docx",
      "user-1/generated/r1.docx",
    ]);
  });

  it("still returns the fields the version control already renders", async () => {
    const versions = await fetchDocumentVersions(makeClient(), "resume", "pos-1");
    expect(versions[0]).toMatchObject({
      id: "r2",
      content: "NEWEST RESUME",
      content_lines: ["NEWEST RESUME"],
      created_at: "2026-08-02T00:00:00.000Z",
    });
  });
});

// ---------------------------------------------------------------------------
// Existing behaviour this change must not disturb
// ---------------------------------------------------------------------------

describe("fetchDocumentVersions query shape", () => {
  it("reads each scope's own table, newest first, capped at 25", async () => {
    const client = makeClient();
    await fetchDocumentVersions(client, "resume", "pos-1");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].state).toMatchObject({
      table: "generated_resumes",
      filters: { position_id: "pos-1" },
      order: { column: "created_at", ascending: false },
      limit: 25,
    });
  });

  it("returns [] for a missing client, an unknown scope, or no position", async () => {
    expect(await fetchDocumentVersions(null, "resume", "pos-1")).toEqual([]);
    expect(await fetchDocumentVersions(makeClient(), "email", "pos-1")).toEqual([]);
    expect(await fetchDocumentVersions(makeClient(), "resume", "")).toEqual([]);
  });

  it("returns [] rather than throwing when the query errors or throws", async () => {
    const erroring = {
      from: () => ({
        select: () => ({
          eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }),
        }),
      }),
    };
    expect(await fetchDocumentVersions(erroring, "resume", "pos-1")).toEqual([]);

    const throwing = {
      from: () => {
        throw new Error("network down");
      },
    };
    expect(await fetchDocumentVersions(throwing, "resume", "pos-1")).toEqual([]);
  });
});

describe("pointApplicationAtVersion", () => {
  it("repoints the scope's own column on the caller's application row", async () => {
    const seen = [];
    const client = {
      from(table) {
        const call = { table, update: null, filters: {} };
        seen.push(call);
        const b = {
          update(patch) {
            call.update = patch;
            return b;
          },
          eq(column, value) {
            call.filters[column] = value;
            return column === "position_id" ? Promise.resolve({ error: null }) : b;
          },
        };
        return b;
      },
    };
    expect(
      await pointApplicationAtVersion(client, {
        scope: "cover",
        versionId: "c1",
        userId: "user-1",
        positionId: "pos-1",
      }),
    ).toBe(true);
    expect(seen[0]).toEqual({
      table: "applications",
      update: { cover_letter_id: "c1" },
      filters: { user_id: "user-1", position_id: "pos-1" },
    });
  });

  it("reports false, and never throws, when anything is missing or fails", async () => {
    expect(await pointApplicationAtVersion(null, { scope: "resume" })).toBe(false);
    const failing = {
      from: () => ({
        update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: { message: "denied" } }) }) }),
      }),
    };
    expect(
      await pointApplicationAtVersion(failing, {
        scope: "resume",
        versionId: "r1",
        userId: "user-1",
        positionId: "pos-1",
      }),
    ).toBe(false);
  });
});
