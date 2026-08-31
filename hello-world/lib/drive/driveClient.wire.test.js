import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { createDoc, updateDoc } from "./driveClient";
import { captureDriveRequests, requestBodyOf, mediaContentTypeOf } from "./driveWireProbe";
import { DOCS_MIME, DOCX_MIME, DRIVE_FIELDS } from "./driveMime";

// AC-S3, AC-S4, AC-S13, AC-S30, AC-S31 — the five criteria no other
// environment can hold (AC.md §8). Every assertion here runs against the
// REAL `googleapis` Drive client with only its transport stubbed
// (`driveWireProbe.js`), because an injected fake Drive client cannot
// observe a key the real client's request builder silently drops.
//
// THE HAZARD. `files.export` takes `mimeType` as a genuine top-level
// parameter. `files.update` does not — writing
// `drive.files.update({ fileId, mimeType, media })` does not throw; the
// unrecognised `mimeType` becomes a query-string parameter, the server
// ignores it, and with no `requestBody` present the upload silently
// downgrades to a bare `.docx` PATCH with no conversion target. That is how
// a user's native Google Doc gets flattened into a stored binary blob, with
// no exception and no warning.

const DOCX_BUFFER = Buffer.from("pretend docx bytes");

function isPost(req) {
  return req.method === "POST";
}
function isPatch(req) {
  return req.method === "PATCH";
}

describe("files.create — the real client's emitted request (AC-S3)", () => {
  it("carries requestBody.mimeType = the native-Doc type, a media part declaring the docx type, and uploadType=multipart", async () => {
    const requests = await captureDriveRequests((drive) =>
      createDoc(drive, { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: DOCX_BUFFER }),
    );
    const create = requests.find(isPost);
    expect(create).toBeDefined();
    expect(create.params.uploadType).toBe("multipart");
    expect(requestBodyOf(create)).toMatchObject({ mimeType: DOCS_MIME });
    expect(mediaContentTypeOf(create)).toBe(DOCX_MIME);
  });
});

describe("files.create with adopt:false — no duplicate-check list at all (BLOCKER-1)", () => {
  it("issues exactly one request — the create — and never a files.list", async () => {
    const requests = await captureDriveRequests((drive) =>
      createDoc(drive, { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: DOCX_BUFFER, adopt: false }),
    );
    expect(requests).toHaveLength(1);
    const [create] = requests;
    expect(create.method).toBe("POST");
    expect(create.params.uploadType).toBe("multipart");
    expect(requestBodyOf(create)).toMatchObject({ mimeType: DOCS_MIME });
    expect(mediaContentTypeOf(create)).toBe(DOCX_MIME);
  });
});

describe("files.update — the real client's emitted request (AC-S30)", () => {
  it("carries requestBody.mimeType = the native-Doc type, a media part declaring the docx type, and uploadType=multipart", async () => {
    const requests = await captureDriveRequests((drive) =>
      updateDoc(drive, { fileId: "FILE123", docxBuffer: DOCX_BUFFER }),
    );
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.method).toBe("PATCH");
    expect(req.url).toBe("https://www.googleapis.com/upload/drive/v3/files/FILE123");
    expect(req.params.uploadType).toBe("multipart");
    expect(requestBodyOf(req)).toMatchObject({ mimeType: DOCS_MIME });
    expect(mediaContentTypeOf(req)).toBe(DOCX_MIME);
  });

  it("re-sends the conversion target on every update, not just the first (AC-S30)", async () => {
    // Schema$File.mimeType is write-conditional, not output-only
    // (v3.d.ts:1063) — the field this whole file exists to keep pinned.
    const requests = await captureDriveRequests(async (drive) => {
      await updateDoc(drive, { fileId: "FILE_A", docxBuffer: DOCX_BUFFER });
      await updateDoc(drive, { fileId: "FILE_B", docxBuffer: DOCX_BUFFER });
    });
    expect(requests).toHaveLength(2);
    for (const req of requests) {
      expect(requestBodyOf(req)).toMatchObject({ mimeType: DOCS_MIME });
    }
  });
});

describe("the emitted query string equals a literal, for every call site (AC-S4)", () => {
  it("files.update", async () => {
    const [req] = await captureDriveRequests((drive) =>
      updateDoc(drive, { fileId: "FILE123", docxBuffer: DOCX_BUFFER }),
    );
    // A key the client silently relocated into the URL (apirequest.js:
    // 202-232) would change this string — that is exactly the failure this
    // criterion pins shut.
    expect(req.queryString).toBe(
      `fields=${encodeURIComponent(DRIVE_FIELDS)}&uploadType=multipart`,
    );
  });

  it("files.create", async () => {
    const requests = await captureDriveRequests((drive) =>
      createDoc(drive, { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: DOCX_BUFFER }),
    );
    const create = requests.find(isPost);
    expect(create.queryString).toBe(
      `fields=${encodeURIComponent(DRIVE_FIELDS)}&uploadType=multipart`,
    );
  });

  it("files.list (the create-time duplicate guard)", async () => {
    const requests = await captureDriveRequests((drive) =>
      createDoc(drive, { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: DOCX_BUFFER }),
    );
    const list = requests.find((r) => r.method === "GET" && r.url.endsWith("/drive/v3/files"));
    expect(list).toBeDefined();
    // The library's own serializer (qs, arrayFormat:'repeat') percent-encodes
    // sub-delimiters like `'`, `(`, `)` that plain encodeURIComponent leaves
    // bare — this is the LITERAL string it produces, not a hand-approximation.
    expect(list.queryString).toBe(
      "q=%27FOLDER1%27%20in%20parents%20and%20name%20%3D%20%27Acme%20-%20SWE%20-%20Resume%27%20and%20trashed%20%3D%20false" +
        "&spaces=drive" +
        "&fields=files%28id%2Cname%2CmimeType%2CwebViewLink%2Cversion%2CmodifiedTime%29" +
        "&pageSize=10",
    );
  });

  it("files.export", async () => {
    // exportDocx() itself is tested in driveClient.test.js; this pins the
    // request-shape half of AC-S4 for the fourth call site using the raw
    // client the same way an update-mistake would be written.
    const [req] = await captureDriveRequests((drive) =>
      drive.files.export({ fileId: "FILE123", mimeType: DOCX_MIME }, { responseType: "arraybuffer" }),
    );
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://www.googleapis.com/drive/v3/files/FILE123/export");
    expect(req.queryString).toBe(`mimeType=${encodeURIComponent(DOCX_MIME)}`);
  });
});

describe("files.update sends no requestBody.name (AC-S13)", () => {
  it("omits name even when the caller passes one", async () => {
    // A rename made directly in Google Docs must survive a save from this
    // app. `updateDoc` accepts `name` for signature symmetry with
    // `createDoc` but must never forward it.
    const [req] = await captureDriveRequests((drive) =>
      updateDoc(drive, { fileId: "FILE123", docxBuffer: DOCX_BUFFER, name: "A Name The Caller Supplied" }),
    );
    const body = requestBodyOf(req);
    expect(body).toBeDefined();
    expect(body.name).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(body, "name")).toBe(false);
  });
});

describe("the broken update shape is pinned as broken — negative control (AC-S31)", () => {
  it("drive.files.update({ fileId, mimeType, media }) — no requestBody — carries uploadType=media and mimeType as a QUERY parameter, which is the defective shape AC-S30 forbids", async () => {
    // This calls the raw client directly with the shape a developer would
    // write by copying files.export's call signature — `mimeType` is a
    // genuine top-level param on files.export, but not on files.update.
    // Verified mechanically: unknown keys fall through to options.params
    // (apirequest.js:232) and, with requestBody absent, the upload branch
    // downgrades to uploadType=media (apirequest.js:213) — a bare .docx
    // PATCH with no conversion target. It does not throw.
    const [req] = await captureDriveRequests((drive) =>
      drive.files.update({
        fileId: "FILE123",
        mimeType: DOCS_MIME,
        media: { mimeType: DOCX_MIME, body: Readable.from(DOCX_BUFFER) },
      }),
    );
    expect(req.method).toBe("PATCH");
    expect(req.params.uploadType).toBe("media");
    expect(req.params.mimeType).toBe(DOCS_MIME); // the conversion target, DROPPED into the query string
    expect(req.queryString).toBe(
      `mimeType=${encodeURIComponent(DOCS_MIME)}&uploadType=media`,
    );
    // No multipart body at all in this shape — the media bytes ARE the
    // entire body (no boundary, no metadata part pinning the conversion
    // target), unlike the correct shape's two-part multipart/related body.
    expect(req.bodyText).toBe(DOCX_BUFFER.toString("utf8"));
    expect(requestBodyOf(req)).toBeUndefined();
    expect(mediaContentTypeOf(req)).toBeUndefined();

    // If a future SDK version starts honouring this shape, THIS assertion is
    // the one that should go red, turning a stale comment into a caught
    // regression: the correct shape (docWriteRequest, exercised above) must
    // never collapse into this one.
    const [correctReq] = await captureDriveRequests((drive) =>
      updateDoc(drive, { fileId: "FILE123", docxBuffer: DOCX_BUFFER }),
    );
    expect(correctReq.params.uploadType).not.toBe(req.params.uploadType);
  });
});
