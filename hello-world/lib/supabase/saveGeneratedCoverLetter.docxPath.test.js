// N59 step 3 (4b) -- AC-8 / AC-9: saveGeneratedCoverLetter must reach docx
// parity with saveGeneratedResume. When a docxB64 is supplied it uploads the
// engine document to resumes/${userId}/generated/${id}.docx (upsert:true) and
// then sets the row's docx_path -- best-effort, never failing the save.
//
// RED on HEAD: saveGeneratedCoverLetter has no docxB64 param, no upload, and
// no docx_path update (whole file today). These are assertion-level reds (the
// module exists), not module-not-found reds.

import { describe, it, expect, vi } from "vitest";

import { saveGeneratedCoverLetter } from "@/lib/supabase/saveGeneratedCoverLetter.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const PK_BYTES = [0x50, 0x4b, 0x03, 0x04];
const PK_B64 = "UEsDBA==";

// Records the insert, the docx_path update, and the storage upload. The insert
// resolves an id so the upload branch is reachable.
function makeSupabase({ insertId = "cl-77", uploadError = null, uploadThrows = false } = {}) {
  const calls = { inserts: [], updates: [], uploads: [] };
  const client = {
    from: vi.fn((table) => {
      const chain = {
        insert: vi.fn((row) => {
          calls.inserts.push({ table, row });
          return chain;
        }),
        select: vi.fn(() => chain),
        single: vi.fn(async () =>
          insertId
            ? { data: { id: insertId }, error: null }
            : { data: null, error: { message: "insert failed" } },
        ),
        update: vi.fn((patch) => {
          const rec = { table, patch, eq: null };
          calls.updates.push(rec);
          return {
            eq: vi.fn(async (column, value) => {
              rec.eq = { column, value };
              return { error: null };
            }),
          };
        }),
      };
      return chain;
    }),
    storage: {
      from: vi.fn((bucket) => ({
        upload: vi.fn(async (path, body, opts) => {
          calls.uploads.push({ bucket, path, body, opts });
          if (uploadThrows) throw new Error("upload boom");
          if (uploadError) return { data: null, error: { message: uploadError } };
          return { data: { path }, error: null };
        }),
      })),
    },
  };
  return { client, calls };
}

const BASE = {
  userId: "user-9",
  positionId: "pos-1",
  content: "Dear hiring team, ...",
  contentLines: ["Dear hiring team, ..."],
};

describe("saveGeneratedCoverLetter -- docx upload + docx_path (AC-8/AC-9)", () => {
  it("uploads the engine bytes at the row-id path and sets docx_path on the SAME row", async () => {
    const { client, calls } = makeSupabase({ insertId: "cl-77" });
    const id = await saveGeneratedCoverLetter(client, { ...BASE, docxB64: PK_B64 });

    expect(id).toBe("cl-77");

    // Uploaded once, to the resumes bucket, at the row-id key with upsert:true.
    expect(calls.uploads).toHaveLength(1);
    expect(calls.uploads[0].bucket).toBe("resumes");
    expect(calls.uploads[0].path).toBe("user-9/generated/cl-77.docx");
    expect(calls.uploads[0].opts).toMatchObject({ contentType: DOCX_MIME, upsert: true });
    expect(Array.from(calls.uploads[0].body)).toEqual(PK_BYTES);

    // docx_path written back to the cover row -- the mutant that drops this
    // update line dies here.
    const pathUpdate = calls.updates.find((u) => u.patch && "docx_path" in u.patch);
    expect(pathUpdate, "no docx_path update was issued").toBeTruthy();
    expect(pathUpdate.patch.docx_path).toBe("user-9/generated/cl-77.docx");
    expect(pathUpdate.eq).toEqual({ column: "id", value: "cl-77" });
    expect(pathUpdate.table).toBe("generated_cover_letters");
  });

  it("does NOT upload or update docx_path when no docxB64 is supplied (over-fire control)", async () => {
    const { client, calls } = makeSupabase({ insertId: "cl-77" });
    const id = await saveGeneratedCoverLetter(client, { ...BASE });
    expect(id).toBe("cl-77");
    expect(calls.uploads).toHaveLength(0);
    expect(calls.updates.find((u) => u.patch && "docx_path" in u.patch)).toBeFalsy();
  });

  it("still returns the id when the upload errors (best-effort; no docx_path set)", async () => {
    const { client, calls } = makeSupabase({ insertId: "cl-77", uploadError: "denied" });
    const id = await saveGeneratedCoverLetter(client, { ...BASE, docxB64: PK_B64 });
    expect(id).toBe("cl-77");
    // Upload was attempted but failed, so no docx_path is written (never a wrong path).
    expect(calls.updates.find((u) => u.patch && "docx_path" in u.patch)).toBeFalsy();
  });

  it("still returns the id (never throws) when the upload throws", async () => {
    const { client } = makeSupabase({ insertId: "cl-77", uploadThrows: true });
    await expect(
      saveGeneratedCoverLetter(client, { ...BASE, docxB64: PK_B64 }),
    ).resolves.toBe("cl-77");
  });

  it("returns null and never inserts when userId or content is missing (non-regression guard)", async () => {
    const { client, calls } = makeSupabase();
    expect(await saveGeneratedCoverLetter(client, { ...BASE, userId: "", docxB64: PK_B64 })).toBeNull();
    expect(await saveGeneratedCoverLetter(client, { ...BASE, content: "", docxB64: PK_B64 })).toBeNull();
    expect(calls.inserts).toHaveLength(0);
    expect(calls.uploads).toHaveLength(0);
  });
});
