// The ONLY module in this repo permitted to call `drive.files.*` (ARCH.md
// §8.1, enforced elsewhere by an `[src]` sweep). Every write of a résumé or
// cover letter to Google Drive goes through one of the five functions below.
//
// THE HAZARD THIS FILE EXISTS TO CLOSE
// -------------------------------------
// `files.export` takes `mimeType` as a genuine top-level parameter. `files.
// update` does NOT — `Params$Resource$Files$Update` has `fileId`/
// `requestBody`/`media` and no `mimeType` (verified against the installed
// `googleapis@172.0.0` typings). The googleapis-common request builder lifts
// only `media`, `requestBody` (aliased `resource`), `auth` and `headers` out
// of the params object before serializing everything left over as a QUERY
// STRING (`googleapis-common/apirequest.js:232`). So:
//
//   drive.files.update({ fileId, mimeType: DOCS_MIME, media })   // WRONG
//
// does not throw. `mimeType` silently becomes `?mimeType=...` in the URL,
// the server ignores it, and — because `requestBody` is absent —
// `apirequest.js:213` downgrades the call to `uploadType=media`: a bare
// `.docx` PATCH with no conversion target. That is how a user's native
// Google Doc gets silently flattened into a stored binary blob. It is the
// same silent-key-drop failure class this repo already shipped once
// (`gemini-tools-nesting`, where a misplaced `tools` key never reached
// Google and nothing detected it).
//
// The fix is structural, not "be careful": `createDoc` and `updateDoc` never
// build their own request objects. Both go through the single private
// `docWriteRequest` builder below, which is the only place that decides
// where `mimeType` (the requestBody/metadata part) and the two other
// candidate names live. There is no code path in this file that can write
// the broken shape by accident, because there is no second place that
// builds a write request.
//
// See `driveClient.wire.test.js` for why a test against an injected fake
// Drive client cannot catch this bug at all: a fake sees whatever object the
// caller hands it, so it would happily confirm a `mimeType` key that the
// REAL client silently drops. The wire test asserts the actual HTTP request
// shape (URL, query string, multipart body) produced by the real
// `googleapis` client with only its transport stubbed.

import { Readable } from "node:stream";
import { DOCS_MIME, DOCX_MIME, FOLDER_MIME, DRIVE_FIELDS } from "./driveMime";

/** The one Drive folder this app creates documents into. */
const APP_FOLDER_NAME = "Resume Tailor";

/** `fields` mask for the folder get-or-create path — id is all it needs. */
const FOLDER_ID_FIELDS = "id";

/** `fields` mask for the pre-update read (ARCH.md §7.4). */
const DOC_META_FIELDS = "id,mimeType,trashed,explicitlyTrashed,version,name,webViewLink";

/**
 * Escape a value for use inside a Drive `q` search-query string literal.
 * Google's own rule (search-files guide): backslash and single-quote must
 * both be backslash-escaped. Applied to every user-controlled string
 * (folder name, document name) that lands inside a `q` filter in this file.
 */
function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * The ONE place in this file that builds a `files.create` / `files.update`
 * request body. `createDoc` and `updateDoc` both call this — never their own
 * option bag — so the mimeType placement (conversion target in
 * `requestBody`, source type in `media`) cannot drift between the two call
 * sites. `name`/`parents` are omitted entirely when not supplied rather than
 * sent as `undefined`, so an update never accidentally carries a rename or a
 * re-parent (AC-S13, AC-S23).
 *
 * `media.body` MUST be a Node `Readable`, never a `Buffer` — a raw Buffer
 * has no `.pipe` and the installed client's multipart uploader throws
 * (`googleapis-common/apirequest.js:148-183`).
 */
function docWriteRequest({ name, parents, docxBuffer }) {
  return {
    requestBody: {
      // Conversion TARGET. Re-sent on every call, create or update — Drive
      // treats `mimeType` as write-conditional (no "Output only." marker,
      // `v3.d.ts:1063`) rather than read-only, and omitting it on an update
      // is exactly the auto-detect trap described above.
      mimeType: DOCS_MIME,
      ...(name ? { name } : {}),
      ...(parents ? { parents } : {}),
    },
    media: {
      // Source type of the uploaded bytes.
      mimeType: DOCX_MIME,
      body: Readable.from(docxBuffer),
    },
    fields: DRIVE_FIELDS,
  };
}

/**
 * Resolve the id of this app's "Resume Tailor" Drive folder, reusing a
 * previously-cached id when it is still live, otherwise finding-or-creating
 * it by name (ARCH.md §8.4). Does NOT persist the resolved id anywhere —
 * that is the caller's job (a durable column, not a TTL'd cache).
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {string|null|undefined} cachedFolderId
 * @returns {Promise<string>} the folder's file id
 */
export async function ensureAppFolder(drive, cachedFolderId) {
  if (cachedFolderId) {
    try {
      const res = await drive.files.get({
        fileId: cachedFolderId,
        fields: "id,trashed,explicitlyTrashed",
      });
      // `explicitlyTrashed` (v3.d.ts:960) is the reliable signal — unlike
      // `trashed` (v3.d.ts:1176), it is not writable by unrelated updates.
      if (!res.data.explicitlyTrashed) return res.data.id;
    } catch (err) {
      const status = err?.status ?? err?.response?.status;
      if (status !== 404) throw err;
      // 404: the cached folder is gone. Fall through to find-or-create.
    }
  }

  const q = [
    `mimeType = '${FOLDER_MIME}'`,
    `name = '${escapeDriveQueryValue(APP_FOLDER_NAME)}'`,
    "trashed = false",
  ].join(" and ");
  const hits = await drive.files.list({
    q,
    spaces: "drive",
    fields: "files(id,name)",
    pageSize: 10,
  });
  const existing = hits?.data?.files?.[0];
  if (existing) return existing.id;

  const created = await drive.files.create({
    requestBody: { name: APP_FOLDER_NAME, mimeType: FOLDER_MIME },
    // No `media` on this request — that absence is what routes it to the
    // plain JSON endpoint instead of the upload endpoint
    // (`apirequest.js:202`: the upload branch is gated on `media.body`).
    fields: FOLDER_ID_FIELDS,
  });
  return created.data.id;
}

/**
 * Create a new Doc, or — the BLK-4 / MAJ-11 guard (ARCH.md §8.2) — adopt and
 * update an existing Doc of the same name in the same folder if one is
 * already there. Without this, a create that succeeds followed by a failed
 * persistence step and a retried save produces a duplicate Doc, which AM-3
 * forbids.
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {{ name: string, folderId: string, docxBuffer: Buffer }} args
 * @returns {Promise<object>} the raw `Schema$File` fields named by `DRIVE_FIELDS`
 */
export async function createDoc(drive, { name, folderId, docxBuffer }) {
  const clauses = [`name = '${escapeDriveQueryValue(name)}'`, "trashed = false"];
  if (folderId) clauses.unshift(`'${folderId}' in parents`);
  const hits = await drive.files.list({
    q: clauses.join(" and "),
    spaces: "drive",
    fields: "files(id,name,mimeType,webViewLink,version,modifiedTime)",
    pageSize: 10,
  });
  const existing = hits?.data?.files?.[0];
  if (existing) {
    // Adopt: repoint onto the existing Doc rather than create a duplicate.
    return updateDoc(drive, { fileId: existing.id, docxBuffer });
  }

  const parents = folderId ? [folderId] : undefined;
  const res = await drive.files.create(docWriteRequest({ name, parents, docxBuffer }));
  return res.data;
}

/**
 * Replace the contents of an existing Doc in place, preserving its `fileId`
 * (and therefore its URL, sharing state, comments and version history) —
 * verified achievable at `OQ-ANSWERS.md` Q1, provided `requestBody.mimeType`
 * is re-sent, which `docWriteRequest` always does.
 *
 * `name` is accepted for signature symmetry with `createDoc` but is NEVER
 * forwarded into the request: AC-S13 requires `files.update` to send no
 * `requestBody.name`, so a rename the user made directly in Google Docs
 * survives a save from this app. Do not "fix" this by wiring `name` in.
 *
 * The caller is responsible for checking the returned `mimeType` against
 * `DOCS_MIME`: a value that doesn't match means the conversion did not hold
 * and this write must NOT be reported as a successful Doc save (ARCH.md
 * §8.1's post-write assertion) — this module only builds and dispatches the
 * request, it does not classify the outcome.
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {{ fileId: string, docxBuffer: Buffer, name?: string }} args
 * @returns {Promise<object>} the raw `Schema$File` fields named by `DRIVE_FIELDS`
 */
export async function updateDoc(drive, { fileId, docxBuffer, name }) {
  void name; // intentionally unused — see doc comment above (AC-S13)
  const res = await drive.files.update({
    fileId,
    ...docWriteRequest({ docxBuffer }),
  });
  return res.data;
}

/**
 * Read a Doc's metadata ahead of a save (ARCH.md §7.4's pre-flight): whether
 * it is still a native Doc, whether it has been trashed, and its current
 * `version` for the three-way conflict compare (AC-S14).
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {string} fileId
 * @returns {Promise<object>}
 */
export async function getDocMeta(drive, fileId) {
  const res = await drive.files.get({
    fileId,
    fields: DOC_META_FIELDS,
  });
  return res.data;
}

/**
 * Export a Doc back to `.docx` bytes. `responseType: "arraybuffer"` is
 * mandatory and MUST be the second (options) argument, not a field inside
 * the first: with no `responseType`, gaxios 7.1.4 falls through to
 * `getResponseDataFromContentType`, which returns a `Blob` for a `.docx`
 * response, and `Buffer.from(blob)` silently produces a garbage 0/1-byte
 * buffer rather than throwing.
 *
 * @param {import('googleapis').drive_v3.Drive} drive
 * @param {string} fileId
 * @returns {Promise<Buffer>}
 */
export async function exportDocx(drive, fileId) {
  const res = await drive.files.export(
    { fileId, mimeType: DOCX_MIME },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(res.data);
}
