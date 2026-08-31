import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { google } from "googleapis";

// THE HAZARD THIS FILE EXISTS TO CLOSE (see driveClient.js / driveWireProbe.js
// for the full mechanism). `files.export` takes `mimeType` as a genuine
// top-level parameter; `files.update` does not — writing
// `drive.files.update({ fileId, mimeType, media })` does not throw. The
// unrecognised `mimeType` becomes a query-string parameter, the server
// ignores it, and — because `requestBody` is now absent — the upload
// downgrades to `uploadType=media`: a bare `.docx` PATCH with no conversion
// target. That is how a user's native Google Doc gets silently flattened
// into a stored binary blob, with no exception and no warning.
//
// `driveClient.wire.test.js` (Wave 2A) already pins this at the
// `driveClient.js` function boundary. THIS file pins it one layer further
// out — through the actual deployed entry point, `POST /api/drive/save` —
// so a future edit that has the route build any part of the write request
// itself (bypassing `createDoc`/`updateDoc`) is caught here even if it never
// touches driveClient.js. Only `@/lib/supabase/server`,
// `@/lib/drive/driveTokens` and `@/lib/supabase/driveDocuments` are mocked,
// at their module boundaries — `@/lib/drive/driveClient` and `googleapis`
// itself are the REAL modules. `driveTokens.authorizedDriveClient` is mocked
// to hand the route the driveWireProbe-stubbed `drive` client instead of
// building its own — only the network transport is replaced, nothing about
// request construction is bypassed.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/drive/driveTokens", () => ({
  authorizedDriveClient: vi.fn(),
  saveDriveTokens: vi.fn(async () => ({ connection: {}, error: null })),
}));
vi.mock("@/lib/supabase/driveDocuments", () => ({
  resolvePositionId: vi.fn(async () => null),
  listDriveDocuments: vi.fn(async () => ({ documents: {}, error: null })),
  upsertDriveDocument: vi.fn(async () => ({ document: null, error: null })),
}));

import { POST } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { authorizedDriveClient } from "@/lib/drive/driveTokens";
import { resolvePositionId, listDriveDocuments } from "@/lib/supabase/driveDocuments";
import { captureDriveRequests, requestBodyOf, mediaContentTypeOf } from "@/lib/drive/driveWireProbe";
import { DOCS_MIME, DOCX_MIME } from "@/lib/drive/driveMime";

const DOCX_BUFFER_BYTES = [1, 2, 3, 4, 5];

function makeFile() {
  return new File([new Uint8Array(DOCX_BUFFER_BYTES)], "resume.docx", { type: DOCX_MIME });
}

function saveRequest(meta) {
  const fd = new FormData();
  fd.append("file", makeFile());
  fd.append("meta", JSON.stringify(meta));
  return { url: "http://localhost/api/drive/save", formData: async () => fd };
}

function isPost(req) {
  return req.method === "POST" && req.url.includes("/upload/drive/v3/files");
}
function isPatch(req) {
  return req.method === "PATCH";
}

// WAVE4-SEAMS.md GAP 2: `requestBodyOf`/`mediaContentTypeOf` (driveWireProbe.js)
// pin the media part's declared content-TYPE but never its actual bytes — an
// empty upload passed every existing test, including this file's own. This
// pulls the raw payload out of the captured multipart body so a test can
// assert the bytes on the wire are the bytes the route was given. Kept local
// (rather than added to the shared driveWireProbe.js, which this wave does
// not own) because only this file's BLOCKER-1/GAP-2 tests need it.
function mediaBodyOf(req) {
  const text = req?.bodyText;
  if (typeof text !== "string") return undefined;
  const parts = text.split(/--[^\r\n]+\r\n/).filter((p) => p.trim().length > 0);
  const mediaPart = parts.find((p) => !p.startsWith("content-type: application/json"));
  if (!mediaPart) return undefined;
  const headerEnd = mediaPart.indexOf("\r\n\r\n");
  if (headerEnd === -1) return undefined;
  // Strip the trailing closing-boundary marker (`\r\n--<boundary>--`) that
  // the split above leaves attached to the LAST part, since it has no
  // trailing CRLF of its own to match the split regex.
  return mediaPart.slice(headerEnd + 4).replace(/\r\n--[^\r\n]*--$/, "");
}

function bodyTextOf(options) {
  const { data } = options;
  if (data == null) return Promise.resolve(undefined);
  if (typeof data === "string") return Promise.resolve(data);
  if (typeof data.pipe === "function") {
    return new Promise((resolve, reject) => {
      const chunks = [];
      data.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      data.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      data.on("error", reject);
    });
  }
  try {
    return Promise.resolve(JSON.stringify(data));
  } catch {
    return Promise.resolve(undefined);
  }
}

// WAVE4-SEAMS.md BLOCKER-1's route-level proof needs `files.get`, the
// duplicate-check `files.list` and the eventual `files.create`/`files.update`
// to each answer DIFFERENTLY within the course of one save — driveWireProbe's
// `captureDriveRequests` answers every request with the same canned `data`,
// which cannot express "the conflicted Doc a still-adopting createDoc would
// find and PATCH". This is the same real `googleapis` client with only the
// transport stubbed, exactly like `captureDriveRequests` — the only
// difference is the response is chosen per request.
async function captureRoutedDriveRequests(run, responder) {
  const captured = [];
  const stubAuth = {
    async request(options) {
      const req = {
        url: options.url,
        method: options.method,
        params: { ...(options.params || {}) },
        queryString:
          options.params && typeof options.paramsSerializer === "function"
            ? options.paramsSerializer(options.params)
            : "",
        bodyText: await bodyTextOf(options),
      };
      captured.push(req);
      return { data: responder(req) ?? {}, status: 200, headers: {} };
    },
  };
  const drive = google.drive({ version: "v3", auth: stubAuth });
  await run(drive);
  return captured;
}

createClient.mockResolvedValue({
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
});

const ENV = () => {
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "shh-secret";
};

describe("POST /api/drive/save — files.create, through the real route (AC-S3)", () => {
  it("the emitted create request carries requestBody.mimeType = the native-Doc type, a media part declaring the docx type, and uploadType=multipart", async () => {
    ENV();
    // No cached folder id -> ensureAppFolder's files.list finds no match
    // (the canned response below has no `files` array) and creates the
    // folder; createDoc's own dup-check files.list also finds no match on
    // the same canned response, so the real create request fires.
    const cannedFolderAndDoc = {
      id: "FOLDER1",
      trashed: false,
      explicitlyTrashed: false,
      mimeType: DOCS_MIME,
      name: "Acme - SWE - Resume",
      webViewLink: "https://docs.google.com/document/d/FOLDER1/edit",
      version: "1",
    };

    const requests = await captureDriveRequests(
      async (drive) => {
        authorizedDriveClient.mockResolvedValue({ ok: true, drive, connection: { folder_id: null } });
        const res = await POST(
          saveRequest({ jobId: "job-1", scope: "resume", name: "Acme - SWE - Resume", contentHash: "h" }),
        );
        expect(res.status).toBe(200);
      },
      { data: cannedFolderAndDoc },
    );

    const create = requests.find(isPost);
    expect(create).toBeDefined();
    expect(create.params.uploadType).toBe("multipart");
    expect(requestBodyOf(create)).toMatchObject({ mimeType: DOCS_MIME });
    expect(mediaContentTypeOf(create)).toBe(DOCX_MIME);
    // WAVE4-SEAMS.md GAP 2: the media part's declared content-TYPE was
    // pinned above, but not its actual bytes — an empty upload passed every
    // existing test including this one. This is the bytes-on-the-wire check.
    expect(mediaBodyOf(create)).toBe(Buffer.from(DOCX_BUFFER_BYTES).toString("utf8"));

    // The exact request this criterion pins, for the record:
    //   POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=...
    //   multipart/related body:
    //     part 1 (application/json): { "mimeType": "application/vnd.google-apps.document", "name": "...", "parents": ["FOLDER1"] }
    //     part 2 (application/vnd.openxmlformats-officedocument.wordprocessingml.document): <docx bytes>
    expect(create.url).toBe("https://www.googleapis.com/upload/drive/v3/files");
  });
});

describe("POST /api/drive/save — files.update, through the real route (AC-S30)", () => {
  it("the emitted update request carries requestBody.mimeType = the native-Doc type, a media part declaring the docx type, and uploadType=multipart", async () => {
    ENV();
    const cannedDoc = {
      id: "FILE123",
      trashed: false,
      explicitlyTrashed: false,
      mimeType: DOCS_MIME,
      name: "Acme - SWE - Resume",
      webViewLink: "https://docs.google.com/document/d/FILE123/edit",
      version: "5",
    };

    const requests = await captureDriveRequests(
      async (drive) => {
        authorizedDriveClient.mockResolvedValue({ ok: true, drive, connection: { folder_id: "FOLDER1" } });
        const res = await POST(
          saveRequest({
            jobId: "job-1",
            scope: "resume",
            name: "Acme - SWE - Resume",
            contentHash: "h",
            knownRef: { fileId: "FILE123", version: "5" },
            clientVersion: "5",
          }),
        );
        expect(res.status).toBe(200);
      },
      { data: cannedDoc },
    );

    const update = requests.find(isPatch);
    expect(update).toBeDefined();
    expect(update.url).toBe("https://www.googleapis.com/upload/drive/v3/files/FILE123");
    expect(update.params.uploadType).toBe("multipart");
    expect(requestBodyOf(update)).toMatchObject({ mimeType: DOCS_MIME });
    expect(mediaContentTypeOf(update)).toBe(DOCX_MIME);
    // WAVE4-SEAMS.md GAP 2: bytes-on-the-wire, not just content-type.
    expect(mediaBodyOf(update)).toBe(Buffer.from(DOCX_BUFFER_BYTES).toString("utf8"));

    // AC-S13: no name on an update, even though the route computed one.
    const body = requestBodyOf(update);
    expect(Object.prototype.hasOwnProperty.call(body, "name")).toBe(false);

    // THE EXACT EMITTED REQUEST THIS CRITERION PINS:
    //   PATCH https://www.googleapis.com/upload/drive/v3/files/FILE123?uploadType=multipart&fields=...
    //   multipart/related body:
    //     part 1 (application/json): { "mimeType": "application/vnd.google-apps.document" }
    //     part 2 (application/vnd.openxmlformats-officedocument.wordprocessingml.document): <docx bytes>
  });
});

describe("the broken update shape is pinned as broken — negative control (AC-S31)", () => {
  it("drive.files.update({ fileId, mimeType, media }) — no requestBody — carries uploadType=media and mimeType as a QUERY parameter, which the route's own real update request (above) never produces", async () => {
    const DOCX_BUFFER = Buffer.from(DOCX_BUFFER_BYTES);

    // This calls the raw client directly with the shape a developer would
    // write by copying files.export's call signature — verified
    // mechanically: unknown keys fall through to options.params
    // (apirequest.js:232) and, with requestBody absent, the upload branch
    // downgrades to uploadType=media (apirequest.js:213) — a bare .docx
    // PATCH with no conversion target. It does not throw.
    const [broken] = await captureDriveRequests((drive) =>
      drive.files.update({
        fileId: "FILE123",
        mimeType: DOCS_MIME,
        media: { mimeType: DOCX_MIME, body: Readable.from(DOCX_BUFFER) },
      }),
    );
    expect(broken.method).toBe("PATCH");
    expect(broken.params.uploadType).toBe("media");
    expect(broken.params.mimeType).toBe(DOCS_MIME); // the conversion target, DROPPED into the query string
    expect(broken.queryString).toBe(`mimeType=${encodeURIComponent(DOCS_MIME)}&uploadType=media`);
    // No multipart body at all — the media bytes ARE the entire body.
    expect(broken.bodyText).toBe(DOCX_BUFFER.toString("utf8"));
    expect(requestBodyOf(broken)).toBeUndefined();
    expect(mediaContentTypeOf(broken)).toBeUndefined();

    // The route's own real update (previous describe block) must never
    // collapse into this shape — re-derived here so this file is a complete,
    // self-contained pin even if the other block's assertions ever change.
    ENV();
    const cannedDoc = {
      id: "FILE123",
      trashed: false,
      explicitlyTrashed: false,
      mimeType: DOCS_MIME,
      name: "Acme - SWE - Resume",
      webViewLink: "https://docs.google.com/document/d/FILE123/edit",
      version: "5",
    };
    const requests = await captureDriveRequests(
      async (drive) => {
        authorizedDriveClient.mockResolvedValue({ ok: true, drive, connection: { folder_id: "FOLDER1" } });
        await POST(
          saveRequest({
            jobId: "job-1",
            scope: "resume",
            name: "Acme - SWE - Resume",
            contentHash: "h",
            knownRef: { fileId: "FILE123", version: "5" },
            clientVersion: "5",
          }),
        );
      },
      { data: cannedDoc },
    );
    const routeUpdate = requests.find(isPatch);
    expect(routeUpdate.params.uploadType).not.toBe(broken.params.uploadType);
    expect(Object.prototype.hasOwnProperty.call(routeUpdate.params, "mimeType")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WAVE4-SEAMS.md BLOCKER-1 — "Save as a new Doc" must never PATCH the Doc
// it exists to preserve.
//
// `route.test.js` mocks `@/lib/drive/driveClient` wholesale, so its
// "onConflict:'new' bypasses the compare and creates a new Doc" test can
// only prove the ROUTE didn't call `updateDoc` — it cannot see that the
// real `createDoc` (driveClient.js's own `files.list`-by-name adoption
// guard) finds the conflicted Doc, because it carries the exact same name,
// and PATCHes it internally. This test goes through the REAL driveClient
// and the REAL googleapis client, transport stubbed only, so that internal
// PATCH is directly observable on the wire.
// ---------------------------------------------------------------------------
describe("POST /api/drive/save — onConflict:'new' through the REAL driveClient (BLOCKER-1)", () => {
  it("issues a files.create and PATCHes nothing, leaving the conflicted Doc untouched", async () => {
    ENV();
    resolvePositionId.mockResolvedValueOnce("pos-1");
    listDriveDocuments.mockResolvedValueOnce({
      documents: { resume: { drive_file_id: "CONFLICTED1", drive_file_version: "1" } },
      error: null,
    });

    const CONFLICTED_DOC = {
      id: "CONFLICTED1",
      trashed: false,
      explicitlyTrashed: false,
      mimeType: DOCS_MIME,
      name: "Acme - SWE - Resume",
      webViewLink: "https://docs.google.com/document/d/CONFLICTED1/edit",
      version: "7", // ahead of the row's "1" — this is what makes it a conflict
    };
    const NEW_DOC = {
      id: "NEWDOC1",
      mimeType: DOCS_MIME,
      name: "Acme - SWE - Resume (new copy)",
      webViewLink: "https://docs.google.com/document/d/NEWDOC1/edit",
      version: "1",
    };

    function responder(req) {
      if (req.method === "GET" && req.url === "https://www.googleapis.com/drive/v3/files/FOLDER1") {
        return { id: "FOLDER1", explicitlyTrashed: false }; // ensureAppFolder's cached-id read
      }
      if (req.method === "GET" && req.url === "https://www.googleapis.com/drive/v3/files/CONFLICTED1") {
        return CONFLICTED_DOC; // the route's own pre-update getDocMeta
      }
      if (req.method === "GET" && req.url === "https://www.googleapis.com/drive/v3/files") {
        // createDoc's duplicate-check files.list — answers with a hit for
        // the conflicted Doc, exactly as the real Drive would (same name,
        // same folder). A still-adopting createDoc would find this and
        // PATCH it; the fixed one (`adopt:false`) must never even issue
        // this request in the onConflict:"new" branch.
        return {
          files: [
            {
              id: "CONFLICTED1",
              name: "Acme - SWE - Resume",
              mimeType: DOCS_MIME,
              webViewLink: CONFLICTED_DOC.webViewLink,
              version: "7",
              modifiedTime: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (req.method === "POST" && req.url === "https://www.googleapis.com/upload/drive/v3/files") {
        return NEW_DOC; // the create this button is supposed to make
      }
      if (req.method === "PATCH") {
        // Should never be reached in this scenario — answered harmlessly so
        // a regression doesn't also throw and mask its own detection; the
        // assertions below are what actually catch it.
        return { id: "CONFLICTED1", mimeType: DOCS_MIME };
      }
      return {};
    }

    let res;
    const requests = await captureRoutedDriveRequests(async (drive) => {
      authorizedDriveClient.mockResolvedValue({ ok: true, drive, connection: { folder_id: "FOLDER1" } });
      res = await POST(
        saveRequest({
          jobId: "job-1",
          scope: "resume",
          name: "Acme - SWE - Resume",
          contentHash: "h",
          clientVersion: "1",
          onConflict: "new",
        }),
      );
    }, responder);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.fileId).toBe("NEWDOC1");

    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(0); // the conflicted Doc is never touched — the whole point of the button

    const creates = requests.filter((r) => r.method === "POST" && r.url.endsWith("/upload/drive/v3/files"));
    expect(creates).toHaveLength(1);
    expect(requestBodyOf(creates[0])).toMatchObject({ mimeType: DOCS_MIME });
    expect(mediaContentTypeOf(creates[0])).toBe(DOCX_MIME);
    expect(mediaBodyOf(creates[0])).toBe(Buffer.from(DOCX_BUFFER_BYTES).toString("utf8"));

    // The disambiguation guard: the new Doc must not carry the exact same
    // name as the conflicted one it deliberately did not touch.
    const createBody = requestBodyOf(creates[0]);
    expect(createBody.name).not.toBe("Acme - SWE - Resume");
    expect(createBody.name).toContain("Acme - SWE - Resume");
  });
});

// ---------------------------------------------------------------------------
// WAVE4-REVERIFY.md MAJOR-2 — the disambiguating suffix must protect the
// RIGHT Doc. After a "Save as a new Doc", the preserved original keeps the
// exact plain name the app's own by-name adoption lookup (createDoc's
// `adopt: true` path) searches for. If a LATER "ordinary" save ends up with
// no known ref (e.g. its `drive_documents` upsert never landed, so the row
// this test's second POST would otherwise read is missing) and falls back
// to that by-name lookup, it will find and PATCH the preserved original —
// the exact data loss BLOCKER-1 exists to prevent, reached through a
// different door. The fix is `save/route.js`'s `existingRef` resolution
// consulting the client's session-local `knownRef` whenever the durable row
// didn't resolve one (not only when there is no position id at all) — the
// SAME client, moments later, already holds the id its own previous
// response (`fileId: "NEWDOC1"` below) handed it.
//
// Run through the REAL driveClient and REAL googleapis client (transport
// stubbed only), like the BLOCKER-1 test above: a test that mocks
// `driveClient` wholesale cannot see createDoc's own internal by-name PATCH
// at all — that is exactly how the underlying defect this fix reopens (via
// a different call path) would hide.
// ---------------------------------------------------------------------------
describe("POST /api/drive/save — an ordinary save after 'Save as a new Doc' never re-finds the preserved original (MAJOR-2)", () => {
  it("asserts the ordinary save PATCHes the doc it already knows about, and never the preserved original", async () => {
    ENV();

    const CONFLICTED_DOC = {
      id: "CONFLICTED1",
      trashed: false,
      explicitlyTrashed: false,
      mimeType: DOCS_MIME,
      name: "Acme - SWE - Resume",
      webViewLink: "https://docs.google.com/document/d/CONFLICTED1/edit",
      version: "7",
    };
    const NEW_DOC = {
      id: "NEWDOC1",
      trashed: false,
      explicitlyTrashed: false,
      mimeType: DOCS_MIME,
      name: "Acme - SWE - Resume (new copy)",
      webViewLink: "https://docs.google.com/document/d/NEWDOC1/edit",
      version: "1",
    };

    function responder(req) {
      if (req.method === "GET" && req.url === "https://www.googleapis.com/drive/v3/files/FOLDER1") {
        return { id: "FOLDER1", explicitlyTrashed: false }; // ensureAppFolder's cached-id read
      }
      if (req.method === "GET" && req.url === "https://www.googleapis.com/drive/v3/files/CONFLICTED1") {
        return CONFLICTED_DOC; // save #1's pre-update getDocMeta
      }
      if (req.method === "GET" && req.url === "https://www.googleapis.com/drive/v3/files/NEWDOC1") {
        return NEW_DOC; // save #2's pre-update getDocMeta, IF it correctly uses the known id
      }
      if (req.method === "GET" && req.url === "https://www.googleapis.com/drive/v3/files") {
        // createDoc's by-name duplicate-check list — must NEVER be issued by
        // either save in this scenario (save #1 uses adopt:false; a FIXED
        // save #2 already has a ref and never calls createDoc at all).
        // Answered with a hit on the preserved original so a regression
        // that DOES reach this path is directly observable rather than
        // masked by an empty response.
        return {
          files: [
            {
              id: "CONFLICTED1",
              name: "Acme - SWE - Resume",
              mimeType: DOCS_MIME,
              webViewLink: CONFLICTED_DOC.webViewLink,
              version: "7",
              modifiedTime: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (req.method === "POST" && req.url === "https://www.googleapis.com/upload/drive/v3/files") {
        return NEW_DOC; // save #1's create
      }
      if (req.method === "PATCH") {
        // Answered harmlessly regardless of target so a misdirected PATCH
        // doesn't also throw and mask its own detection — the assertions
        // below (on the captured request list) are what actually catch it.
        return { id: "PATCHED", mimeType: DOCS_MIME, version: "2" };
      }
      return {};
    }

    resolvePositionId.mockResolvedValueOnce("pos-1"); // save #1
    listDriveDocuments.mockResolvedValueOnce({
      documents: { resume: { drive_file_id: "CONFLICTED1", drive_file_version: "1" } },
      error: null,
    });
    resolvePositionId.mockResolvedValueOnce("pos-1"); // save #2 — same posting
    listDriveDocuments.mockResolvedValueOnce({
      // The row this save would otherwise read is missing — e.g. save #1's
      // upsertDriveDocument never landed. This is the exact reproducing
      // condition: no durable ref for this position+scope.
      documents: {},
      error: null,
    });

    let res1;
    let res2;
    const requests = await captureRoutedDriveRequests(async (drive) => {
      authorizedDriveClient.mockResolvedValue({ ok: true, drive, connection: { folder_id: "FOLDER1" } });

      // Save #1: "Save as a new Doc" — creates NEWDOC1, leaves CONFLICTED1 alone.
      res1 = await POST(
        saveRequest({
          jobId: "job-1",
          scope: "resume",
          name: "Acme - SWE - Resume",
          contentHash: "h1",
          clientVersion: "1",
          onConflict: "new",
        }),
      );
      const body1 = await res1.json();

      // Save #2: an ORDINARY save (no onConflict) moments later, from the
      // same client — which already holds the id save #1's own response
      // just handed it (`body1.fileId`). No durable row resolves (mocked
      // above), so this is exactly the call site that used to fall through
      // to createDoc's by-name lookup.
      res2 = await POST(
        saveRequest({
          jobId: "job-1",
          scope: "resume",
          name: "Acme - SWE - Resume",
          contentHash: "h2",
          clientVersion: "1",
          knownRef: { fileId: body1.fileId, version: "1" },
        }),
      );
    }, responder);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // save #1: the button's whole job — the conflicted Doc is never touched,
    // and a fresh, distinctly-named Doc is created.
    const creates = requests.filter((r) => r.method === "POST" && r.url.endsWith("/upload/drive/v3/files"));
    expect(creates).toHaveLength(1);

    // THE ASSERTION: across BOTH saves, exactly one PATCH ever lands, and it
    // targets the doc save #2 already knew about (NEWDOC1) — never the
    // preserved original (CONFLICTED1). A pre-fix `existingRef` (row-only,
    // ignoring knownRef here) would leave save #2 with no ref at all, fall
    // into createDoc's by-name lookup, and PATCH CONFLICTED1 instead.
    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe("https://www.googleapis.com/upload/drive/v3/files/NEWDOC1");
    expect(patches.some((p) => p.url.includes("CONFLICTED1"))).toBe(false);

    // The mechanism: createDoc's by-name duplicate-check list is never
    // issued by either save — save #1 because `adopt:false`, save #2
    // because it never reaches createDoc at all once it has a ref.
    const byNameLookups = requests.filter(
      (r) => r.method === "GET" && r.url === "https://www.googleapis.com/drive/v3/files",
    );
    expect(byNameLookups).toHaveLength(0);
  });
});
