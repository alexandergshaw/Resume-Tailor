import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import {
  ensureAppFolder,
  createDoc,
  updateDoc,
  getDocMeta,
  exportDocx,
} from "./driveClient";
import { DOCS_MIME, DOCX_MIME, FOLDER_MIME } from "./driveMime";

const DOCX_BUFFER = Buffer.from("pretend docx bytes");

/** A minimal fake `drive` — logic-level tests only; the real client's
 * request-BUILDING behaviour is pinned in driveClient.wire.test.js, which an
 * object like this one cannot verify (see that file's header comment). */
function fakeDrive({ get, list, create, update, export_ } = {}) {
  return {
    files: {
      get: vi.fn(get ?? (async () => ({ data: {} }))),
      list: vi.fn(list ?? (async () => ({ data: { files: [] } }))),
      create: vi.fn(create ?? (async () => ({ data: { id: "created-id" } }))),
      update: vi.fn(update ?? (async () => ({ data: { id: "updated-id" } }))),
      export: vi.fn(export_ ?? (async () => ({ data: new ArrayBuffer(0) }))),
    },
  };
}

describe("ensureAppFolder (AC-S22)", () => {
  it("reuses a cached folder id, unmodified, without listing or creating — positive control (AC-S22)", async () => {
    const drive = fakeDrive({
      get: async () => ({ data: { id: "CACHED_FOLDER", explicitlyTrashed: false } }),
    });
    const id = await ensureAppFolder(drive, "CACHED_FOLDER");
    expect(id).toBe("CACHED_FOLDER");
    expect(drive.files.get).toHaveBeenCalledTimes(1);
    expect(drive.files.list).not.toHaveBeenCalled();
    expect(drive.files.create).not.toHaveBeenCalled();
  });

  it("uses explicitlyTrashed, not trashed, as the reuse signal (DATA.md m-2)", async () => {
    // `trashed` is writable by unrelated activity and is documented as the
    // less reliable field; `explicitlyTrashed` is the one this module must
    // trust. A cached folder with trashed:true but explicitlyTrashed:false
    // must still be reused.
    const drive = fakeDrive({
      get: async () => ({ data: { id: "CACHED_FOLDER", trashed: true, explicitlyTrashed: false } }),
    });
    const id = await ensureAppFolder(drive, "CACHED_FOLDER");
    expect(id).toBe("CACHED_FOLDER");
    expect(drive.files.list).not.toHaveBeenCalled();
  });

  it("falls back to list when the cached folder is explicitly trashed", async () => {
    const drive = fakeDrive({
      get: async () => ({ data: { id: "CACHED_FOLDER", explicitlyTrashed: true } }),
      list: async () => ({ data: { files: [{ id: "FOUND_FOLDER", name: "Resume Tailor" }] } }),
    });
    const id = await ensureAppFolder(drive, "CACHED_FOLDER");
    expect(id).toBe("FOUND_FOLDER");
    expect(drive.files.list).toHaveBeenCalledTimes(1);
    expect(drive.files.create).not.toHaveBeenCalled();
  });

  it("falls back to list when the cached folder id 404s", async () => {
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    const drive = fakeDrive({
      get: async () => {
        throw notFound;
      },
      list: async () => ({ data: { files: [{ id: "FOUND_FOLDER" }] } }),
    });
    const id = await ensureAppFolder(drive, "STALE_ID");
    expect(id).toBe("FOUND_FOLDER");
  });

  it("re-throws a non-404 error from the cached-folder lookup rather than silently falling back", async () => {
    const serverError = Object.assign(new Error("boom"), { status: 500 });
    const drive = fakeDrive({
      get: async () => {
        throw serverError;
      },
    });
    await expect(ensureAppFolder(drive, "SOME_ID")).rejects.toThrow("boom");
    expect(drive.files.list).not.toHaveBeenCalled();
  });

  it("finds the existing folder by name when there is no cached id", async () => {
    const drive = fakeDrive({
      list: async (params) => {
        expect(params.q).toBe(
          `mimeType = '${FOLDER_MIME}' and name = 'Resume Tailor' and trashed = false`,
        );
        expect(params.spaces).toBe("drive");
        return { data: { files: [{ id: "EXISTING", name: "Resume Tailor" }] } };
      },
    });
    const id = await ensureAppFolder(drive, null);
    expect(id).toBe("EXISTING");
    expect(drive.files.create).not.toHaveBeenCalled();
  });

  it("creates the folder only on a miss, with no media part (routes to the plain JSON endpoint)", async () => {
    const drive = fakeDrive({
      list: async () => ({ data: { files: [] } }),
      create: async (params) => {
        expect(params.requestBody).toEqual({ name: "Resume Tailor", mimeType: FOLDER_MIME });
        expect(params.media).toBeUndefined();
        expect(params.fields).toBe("id");
        return { data: { id: "NEW_FOLDER" } };
      },
    });
    const id = await ensureAppFolder(drive, undefined);
    expect(id).toBe("NEW_FOLDER");
  });

});

describe("createDoc — the duplicate guard (ARCH.md §8.2, BLK-4/MAJ-11)", () => {
  it("adopts an existing Doc of the same name in the same folder instead of creating a second one", async () => {
    const drive = fakeDrive({
      list: async (params) => {
        expect(params.q).toBe("'FOLDER1' in parents and name = 'Acme - SWE - Resume' and trashed = false");
        return { data: { files: [{ id: "EXISTING_DOC" }] } };
      },
      update: async (params) => {
        expect(params.fileId).toBe("EXISTING_DOC");
        return { data: { id: "EXISTING_DOC", mimeType: DOCS_MIME } };
      },
    });
    const result = await createDoc(drive, { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: DOCX_BUFFER });
    expect(result).toEqual({ id: "EXISTING_DOC", mimeType: DOCS_MIME });
    expect(drive.files.create).not.toHaveBeenCalled();
    expect(drive.files.update).toHaveBeenCalledTimes(1);
  });

  it("creates a new Doc when no name match is found, landing in the resolved folder — positive control (AC-S22/AC-S23)", async () => {
    const drive = fakeDrive({
      list: async () => ({ data: { files: [] } }),
      create: async (params) => {
        expect(params.requestBody.parents).toEqual(["FOLDER1"]);
        return { data: { id: "NEW_DOC", mimeType: DOCS_MIME } };
      },
    });
    const result = await createDoc(drive, { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: DOCX_BUFFER });
    expect(result).toEqual({ id: "NEW_DOC", mimeType: DOCS_MIME });
    expect(drive.files.update).not.toHaveBeenCalled();
  });

  it("escapes a single quote in a user-supplied document name (query-injection guard)", async () => {
    const drive = fakeDrive({
      list: async (params) => {
        // An unescaped quote would break the `q` filter's string literal.
        expect(params.q).toBe("'FOLDER1' in parents and name = 'Alex\\'s Resume' and trashed = false");
        return { data: { files: [] } };
      },
    });
    await createDoc(drive, { name: "Alex's Resume", folderId: "FOLDER1", docxBuffer: DOCX_BUFFER });
  });

  it("wraps the docx Buffer in a Readable for the media body — a Buffer throws in the real client (AC-S10)", async () => {
    let capturedBody;
    const drive = fakeDrive({
      list: async () => ({ data: { files: [] } }),
      create: async (params) => {
        capturedBody = params.media.body;
        return { data: { id: "NEW_DOC" } };
      },
    });
    await createDoc(drive, { name: "N", folderId: "F", docxBuffer: DOCX_BUFFER });
    expect(Buffer.isBuffer(capturedBody)).toBe(false);
    expect(capturedBody).toBeInstanceOf(Readable);
    expect(typeof capturedBody.pipe).toBe("function");
  });

  // WAVE4-SEAMS.md BLOCKER-1: `adopt: false` is the ONLY way to get a
  // genuinely new Doc out of this function. Without it, `save/route.js`'s
  // "Save as a new Doc" conflict choice and its trashed/non-Doc replacement
  // path both end up PATCHing the exact file they must never touch, because
  // the conflicted/stale Doc almost always still carries this function's
  // own lookup name.
  it("adopt:false skips the duplicate-check list entirely and always creates — even when a same-named Doc exists", async () => {
    const drive = fakeDrive({
      list: async () => ({ data: { files: [{ id: "SHOULD_NEVER_BE_ADOPTED" }] } }),
      create: async () => ({ data: { id: "NEW_DOC", mimeType: DOCS_MIME } }),
    });
    const result = await createDoc(drive, {
      name: "Acme - SWE - Resume",
      folderId: "FOLDER1",
      docxBuffer: DOCX_BUFFER,
      adopt: false,
    });
    expect(result).toEqual({ id: "NEW_DOC", mimeType: DOCS_MIME });
    expect(drive.files.list).not.toHaveBeenCalled();
    expect(drive.files.update).not.toHaveBeenCalled();
    expect(drive.files.create).toHaveBeenCalledTimes(1);
  });
});

describe("updateDoc — never re-parents, never renames (AC-S23)", () => {
  it("sends no requestBody.parents, regardless of any folder move", async () => {
    const drive = fakeDrive({
      update: async (params) => {
        expect(params.requestBody).not.toHaveProperty("parents");
        return { data: { id: "F1", mimeType: DOCS_MIME } };
      },
    });
    await updateDoc(drive, { fileId: "F1", docxBuffer: DOCX_BUFFER });
    expect(drive.files.update).toHaveBeenCalledTimes(1);
  });

  it("adds fileId as the only extra top-level key beyond the shared write-request shape", async () => {
    const drive = fakeDrive({
      update: async (params) => {
        expect(params.fileId).toBe("F1");
        expect(params.requestBody).toEqual({ mimeType: DOCS_MIME });
        return { data: {} };
      },
    });
    await updateDoc(drive, { fileId: "F1", docxBuffer: DOCX_BUFFER });
  });

  it("returns the raw response data unchanged, for the caller to classify (mimeType !== DOCS_MIME is the caller's job)", async () => {
    const drive = fakeDrive({
      update: async () => ({ data: { id: "F1", mimeType: DOCX_MIME } }), // NOT converted
    });
    const result = await updateDoc(drive, { fileId: "F1", docxBuffer: DOCX_BUFFER });
    expect(result).toEqual({ id: "F1", mimeType: DOCX_MIME });
  });
});

describe("getDocMeta (ARCH.md §7.4 pre-flight)", () => {
  it("requests exactly the fields the save-in-place pre-flight and the conflict compare need", async () => {
    const drive = fakeDrive({
      get: async (params) => {
        expect(params.fileId).toBe("F1");
        expect(params.fields).toBe("id,mimeType,trashed,explicitlyTrashed,version,name,webViewLink");
        return { data: { id: "F1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: false, version: "3" } };
      },
    });
    const meta = await getDocMeta(drive, "F1");
    expect(meta).toEqual({ id: "F1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: false, version: "3" });
  });
});

describe("exportDocx", () => {
  it("requests the docx mime type and responseType:'arraybuffer' as the SECOND argument", async () => {
    const bytes = new TextEncoder().encode("exported docx content").buffer;
    const drive = fakeDrive({
      export_: async (params, options) => {
        expect(params).toEqual({ fileId: "F1", mimeType: DOCX_MIME });
        expect(options).toEqual({ responseType: "arraybuffer" });
        return { data: bytes };
      },
    });
    const buf = await exportDocx(drive, "F1");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString("utf8")).toBe("exported docx content");
  });
});
