// N59 step 2 (4b) -- coverDocxStore: upload/fetch helpers for a cover-letter's
// engine .docx, using the existing `resumes` storage bucket, mirroring the way
// generated resumes already store their bytes (saveGeneratedResume.js:70-84,
// docx.js's fetchStoredDocxBlob:525-534).
//
// This module does not exist on HEAD, so every test here is RED by
// module-not-found until step 2 lands it. Disclosed as such in tests.r1.md;
// the reference build proves the reds are satisfiable and the mutants prove
// each has power.
//
// R2 (settled by the plan, refines AC-9): TWO storage-key conventions, and
// this unit pins BOTH -- the GENERATION path keys by the row id
// (`${userId}/generated/${id}.docx`), the ACCEPT path keys by a fresh uuid
// (`${userId}/generated/cover-<uuid>.docx`) because the path goes INTO the
// accept RPC and so must exist before the row id is minted.

import { describe, it, expect, vi } from "vitest";

import { uploadCoverDocx, fetchCoverDocxB64 } from "@/lib/document/coverDocxStore.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// A tiny, real docx-shaped byte vector: the ZIP local-file-header magic
// "PK\x03\x04" that every .docx starts with. Its canonical base64 is
// "UEsDBA==". Using a concrete pair proves the helper decodes base64 to BYTES
// rather than uploading the base64 STRING, and that fetch re-encodes the same
// bytes back to the same base64.
const PK_BYTES = [0x50, 0x4b, 0x03, 0x04];
const PK_B64 = "UEsDBA==";

// A storage fake that RECORDS uploads and can be driven to error/throw. The
// shared `makeStatefulSupabase` models storage.download but not .upload, and
// this unit's whole point is what gets uploaded, so a purpose-built recorder
// is the faithful instrument here.
function makeStorage({ uploadError = null, uploadThrows = false } = {}) {
  const uploads = [];
  const buckets = [];
  const supabase = {
    storage: {
      from: vi.fn((bucket) => {
        buckets.push(bucket);
        return {
          upload: vi.fn(async (path, body, opts) => {
            uploads.push({ bucket, path, body, opts });
            if (uploadThrows) throw new Error("upload boom");
            if (uploadError) return { data: null, error: { message: uploadError } };
            return { data: { path }, error: null };
          }),
        };
      }),
    },
  };
  return { supabase, uploads, buckets };
}

// A storage fake for the download side.
function makeDownloadStorage({ blob = null, error = null, throws = false } = {}) {
  const downloads = [];
  const supabase = {
    storage: {
      from: vi.fn((bucket) => ({
        download: vi.fn(async (path) => {
          downloads.push({ bucket, path });
          if (throws) throw new Error("download boom");
          if (error) return { data: null, error: { message: error } };
          return { data: blob, error: null };
        }),
      })),
    },
  };
  return { supabase, downloads };
}

describe("uploadCoverDocx -- GENERATION path (row-id key, R2 / AC-9)", () => {
  it("uploads the decoded bytes to resumes/${userId}/generated/${id}.docx with upsert:true and the docx mime, and returns that exact path", async () => {
    const { supabase, uploads, buckets } = makeStorage();
    const path = await uploadCoverDocx(supabase, "user-1", PK_B64, { id: "cl-42" });

    expect(uploads).toHaveLength(1);
    expect(buckets).toContain("resumes");
    expect(uploads[0].bucket).toBe("resumes");
    // The row-id key convention -- NOT a uuid -- for the generation path.
    expect(uploads[0].path).toBe("user-1/generated/cl-42.docx");
    expect(uploads[0].opts).toMatchObject({ contentType: DOCX_MIME, upsert: true });
    // The body must be the DECODED bytes, not the base64 string. A mutant that
    // uploads `docxB64` verbatim fails here.
    expect(Array.from(uploads[0].body)).toEqual(PK_BYTES);
    expect(path).toBe("user-1/generated/cl-42.docx");
  });
});

describe("uploadCoverDocx -- ACCEPT path (fresh-uuid key, R2)", () => {
  it("keys by a fresh cover-<uuid> when no id is supplied, still under the ${userId}/generated/ prefix", async () => {
    const { supabase, uploads } = makeStorage();
    const path = await uploadCoverDocx(supabase, "user-1", PK_B64);

    expect(uploads).toHaveLength(1);
    // A uuid, not the row id: the accept path cannot know the id (the path
    // goes INTO the RPC that mints the row).
    expect(path).toMatch(/^user-1\/generated\/cover-[0-9a-fA-F-]{36}\.docx$/);
    expect(uploads[0].path).toBe(path);
    // Still keyed under the same prefix a future retention sweep enumerates.
    expect(path.startsWith("user-1/generated/cover-")).toBe(true);
  });

  it("mints a DISTINCT key on each accept upload (a hard-coded stub fails this)", async () => {
    const { supabase } = makeStorage();
    const a = await uploadCoverDocx(supabase, "user-1", PK_B64);
    const b = await uploadCoverDocx(supabase, "user-1", PK_B64);
    expect(a).not.toBe(b);
  });

  it("still produces a unique cover- key and never throws when crypto.randomUUID is unavailable (K12 fallback)", async () => {
    const original = globalThis.crypto;
    try {
      // Simulate an old runtime with no webcrypto randomUUID at all.
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      const { supabase } = makeStorage();
      const a = await uploadCoverDocx(supabase, "user-1", PK_B64);
      const b = await uploadCoverDocx(supabase, "user-1", PK_B64);
      expect(typeof a).toBe("string");
      expect(a.startsWith("user-1/generated/cover-")).toBe(true);
      expect(a).not.toBe(b);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});

describe("uploadCoverDocx -- refusal / never-throws contract", () => {
  it("returns null and uploads nothing for an empty docxB64 (over-fire control)", async () => {
    const { supabase, uploads } = makeStorage();
    expect(await uploadCoverDocx(supabase, "user-1", "", { id: "cl-1" })).toBeNull();
    expect(await uploadCoverDocx(supabase, "user-1", undefined, { id: "cl-1" })).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("returns null (never throws) when storage.upload reports an error", async () => {
    const { supabase } = makeStorage({ uploadError: "denied" });
    await expect(uploadCoverDocx(supabase, "user-1", PK_B64, { id: "cl-1" })).resolves.toBeNull();
  });

  it("returns null (never throws) when storage.upload throws", async () => {
    const { supabase } = makeStorage({ uploadThrows: true });
    await expect(uploadCoverDocx(supabase, "user-1", PK_B64, { id: "cl-1" })).resolves.toBeNull();
  });

  it("returns null with no userId", async () => {
    const { supabase, uploads } = makeStorage();
    expect(await uploadCoverDocx(supabase, "", PK_B64, { id: "cl-1" })).toBeNull();
    expect(uploads).toHaveLength(0);
  });
});

describe("fetchCoverDocxB64 -- round-trips stored bytes back to base64", () => {
  it("downloads from the resumes bucket at the given path and re-encodes the bytes to the SAME base64", async () => {
    const blob = new Blob([new Uint8Array(PK_BYTES)]);
    const { supabase, downloads } = makeDownloadStorage({ blob });
    const b64 = await fetchCoverDocxB64(supabase, "user-1/generated/cl-42.docx");
    expect(b64).toBe(PK_B64);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].bucket).toBe("resumes");
    expect(downloads[0].path).toBe("user-1/generated/cl-42.docx");
  });

  it("returns null (never throws) when download reports an error", async () => {
    const { supabase } = makeDownloadStorage({ error: "not found" });
    await expect(fetchCoverDocxB64(supabase, "user-1/generated/x.docx")).resolves.toBeNull();
  });

  it("returns null (never throws) when download throws", async () => {
    const { supabase } = makeDownloadStorage({ throws: true });
    await expect(fetchCoverDocxB64(supabase, "user-1/generated/x.docx")).resolves.toBeNull();
  });

  it("returns null and downloads nothing for an empty path (over-fire control)", async () => {
    const { supabase, downloads } = makeDownloadStorage({ blob: new Blob([new Uint8Array(PK_BYTES)]) });
    expect(await fetchCoverDocxB64(supabase, "")).toBeNull();
    expect(await fetchCoverDocxB64(supabase, null)).toBeNull();
    expect(downloads).toHaveLength(0);
  });

  it("returns null when download resolves with no data", async () => {
    const { supabase } = makeDownloadStorage({ blob: null });
    await expect(fetchCoverDocxB64(supabase, "user-1/generated/x.docx")).resolves.toBeNull();
  });
});

// WHAT THIS CANNOT CATCH: it exercises the helper in isolation with a faked
// storage. It does NOT prove any PRODUCTION path actually calls uploadCoverDocx
// with the engine's real bytes -- that is the job of the saveGeneratedCoverLetter
// unit, the persistGeneration join, and the call-site census in this chunk.
