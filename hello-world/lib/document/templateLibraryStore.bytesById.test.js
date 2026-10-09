// N151c (4b) — S1 / T2 (store half): getTemplateBytesById — fetch ONE library
// template's docx bytes BY ID, owner-scoped (plan §E S1, PL-7 / PL-9). Closes
// the F8 gap: today only the ACTIVE selection's bytes are fetchable, so picking
// a non-active library template to regen into has no bytes source.
//
// RED on HEAD: templateLibraryStore.js exports listTemplates / registerTemplate
// / deleteTemplate only — getTemplateBytesById does not exist, so it imports as
// undefined and the requireFn() guard reds every test with a clear reason.
//
// THE HEADLINE SILENT-FAILURE INSTRUMENT (§F S1): the by-id read must gate on
// id + user_id + kind. If the owner guard (.eq("user_id", userId)) is dropped,
// a caller fetches ANOTHER user's template bytes and the regen formats a version
// with a foreign template, with NO error — only the ownership assertion catches
// it. The foreign-id test asserts null; drop the guard and it returns the
// foreign bytes -> red. It is paired with an owned-id positive control so
// "everything returns null" cannot pass as teeth.

import { describe, it, expect } from "vitest";

import { getTemplateBytesById } from "@/lib/document/templateLibraryStore.js";

const OWN_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x4f, 0x4f]); // "OO" = own
const FOREIGN_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x46, 0x46]); // "FF" = foreign

// A round-tripping in-memory supabase: resume_templates rows filtered by the
// chained .eq() columns, and a `resumes` bucket keyed by storage_path whose
// download returns a Blob-like with arrayBuffer() (the shape the store decodes).
function makeClient({ rows = [], objects = {} } = {}) {
  return {
    from(table) {
      const eqs = [];
      const run = () => {
        if (table !== "resume_templates") return [];
        return rows.filter((r) => eqs.every(([c, v]) => r[c] === v));
      };
      const builder = {
        select: () => builder,
        eq: (c, v) => { eqs.push([c, v]); return builder; },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        single: async () => ({ data: run()[0] || null, error: run()[0] ? null : { message: "no row" } }),
      };
      return builder;
    },
    storage: {
      from: () => ({
        download: async (path) => {
          if (!Object.prototype.hasOwnProperty.call(objects, path)) {
            return { data: null, error: { message: "not found" } };
          }
          const bytes = objects[path];
          return {
            data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
            error: null,
          };
        },
      }),
    },
  };
}

const OWNED_ROW = { id: "t-own", user_id: "user-1", kind: "resume", storage_path: "user-1/templates/t-own.docx" };
const FOREIGN_ROW = { id: "t-foreign", user_id: "user-2", kind: "resume", storage_path: "user-2/templates/t-foreign.docx" };

function seededClient() {
  return makeClient({
    rows: [OWNED_ROW, FOREIGN_ROW],
    objects: {
      "user-1/templates/t-own.docx": OWN_BYTES,
      "user-2/templates/t-foreign.docx": FOREIGN_BYTES,
    },
  });
}

function requireFn() {
  expect(typeof getTemplateBytesById, "getTemplateBytesById does not exist on HEAD").toBe("function");
  return getTemplateBytesById;
}

describe("getTemplateBytesById — owner-scoped by-id bytes (S1 / T2 / PL-7)", () => {
  it("POSITIVE CONTROL: returns the OWNED template's exact bytes", async () => {
    const got = await requireFn()(seededClient(), { userId: "user-1", id: "t-own", kind: "resume" });
    expect(got, "the owned template resolved no bytes").toBeTruthy();
    expect(Array.from(got.bytes)).toEqual(Array.from(OWN_BYTES));
  });

  it("OWNER GUARD: another user's template id resolves NULL, never the foreign bytes", async () => {
    // Drop .eq("user_id", userId) in the store and this returns FOREIGN_BYTES:
    // the regen would silently format with someone else's template.
    const got = await requireFn()(seededClient(), { userId: "user-1", id: "t-foreign", kind: "resume" });
    expect(got, "a foreign template's bytes were returned — the owner guard is missing").toBeNull();
  });

  it("an absent id resolves null", async () => {
    const got = await requireFn()(seededClient(), { userId: "user-1", id: "does-not-exist", kind: "resume" });
    expect(got).toBeNull();
  });

  it("a kind mismatch resolves null (the kind guard)", async () => {
    const got = await requireFn()(seededClient(), { userId: "user-1", id: "t-own", kind: "cover" });
    expect(got).toBeNull();
  });

  it("an unsupported kind resolves null", async () => {
    const got = await requireFn()(seededClient(), { userId: "user-1", id: "t-own", kind: "email" });
    expect(got).toBeNull();
  });

  it("a row whose stored object is missing resolves null (never throws)", async () => {
    const client = makeClient({
      rows: [{ id: "t-own", user_id: "user-1", kind: "resume", storage_path: "user-1/templates/gone.docx" }],
      objects: {}, // no bytes behind the path
    });
    await expect(requireFn()(client, { userId: "user-1", id: "t-own", kind: "resume" })).resolves.toBeNull();
  });

  it("an empty stored object resolves null (no zero-byte template)", async () => {
    const client = makeClient({
      rows: [OWNED_ROW],
      objects: { "user-1/templates/t-own.docx": new Uint8Array([]) },
    });
    await expect(requireFn()(client, { userId: "user-1", id: "t-own", kind: "resume" })).resolves.toBeNull();
  });
});
