// N59 step 3 (4b) -- AC-8 forwarding, tested at the SEAM with the REAL
// consumer. persistGeneratedDocuments must forward coverLetter.docxB64 to
// saveGeneratedCoverLetter, which must then upload it. This drives the real
// persistGeneratedDocuments -> real saveGeneratedCoverLetter join (never a
// hand-built fixture of what the consumer wants), so a forwarding drop OR a
// missing upload both fail it -- the "last hop missing" defect class this
// repo keeps shipping (K5).
//
// RED on HEAD for a COMPOUND reason (disclosed in tests.r1.md): persistGeneration
// omits docxB64 from the coverLetter it forwards (:69-77), AND
// saveGeneratedCoverLetter has no upload. The per-test mutant that drops ONLY
// the forward, run against the reference build, isolates the forwarding power.

import { describe, it, expect, vi } from "vitest";

import { persistGeneratedDocuments } from "@/lib/supabase/persistGeneration.js";

const PK_B64 = "UEsDBA==";

// A fake that resolves inserted ids, records docx uploads and docx_path
// updates, and lets the awaited pointer update resolve. Every builder method
// returns the same thenable builder so any `.update().eq().eq()` /
// `.insert().select().single()` chain the real code issues resolves.
function makeClient({ coverId = "cover-1", resumeId = "resume-1" } = {}) {
  const uploads = [];
  const docxPathUpdates = [];
  const client = {
    from: vi.fn((table) => {
      const state = {};
      const builder = {
        insert: vi.fn(() => builder),
        select: vi.fn(() => builder),
        single: vi.fn(async () => {
          const id =
            table === "generated_cover_letters"
              ? coverId
              : table === "generated_resumes"
                ? resumeId
                : null;
          return { data: id ? { id } : null, error: null };
        }),
        update: vi.fn((patch) => {
          if (patch && Object.prototype.hasOwnProperty.call(patch, "docx_path")) {
            docxPathUpdates.push({ table, docx_path: patch.docx_path });
          }
          state.patch = patch;
          return builder;
        }),
        eq: vi.fn(() => builder),
        then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
      };
      return builder;
    }),
    storage: {
      from: vi.fn((bucket) => ({
        upload: vi.fn(async (path, body, opts) => {
          uploads.push({ bucket, path, body, opts });
          return { data: { path }, error: null };
        }),
      })),
    },
  };
  return { client, uploads, docxPathUpdates };
}

describe("persistGeneratedDocuments forwards coverLetter.docxB64 to the cover save (AC-8, seam/K5)", () => {
  it("uploads the cover engine bytes at the new cover row's id path when docxB64 is supplied", async () => {
    const { client, uploads, docxPathUpdates } = makeClient({ coverId: "cover-1" });

    const outcome = await persistGeneratedDocuments(client, {
      userId: "user-3",
      positionId: "pos-1",
      coverLetter: { content: "Dear team", contentLines: ["Dear team"], docxB64: PK_B64 },
    });

    expect(outcome.coverLetterId).toBe("cover-1");
    // The docxB64 reached saveGeneratedCoverLetter and was uploaded to the
    // cover row's own key. Both a dropped forward and a missing upload fail this.
    const coverUpload = uploads.find((u) => u.path === "user-3/generated/cover-1.docx");
    expect(coverUpload, "cover docx was not uploaded at the row-id path").toBeTruthy();
    expect(coverUpload.bucket).toBe("resumes");
    // and the docx_path landed on the cover row.
    expect(docxPathUpdates).toContainEqual({
      table: "generated_cover_letters",
      docx_path: "user-3/generated/cover-1.docx",
    });
  });

  it("uploads NO cover docx when the caller passes a cover letter without docxB64 (over-fire control)", async () => {
    const { client, uploads, docxPathUpdates } = makeClient({ coverId: "cover-1" });

    await persistGeneratedDocuments(client, {
      userId: "user-3",
      positionId: "pos-1",
      coverLetter: { content: "Dear team", contentLines: ["Dear team"] },
    });

    expect(uploads.some((u) => u.path.includes("cover-1"))).toBe(false);
    expect(docxPathUpdates.some((u) => u.table === "generated_cover_letters")).toBe(false);
  });

  it("saves nothing for a cover letter with docxB64 but no content (guard)", async () => {
    const { client, uploads } = makeClient({ coverId: "cover-1" });
    const outcome = await persistGeneratedDocuments(client, {
      userId: "user-3",
      positionId: "pos-1",
      coverLetter: { content: "", contentLines: [], docxB64: PK_B64 },
    });
    expect(outcome.coverLetterId).toBeNull();
    expect(uploads).toHaveLength(0);
  });
});
