// N151a (4b) — templateLibraryStore: the per-user, per-kind TEMPLATE LIBRARY
// over the SHIPPED resume_templates table + the resumes bucket (plan Step 3 /
// design §3.1-3.2). This module does not exist on HEAD, so every test is RED by
// module-not-found until Step 3 lands it. Contracts:
//   listTemplates(supabase, { userId, kind })             -> Array<row>
//   registerTemplate(supabase, { userId, kind, name, bytes }) -> { row } | { error }
//   deleteTemplate(supabase, { userId, id })              -> { ok:true } | { error }
//
// Covers T4 (per-id storage path + named row + bytes-before-row ordering, R5),
// T5 (duplicate name -> friendly { error }, never a raw 23505, R6), and the R4
// per-user isolation of listTemplates (a dropped .eq("user_id") reds via the
// cross-tenant control).

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  listTemplates,
  registerTemplate,
  deleteTemplate,
} from "@/lib/document/templateLibraryStore.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PK_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function makeStore({ listData = [], insertViolation = false } = {}) {
  const events = [];
  const uploads = [];
  const removes = [];
  const table = { select: [], insert: [], update: [], upsert: [], delete: [], eq: [], order: [] };

  function makeBuilder() {
    let verb = "select";
    const resolve = () => {
      if (verb === "insert") {
        if (insertViolation) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"resume_templates_user_kind_name_uniq\"" } };
        }
        return { data: { ...(table.insert.at(-1)?.[0] || {}) }, error: null };
      }
      if (verb === "update") return { data: { ...(table.update.at(-1)?.[0] || {}) }, error: null };
      if (verb === "upsert") return { data: { ...(table.upsert.at(-1)?.[0] || {}) }, error: null };
      if (verb === "delete") return { data: null, error: null };
      return { data: listData, error: null }; // select (list)
    };
    const builder = {};
    const rec = (name) => (...args) => {
      if (["insert", "update", "upsert", "delete"].includes(name)) verb = name;
      table[name]?.push(args);
      events.push(`table.${name}`);
      return builder;
    };
    for (const m of ["select", "insert", "update", "upsert", "delete", "eq", "order"]) builder[m] = rec(m);
    builder.single = vi.fn(async () => resolve());
    builder.maybeSingle = vi.fn(async () => resolve());
    builder.then = (res, rej) => Promise.resolve(resolve()).then(res, rej);
    return builder;
  }

  const supabase = {
    from: vi.fn((t) => {
      events.push(`from:${t}`);
      return makeBuilder();
    }),
    storage: {
      from: vi.fn((bucket) => ({
        upload: vi.fn(async (path, body, opts) => {
          events.push("storage.upload");
          uploads.push({ bucket, path, body, opts });
          return { data: { path }, error: null };
        }),
        remove: vi.fn(async (paths) => {
          events.push("storage.remove");
          removes.push({ bucket, paths });
          return { data: {}, error: null };
        }),
      })),
    },
  };

  return { supabase, events, uploads, removes, table };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// T4 — registerTemplate: per-id path, named row, bytes-before-row ordering (R5).
// ---------------------------------------------------------------------------
describe("registerTemplate (T4 / R5)", () => {
  it("uploads to a PER-ID path ${userId}/templates/${id}.docx — NOT the material path, NOT default-${kind}", async () => {
    const { supabase, uploads } = makeStore();
    await registerTemplate(supabase, { userId: "u1", kind: "resume", name: "My Template", bytes: PK_BYTES });
    expect(uploads, "no upload issued").toHaveLength(1);
    expect(uploads[0].bucket).toBe("resumes");
    // Per-id: a uuid segment, not the material filename, not the reserved default.
    expect(uploads[0].path).toMatch(/^u1\/templates\/[0-9a-fA-F-]{8,}\.docx$/);
    expect(uploads[0].path).not.toMatch(/\/materials\//);
    expect(uploads[0].path).not.toMatch(/default-resume\.docx$/);
    expect(uploads[0].path).not.toContain("My Template");
    expect(uploads[0].opts).toMatchObject({ contentType: DOCX_MIME, upsert: true });
    expect(Array.from(uploads[0].body)).toEqual(Array.from(PK_BYTES));
  });

  it("inserts a NAMED row carrying the user-chosen name, kind, and the SAME storage_path it uploaded to", async () => {
    const { supabase, uploads, table } = makeStore();
    await registerTemplate(supabase, { userId: "u1", kind: "resume", name: "My Template", bytes: PK_BYTES });
    const payload = table.insert.at(-1)?.[0] || {};
    expect(payload.name).toBe("My Template");
    expect(payload.kind).toBe("resume");
    expect(payload.user_id).toBe("u1");
    expect(payload.storage_path).toBe(uploads[0].path); // the row points at the bytes it just wrote
  });

  it("R5: the storage upload happens BEFORE the resume_templates row write (a row never names a byte-less path)", async () => {
    const { supabase, events } = makeStore();
    await registerTemplate(supabase, { userId: "u1", kind: "resume", name: "My Template", bytes: PK_BYTES });
    const firstUpload = events.indexOf("storage.upload");
    const firstRowWrite = events.findIndex((e) => /^table\.(insert|update|upsert)$/.test(e));
    expect(firstUpload, "no upload happened").toBeGreaterThanOrEqual(0);
    expect(firstRowWrite, "no row write happened").toBeGreaterThanOrEqual(0);
    expect(firstUpload).toBeLessThan(firstRowWrite);
  });

  it("refuses empty bytes with { error } and writes nothing (over-fire control)", async () => {
    const { supabase, uploads, events } = makeStore();
    const res = await registerTemplate(supabase, { userId: "u1", kind: "resume", name: "x", bytes: new Uint8Array(0) });
    expect(res.error, "empty bytes must be refused").toBeTruthy();
    expect(res.row).toBeUndefined();
    expect(uploads).toHaveLength(0);
    expect(events.filter((e) => e.startsWith("table."))).toHaveLength(0);
  });

  it("refuses kind='email' with { error } and writes nothing (resume_templates CHECK excludes it)", async () => {
    const { supabase, uploads } = makeStore();
    const res = await registerTemplate(supabase, { userId: "u1", kind: "email", name: "x", bytes: PK_BYTES });
    expect(res.error).toBeTruthy();
    expect(uploads).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T5 — duplicate name is surfaced FRIENDLY, never as a raw 23505 (R6).
// ---------------------------------------------------------------------------
describe("registerTemplate — duplicate name (T5 / R6)", () => {
  it("a unique-violation on insert becomes a friendly { error } that names the template, with no raw 23505", async () => {
    const { supabase } = makeStore({ insertViolation: true });
    const res = await registerTemplate(supabase, { userId: "u1", kind: "resume", name: "My Template", bytes: PK_BYTES });
    expect(res.error, "a duplicate name must surface a friendly error").toBeTruthy();
    expect(res.row).toBeUndefined();
    expect(String(res.error)).not.toMatch(/23505/);
    expect(String(res.error)).not.toMatch(/violates unique constraint/i);
    expect(String(res.error)).toContain("My Template");
  });

  it("[control] a non-colliding insert returns the row, no error", async () => {
    const { supabase } = makeStore({ insertViolation: false });
    const res = await registerTemplate(supabase, { userId: "u1", kind: "resume", name: "Unique One", bytes: PK_BYTES });
    expect(res.error).toBeFalsy();
    expect(res.row).toBeTruthy();
    expect(res.row.name).toBe("Unique One");
  });
});

// ---------------------------------------------------------------------------
// listTemplates — per-user, per-kind (R4 cross-tenant guard).
// ---------------------------------------------------------------------------
describe("listTemplates (R4)", () => {
  it("filters by the caller's user_id AND kind and returns the rows", async () => {
    const rows = [{ id: "a", name: "A", kind: "resume", storage_path: "u1/templates/a.docx", updated_at: "2026-10-01" }];
    const { supabase, table } = makeStore({ listData: rows });
    const got = await listTemplates(supabase, { userId: "u1", kind: "resume" });
    expect(got).toEqual(rows);
    expect(table.eq).toContainEqual(["user_id", "u1"]);
    expect(table.eq).toContainEqual(["kind", "resume"]);
  });

  it("R4: never filters on another user's id", async () => {
    const { supabase, table } = makeStore({ listData: [] });
    await listTemplates(supabase, { userId: "owner-9", kind: "resume" });
    for (const [col, val] of table.eq) if (col === "user_id") expect(val).toBe("owner-9");
  });

  it("returns [] (never throws) when the read errors / substrate is absent", async () => {
    // A from() that throws models a missing table; the store degrades to [].
    const supabase = { from: vi.fn(() => { throw new Error("relation does not exist"); }) };
    await expect(listTemplates(supabase, { userId: "u1", kind: "resume" })).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteTemplate — row delete gated by id + user_id, best-effort object remove.
// (Shipped for library CRUD completeness; the UI delete control is N151b.)
// ---------------------------------------------------------------------------
describe("deleteTemplate", () => {
  it("deletes the row filtered by id AND user_id and returns { ok:true }", async () => {
    const { supabase, table } = makeStore();
    const res = await deleteTemplate(supabase, { userId: "u1", id: "tmpl-1" });
    expect(res).toMatchObject({ ok: true });
    expect(table.delete.length, "no delete issued").toBeGreaterThan(0);
    expect(table.eq).toContainEqual(["user_id", "u1"]);
    expect(table.eq).toContainEqual(["id", "tmpl-1"]);
  });
});

// WHAT THIS CANNOT CATCH: it faults the client, so it does not prove the route
// gates non-docx bytes (library/route.test.js / T6) nor that register sets the
// selection (T7). deleteTemplate's storage-object cleanup is best-effort and not
// asserted beyond the row delete, matching the plan's "best-effort" contract.
