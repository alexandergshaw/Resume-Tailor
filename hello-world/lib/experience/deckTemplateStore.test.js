// deckTemplateStore's job: remember ONE PowerPoint template per signed-in
// user, in the existing `resumes` bucket, at a FIXED per-user path (see the
// file's own header comment for why a fixed path rather than a
// materials.js-style named locker). Mirrors
// lib/copilot/applicationDocsClient.test.js's mocking shape: the browser
// Supabase client is mocked wholesale, and the user is resolved from
// auth.getUser() rather than threaded in as a parameter, since nothing this
// deep in the component tree (BulkActionsBar.js) has a userId prop to give
// it - see BulkActionsBar.js's own comment on why.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase/client.js", () => ({
  createClient: vi.fn(),
}));

import { uploadDeckTemplate, fetchDeckTemplate } from "./deckTemplateStore.js";
import { createClient } from "../supabase/client.js";

function makeFakeSupabase({ user = { id: "u1" }, userError = null, storageImpl } = {}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: userError })),
    },
    storage: {
      from: vi.fn(() => storageImpl),
    },
  };
}

describe("uploadDeckTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the file's bytes at a fixed per-user path in the resumes bucket, upserting", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const fake = makeFakeSupabase({ storageImpl: { upload } });
    createClient.mockReturnValue(fake);

    const file = new File(["pptx-bytes"], "Brand.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const result = await uploadDeckTemplate(file);

    expect(result).toEqual({ error: null, name: "Brand.pptx" });
    expect(fake.storage.from).toHaveBeenCalledWith("resumes");
    expect(upload).toHaveBeenCalledTimes(2); // the template bytes, then the name sidecar

    const [templatePath, uploadedFile, templateOptions] = upload.mock.calls[0];
    expect(templatePath).toBe("u1/deck-template/template.pptx");
    expect(uploadedFile).toBe(file);
    expect(templateOptions.upsert).toBe(true);

    const [metaPath] = upload.mock.calls[1];
    expect(metaPath).toBe("u1/deck-template/template.meta.json");
  });

  it("uploading again overwrites the same path rather than accumulating files - a fixed path is what makes that automatic", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const fake = makeFakeSupabase({ storageImpl: { upload } });
    createClient.mockReturnValue(fake);

    await uploadDeckTemplate(new File(["a"], "First.pptx"));
    await uploadDeckTemplate(new File(["b"], "Second.potx"));

    const templateCalls = [upload.mock.calls[0], upload.mock.calls[2]];
    expect(templateCalls[0][0]).toBe(templateCalls[1][0]);
  });

  it("reports a storage error rather than pretending the upload succeeded", async () => {
    const upload = vi.fn().mockResolvedValue({ error: { message: "quota exceeded" } });
    const fake = makeFakeSupabase({ storageImpl: { upload } });
    createClient.mockReturnValue(fake);

    const result = await uploadDeckTemplate(new File(["a"], "Brand.pptx"));
    expect(result.error).toBe("quota exceeded");
  });

  it("refuses without calling storage when there is no signed-in user", async () => {
    const upload = vi.fn();
    const fake = makeFakeSupabase({ user: null, storageImpl: { upload } });
    createClient.mockReturnValue(fake);

    const result = await uploadDeckTemplate(new File(["a"], "Brand.pptx"));
    expect(result.error).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns an error rather than throwing when called with no file", async () => {
    const result = await uploadDeckTemplate(null);
    expect(result.error).toBeTruthy();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("fetchDeckTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the stored template's bytes and its original uploaded name", async () => {
    const templateBlob = new Blob(["zip-bytes"]);
    const metaBlob = new Blob([JSON.stringify({ name: "Brand.pptx" })], { type: "application/json" });
    const download = vi
      .fn()
      .mockResolvedValueOnce({ data: templateBlob, error: null })
      .mockResolvedValueOnce({ data: metaBlob, error: null });
    const fake = makeFakeSupabase({ storageImpl: { download } });
    createClient.mockReturnValue(fake);

    const result = await fetchDeckTemplate();

    expect(result.blob).toBe(templateBlob);
    expect(result.name).toBe("Brand.pptx");
    expect(download.mock.calls[0][0]).toBe("u1/deck-template/template.pptx");
    expect(download.mock.calls[1][0]).toBe("u1/deck-template/template.meta.json");
  });

  it("falls back to a generic name when the name sidecar is missing but the template itself is present", async () => {
    const templateBlob = new Blob(["zip-bytes"]);
    const download = vi
      .fn()
      .mockResolvedValueOnce({ data: templateBlob, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "not found" } });
    const fake = makeFakeSupabase({ storageImpl: { download } });
    createClient.mockReturnValue(fake);

    const result = await fetchDeckTemplate();
    expect(result.blob).toBe(templateBlob);
    expect(result.name).toBe("template.pptx");
  });

  it("returns no template, without erroring, when nothing has ever been uploaded", async () => {
    const download = vi.fn().mockResolvedValue({ data: null, error: { message: "Object not found" } });
    const fake = makeFakeSupabase({ storageImpl: { download } });
    createClient.mockReturnValue(fake);

    const result = await fetchDeckTemplate();
    expect(result).toEqual({ blob: null, name: null });
  });

  it("returns no template, without throwing, when there is no signed-in user", async () => {
    const download = vi.fn();
    const fake = makeFakeSupabase({ user: null, storageImpl: { download } });
    createClient.mockReturnValue(fake);

    const result = await fetchDeckTemplate();
    expect(result).toEqual({ blob: null, name: null });
    expect(download).not.toHaveBeenCalled();
  });
});
