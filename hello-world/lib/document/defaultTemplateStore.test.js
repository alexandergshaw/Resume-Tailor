// N97 (4b) — defaultTemplateStore: the per-(user,kind) default template store
// over the SHIPPED resume_templates table + the resumes bucket (design §4.1,
// plan Step 1). No new migration. This module does not exist on HEAD, so every
// test is RED by module-not-found until Step 1 lands it (disclosed in
// tests.r1.md; the reference build proves the reds are satisfiable and the
// mutants prove power).
//
// Covers: AC-6 (per-user isolation), AC-3 / R4 / R10 (refuse byte-less; upload
// PRECEDES the row so a row never names an empty path), AC-7 (kind stored;
// 'email' refused — the resume_templates CHECK excludes it), AC-9 / R8
// (reserved FIXED name + unique-violation caught, never a raw 23505 to the UI).
//
// The store takes an AUTHED supabase client and a userId ARGUMENT (never a
// request body) — the route derives userId from getUser() (AC-6, tested in
// route.test.js). Contract signatures (design §4.1 / plan Step 1):
//   saveDefaultTemplate(supabase, { userId, kind, bytes, fileName })
//     -> { row, replaced } | { error }
//   getDefaultTemplate(supabase, { userId, kind })       -> row | null
//   getDefaultTemplateBytes(supabase, { userId, kind })  -> { bytes } | null
//   clearDefaultTemplate(supabase, { userId, kind })     -> { ok:true } | { error }

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  saveDefaultTemplate,
  getDefaultTemplate,
  getDefaultTemplateBytes,
  clearDefaultTemplate,
} from "@/lib/document/defaultTemplateStore.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Real docx-shaped bytes: the ZIP magic every .docx starts with.
const PK_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

// A recorder that models storage.upload/download/remove AND the resume_templates
// query builder, with an ORDERED event log so "upload precedes the row write"
// (R10) is checkable. Flexible about which terminal verb resolves so a
// reasonable implementation (select-then-insert/update, or upsert) all pass.
function makeStore({
  existingRow = null,
  uploadError = null,
  uploadThrows = false,
  insertViolation = false,
  downloadBlob = null,
  downloadError = null,
} = {}) {
  const events = [];
  const uploads = [];
  const removes = [];
  const downloads = [];
  const table = { select: [], insert: [], update: [], upsert: [], delete: [], eq: [] };

  // A FRESH builder per from() call (mirrors the real client), so a write verb
  // set in one statement never leaks into the next, and .insert().select() does
  // not read back as a select.
  function makeBuilder() {
    let verb = "select";
    const resolve = () => {
      if (verb === "insert") {
        if (insertViolation) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        return { data: { id: "row-new", ...(table.insert.at(-1)?.[0] || {}) }, error: null };
      }
      if (verb === "update") return { data: { id: existingRow?.id || "row-upd", ...(table.update.at(-1)?.[0] || {}) }, error: null };
      if (verb === "upsert") return { data: { id: existingRow?.id || "row-ups", ...(table.upsert.at(-1)?.[0] || {}) }, error: null };
      if (verb === "delete") return { data: null, error: null };
      return { data: existingRow, error: null }; // select
    };
    const builder = {};
    const rec = (name) => (...args) => {
      // Only a WRITE verb sets the terminal verb; a chained .select() modifier
      // on a write (e.g. .insert().select().single()) must not reset it.
      if (["insert", "update", "upsert", "delete"].includes(name)) verb = name;
      table[name]?.push(args);
      events.push(`table.${name}`);
      return builder;
    };
    for (const m of ["select", "insert", "update", "upsert", "delete", "eq"]) builder[m] = rec(m);
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
          if (uploadThrows) throw new Error("upload boom");
          if (uploadError) return { data: null, error: { message: uploadError } };
          return { data: { path }, error: null };
        }),
        download: vi.fn(async (path) => {
          downloads.push({ bucket, path });
          if (downloadError) return { data: null, error: { message: downloadError } };
          return { data: downloadBlob, error: null };
        }),
        remove: vi.fn(async (paths) => {
          removes.push({ bucket, paths });
          return { data: {}, error: null };
        }),
      })),
    },
  };

  return { supabase, events, uploads, removes, downloads, table };
}

const blobOf = (bytes) => ({
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// AC-3 / R4 / R10 — refuse byte-less; upload PRECEDES the row.
// ---------------------------------------------------------------------------
describe("saveDefaultTemplate — refuses byte-less input, never names an empty path", () => {
  it("returns { error } and writes NOTHING for empty bytes (over-fire control)", async () => {
    const { supabase, uploads, events } = makeStore();
    const res = await saveDefaultTemplate(supabase, { userId: "u1", kind: "resume", bytes: new Uint8Array(0), fileName: "r.docx" });
    expect(res.error, "empty bytes must be refused with an error").toBeTruthy();
    expect(res.row).toBeUndefined();
    expect(uploads).toHaveLength(0);
    expect(events.filter((e) => e.startsWith("table."))).toHaveLength(0);
  });

  it("returns { error } for null/undefined bytes and uploads nothing", async () => {
    const { supabase, uploads } = makeStore();
    expect((await saveDefaultTemplate(supabase, { userId: "u1", kind: "resume", bytes: null })).error).toBeTruthy();
    expect((await saveDefaultTemplate(supabase, { userId: "u1", kind: "resume", bytes: undefined })).error).toBeTruthy();
    expect(uploads).toHaveLength(0);
  });

  it("R10: the storage upload happens BEFORE any resume_templates row write", async () => {
    const { supabase, events } = makeStore();
    await saveDefaultTemplate(supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    const firstTableWrite = events.findIndex((e) => /^table\.(insert|update|upsert)$/.test(e));
    const firstUpload = events.indexOf("storage.upload");
    expect(firstUpload, "no upload happened").toBeGreaterThanOrEqual(0);
    expect(firstTableWrite, "no row write happened").toBeGreaterThanOrEqual(0);
    expect(firstUpload).toBeLessThan(firstTableWrite);
  });

  it("R10: when the upload FAILS, no row is written (a row must never name a byte-less path)", async () => {
    const { supabase, events } = makeStore({ uploadError: "denied" });
    const res = await saveDefaultTemplate(supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    expect(res.error).toBeTruthy();
    expect(events.filter((e) => /^table\.(insert|update|upsert)$/.test(e)), "row written despite failed upload").toHaveLength(0);
  });

  it("uploads to the fixed per-kind path in the resumes bucket, upsert:true, docx mime, DECODED bytes", async () => {
    const { supabase, uploads } = makeStore();
    await saveDefaultTemplate(supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe("resumes");
    expect(uploads[0].path).toBe("u1/templates/default-resume.docx");
    expect(uploads[0].opts).toMatchObject({ contentType: DOCX_MIME, upsert: true });
    expect(Array.from(uploads[0].body)).toEqual(Array.from(PK_BYTES));
  });
});

// ---------------------------------------------------------------------------
// AC-7 — kind is stored; 'email' is refused (the CHECK excludes it).
// ---------------------------------------------------------------------------
describe("saveDefaultTemplate — kind handling", () => {
  it("stores kind='cover' and the cover fixed path when kind is cover", async () => {
    const { supabase, uploads, table } = makeStore();
    await saveDefaultTemplate(supabase, { userId: "u1", kind: "cover", bytes: PK_BYTES, fileName: "c.docx" });
    expect(uploads[0].path).toBe("u1/templates/default-cover.docx");
    const written = [...table.insert, ...table.update, ...table.upsert].map((a) => a[0]);
    expect(written.some((p) => p && p.kind === "cover"), "no row written with kind='cover'").toBe(true);
    expect(written.every((p) => !p || p.kind !== "resume")).toBe(true);
  });

  it("REFUSES kind='email' with { error } and writes nothing (resume_templates CHECK excludes it)", async () => {
    const { supabase, uploads, events } = makeStore();
    const res = await saveDefaultTemplate(supabase, { userId: "u1", kind: "email", bytes: PK_BYTES, fileName: "e.docx" });
    expect(res.error, "email kind must be refused").toBeTruthy();
    expect(res.row).toBeUndefined();
    expect(uploads).toHaveLength(0);
    expect(events.filter((e) => e.startsWith("table."))).toHaveLength(0);
  });

  it("[control] a valid kind is NOT refused (proves the email refusal is specific, not a blanket refusal)", async () => {
    const { supabase } = makeStore();
    const res = await saveDefaultTemplate(supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    expect(res.error).toBeFalsy();
    expect(res.row).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC-6 — per-user isolation: the write carries the caller's userId, and reads
// filter on it. A store statement must never target another user.
// ---------------------------------------------------------------------------
describe("saveDefaultTemplate — per-user isolation (AC-6)", () => {
  it("the row payload carries user_id === the caller's userId", async () => {
    const { supabase, table } = makeStore();
    await saveDefaultTemplate(supabase, { userId: "owner-9", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    const written = [...table.insert, ...table.update, ...table.upsert].map((a) => a[0]).filter(Boolean);
    expect(written.length, "no row payload recorded").toBeGreaterThan(0);
    for (const payload of written) {
      // For an update the payload may omit user_id (it's an eq filter instead),
      // but it must NEVER carry a DIFFERENT user_id.
      if ("user_id" in payload) expect(payload.user_id).toBe("owner-9");
    }
    // And every eq('user_id', ...) filter uses the caller's id, never another.
    for (const [col, val] of table.eq) if (col === "user_id") expect(val).toBe("owner-9");
  });

  it("uploads under the caller's own path prefix (storage isolation)", async () => {
    const { supabase, uploads } = makeStore();
    await saveDefaultTemplate(supabase, { userId: "owner-9", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    expect(uploads[0].path.startsWith("owner-9/")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-9 / R8 — reserved FIXED name + duplicate handled (never a raw 23505).
// ---------------------------------------------------------------------------
describe("saveDefaultTemplate — single default: reserved name + duplicate handled", () => {
  it("uses a FIXED reserved name (identical across two promotes of the same kind), never a user-typed name", async () => {
    const a = makeStore();
    const b = makeStore();
    await saveDefaultTemplate(a.supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "first upload name.docx" });
    await saveDefaultTemplate(b.supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "totally different name.docx" });
    const nameOf = (s) => [...s.table.insert, ...s.table.update, ...s.table.upsert].map((x) => x[0]).find((p) => p && typeof p.name === "string")?.name;
    const na = nameOf(a);
    const nb = nameOf(b);
    expect(na, "no name written").toBeTruthy();
    expect(na).toBe(nb); // fixed, not derived from the (differing) fileName
    expect(na).not.toContain("upload name");
    expect(na).not.toContain("different name");
  });

  it("résumé and cover use DISTINCT reserved names (so both defaults coexist under the unique index)", async () => {
    const r = makeStore();
    const c = makeStore();
    await saveDefaultTemplate(r.supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "x.docx" });
    await saveDefaultTemplate(c.supabase, { userId: "u1", kind: "cover", bytes: PK_BYTES, fileName: "x.docx" });
    const nameOf = (s) => [...s.table.insert, ...s.table.update, ...s.table.upsert].map((x) => x[0]).find((p) => p && typeof p.name === "string")?.name;
    expect(nameOf(r)).not.toBe(nameOf(c));
  });

  it("R8: a unique-violation on insert is CAUGHT and resolved (no raw 23505 reaches the caller)", async () => {
    // Concurrent double-insert: the reserved row already exists by the time we
    // insert. The store must fall back to updating the existing default, never
    // surface the raw constraint error.
    const { supabase } = makeStore({ insertViolation: true });
    const res = await saveDefaultTemplate(supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    expect(res.row, "a caught unique-violation should still yield a row").toBeTruthy();
    expect(res.error).toBeFalsy();
    if (res.error) expect(String(res.error)).not.toMatch(/23505|unique|duplicate/i);
  });

  it("reports replaced:false on a first promote and replaced:true when a default already exists", async () => {
    const first = makeStore({ existingRow: null });
    const again = makeStore({ existingRow: { id: "row-1", kind: "resume", name: "Default", storage_path: "u1/templates/default-resume.docx" } });
    const r1 = await saveDefaultTemplate(first.supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    const r2 = await saveDefaultTemplate(again.supabase, { userId: "u1", kind: "resume", bytes: PK_BYTES, fileName: "r.docx" });
    expect(r1.replaced).toBe(false);
    expect(r2.replaced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDefaultTemplate / getDefaultTemplateBytes — null when absent.
// ---------------------------------------------------------------------------
describe("getDefaultTemplate / getDefaultTemplateBytes", () => {
  it("getDefaultTemplate returns null when no default row exists", async () => {
    const { supabase } = makeStore({ existingRow: null });
    expect(await getDefaultTemplate(supabase, { userId: "u1", kind: "resume" })).toBeNull();
  });

  it("getDefaultTemplate returns the reserved row when present, filtered by user_id and kind", async () => {
    const row = { id: "row-1", kind: "resume", name: "Default", storage_path: "u1/templates/default-resume.docx" };
    const { supabase, table } = makeStore({ existingRow: row });
    const got = await getDefaultTemplate(supabase, { userId: "u1", kind: "resume" });
    expect(got).toMatchObject({ id: "row-1", kind: "resume" });
    expect(table.eq).toContainEqual(["user_id", "u1"]);
  });

  it("getDefaultTemplateBytes returns null when no default row exists (no bytes to fetch)", async () => {
    const { supabase } = makeStore({ existingRow: null });
    expect(await getDefaultTemplateBytes(supabase, { userId: "u1", kind: "resume" })).toBeNull();
  });

  it("getDefaultTemplateBytes returns { bytes } from the stored object when present", async () => {
    const row = { id: "row-1", kind: "resume", name: "Default", storage_path: "u1/templates/default-resume.docx" };
    const { supabase } = makeStore({ existingRow: row, downloadBlob: blobOf(PK_BYTES) });
    const got = await getDefaultTemplateBytes(supabase, { userId: "u1", kind: "resume" });
    expect(got, "bytes not returned for a present default").toBeTruthy();
    expect(Array.from(got.bytes)).toEqual(Array.from(PK_BYTES));
  });

  it("getDefaultTemplateBytes returns null (never throws) when the object is gone", async () => {
    const row = { id: "row-1", kind: "resume", name: "Default", storage_path: "u1/templates/default-resume.docx" };
    const { supabase } = makeStore({ existingRow: row, downloadError: "not found" });
    await expect(getDefaultTemplateBytes(supabase, { userId: "u1", kind: "resume" })).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clearDefaultTemplate — row delete gated by user_id + best-effort object remove.
// (The DELETE path is shipped even without a UI control, per plan §7 OPEN.)
// ---------------------------------------------------------------------------
describe("clearDefaultTemplate", () => {
  it("deletes the reserved row filtered by user_id and kind and removes the stored object", async () => {
    const { supabase, table, removes } = makeStore({ existingRow: { id: "row-1", kind: "resume" } });
    const res = await clearDefaultTemplate(supabase, { userId: "u1", kind: "resume" });
    expect(res.ok).toBe(true);
    expect(table.delete.length, "no delete issued").toBeGreaterThan(0);
    expect(table.eq).toContainEqual(["user_id", "u1"]);
    expect(removes.length, "stored object not removed").toBeGreaterThan(0);
  });
});

// WHAT THIS CANNOT CATCH: it exercises the store with a faked client. It does
// NOT prove the route calls it with a getUser()-derived userId (route.test.js),
// nor that any egress consumes the stored bytes (docx.defaultTemplateOverride
// + the egress census).
