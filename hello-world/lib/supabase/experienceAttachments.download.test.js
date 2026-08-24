// downloadAttachmentBlob's contract: hand back the stored bytes for one
// attachment, or a reason, and never throw.
//
// A sibling of experienceAttachments.test.js rather than another block inside
// it, mirroring the split AttachmentPanel.officeKinds.test.js already made:
// that file is about createAttachment's error STAGES, and mixing a second,
// unrelated contract into it would mean every future reader of either has to
// read both.
//
// Shaped after lib/supabase/materials.js's downloadMaterialBlob, which is the
// existing precedent in this repo for "read one file back out of the private
// `resumes` bucket". Only the Supabase client is doubled; the module under
// test is real.

import { describe, it, expect, vi } from "vitest";
import { downloadAttachmentBlob } from "./experienceAttachments.js";

// A double for exactly the call downloadAttachmentBlob makes:
// storage.from(BUCKET).download(path).
function clientDouble({ error = null, data = new Blob(["bytes"]) } = {}) {
  const download = vi.fn(async () => ({ data, error }));
  const from = vi.fn(() => ({ download }));
  return { calls: { download, from }, storage: { from } };
}

const PATH = "user-1/experience/page-1/a1-resume-draft.pdf";

describe("downloadAttachmentBlob", () => {
  it("returns the stored bytes, read from the resumes bucket at the row's own path", async () => {
    const blob = new Blob(["pdf bytes"]);
    const supabase = clientDouble({ data: blob });

    const result = await downloadAttachmentBlob(supabase, PATH);

    expect(result.error).toBeNull();
    expect(result.blob).toBe(blob);
    // The bucket is not a free choice: every other object this feature writes
    // lives in `resumes` (see createAttachment), and a download aimed at a
    // different bucket would 404 for every attachment ever uploaded.
    expect(supabase.calls.from).toHaveBeenCalledWith("resumes");
    // The full storage key, unmodified. Re-deriving it here from user/page/id
    // instead of using the row's own `storage_path` is how a download would
    // silently miss every file whose name the sanitizer changed at upload
    // time (see lib/experience/attachments.js's sanitizeSegment).
    expect(supabase.calls.download).toHaveBeenCalledWith(PATH);
  });

  it("carries the reason storage refused, rather than a generic sentence", async () => {
    const supabase = clientDouble({ data: null, error: { message: "Object not found" } });

    const result = await downloadAttachmentBlob(supabase, PATH);

    expect(result.blob).toBeNull();
    expect(result.error).toContain("Object not found");
  });

  it("treats an empty success as a failure", async () => {
    // storage-js resolves `{ data: null, error: null }` if the object is
    // missing on some paths. Returning `{ blob: null, error: null }` would
    // read as success to every caller and download nothing at all.
    const supabase = clientDouble({ data: null, error: null });

    const result = await downloadAttachmentBlob(supabase, PATH);

    expect(result.blob).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("refuses a row with no stored file WITHOUT touching storage", async () => {
    // `storage_path` is nullable in the migration. Passing an empty key to
    // storage.download asks for the bucket root, which is a different, more
    // confusing failure than the one the user actually has.
    const supabase = clientDouble();

    const result = await downloadAttachmentBlob(supabase, "");

    expect(result.blob).toBeNull();
    expect(result.error).toBeTruthy();
    expect(supabase.calls.download).not.toHaveBeenCalled();
  });

  it("reports a thrown client as an error instead of propagating it", async () => {
    // Every function in this module returns a result object rather than
    // throwing - see the file header. A network throw here would otherwise
    // reach a React event handler, where it becomes an unhandled rejection
    // and the user sees nothing at all.
    const supabase = {
      storage: {
        from: () => ({
          download: async () => {
            throw new Error("network down");
          },
        }),
      },
    };

    const result = await downloadAttachmentBlob(supabase, PATH);

    expect(result.blob).toBeNull();
    expect(result.error).toContain("network down");
  });
});
