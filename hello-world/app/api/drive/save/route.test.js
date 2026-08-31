import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This route must never touch `drive.files.*` itself — every write goes
// through `lib/drive/driveClient.js`, which is why that module (and
// `driveTokens.js`, `driveDocuments.js`, the session client) are mocked at
// their module boundaries rather than at `googleapis`: this file tests the
// route's OWN branching (which function gets called, with what args, and
// how each response maps), not the wire shape — that is
// `route.wire.test.js`'s job, against the real client.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/drive/driveTokens", () => ({
  authorizedDriveClient: vi.fn(),
  saveDriveTokens: vi.fn(),
}));
vi.mock("@/lib/drive/driveClient", () => ({
  createDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDocMeta: vi.fn(),
  ensureAppFolder: vi.fn(),
}));
vi.mock("@/lib/supabase/driveDocuments", () => ({
  resolvePositionId: vi.fn(),
  listDriveDocuments: vi.fn(),
  upsertDriveDocument: vi.fn(),
}));

import { POST } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { authorizedDriveClient, saveDriveTokens } from "@/lib/drive/driveTokens";
import { createDoc, updateDoc, getDocMeta, ensureAppFolder } from "@/lib/drive/driveClient";
import { resolvePositionId, listDriveDocuments, upsertDriveDocument } from "@/lib/supabase/driveDocuments";
import { DOCS_MIME, DOCX_MIME } from "@/lib/drive/driveMime";
import { DRIVE_UPLOAD_MAX_BYTES } from "@/lib/drive/driveSize";

const ROUTE_PATH = fileURLToPath(new URL("./route.js", import.meta.url));

function makeFile({ name = "resume.docx", size, bytes = [1, 2, 3, 4] } = {}) {
  const file = new File([new Uint8Array(bytes)], name, { type: DOCX_MIME });
  if (typeof size === "number") Object.defineProperty(file, "size", { value: size });
  return file;
}

function baseMeta(overrides = {}) {
  return {
    jobId: "job-1",
    scope: "resume",
    name: "Acme - SWE - Resume",
    jobTitle: "SWE",
    company: "Acme",
    contentHash: "hash-abc",
    ...overrides,
  };
}

function saveRequest({ file = makeFile(), meta = baseMeta(), noFile = false, noMeta = false } = {}) {
  const fd = new FormData();
  if (!noFile) fd.append("file", file);
  if (!noMeta) fd.append("meta", JSON.stringify(meta));
  return { url: "http://localhost/api/drive/save", formData: async () => fd };
}

function docFile(overrides = {}) {
  return {
    id: "FILE1",
    name: "Acme - SWE - Resume",
    webViewLink: "https://docs.google.com/document/d/FILE1/edit",
    version: "1",
    mimeType: DOCS_MIME,
    ...overrides,
  };
}

function driveError({ status, reason, invalidGrant = false } = {}) {
  const err = new Error("drive error");
  if (typeof status === "number") err.status = status;
  if (invalidGrant) err.response = { data: { error: "invalid_grant" } };
  else if (reason) err.response = { data: { error: { errors: [{ reason }] } } };
  return err;
}

function signedIn(userId = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "shh-secret";

  signedIn();
  authorizedDriveClient.mockResolvedValue({
    ok: true,
    drive: { __fake: true },
    connection: { folder_id: "FOLDER1" },
  });
  ensureAppFolder.mockResolvedValue("FOLDER1");
  resolvePositionId.mockResolvedValue("pos-1");
  listDriveDocuments.mockResolvedValue({ documents: {}, error: null });
  upsertDriveDocument.mockResolvedValue({ document: { id: "row-1" }, error: null });
  createDoc.mockResolvedValue(docFile());
  updateDoc.mockResolvedValue(docFile({ version: "2" }));
  getDocMeta.mockResolvedValue({
    id: "FILE1",
    mimeType: DOCS_MIME,
    trashed: false,
    explicitlyTrashed: false,
    version: "1",
    name: "Acme - SWE - Resume",
    webViewLink: "https://docs.google.com/document/d/FILE1/edit",
  });
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

// ---------------------------------------------------------------------------
// [src] this route never assembles a `drive.files.*` call itself.
// ---------------------------------------------------------------------------
describe("[src] the route never writes drive.files.* itself", () => {
  it("contains no drive.files. call — every write goes through driveClient.js", () => {
    const src = readFileSync(ROUTE_PATH, "utf8");
    expect(src).not.toMatch(/\bdrive\.files\.\w+\(/);
  });
});

// ---------------------------------------------------------------------------
// Auth / config gates (AC-S23, AC-S24, AC-C22a)
// ---------------------------------------------------------------------------
describe("gates", () => {
  it("401s when unauthenticated, with zero Drive calls (AC-S24)", async () => {
    signedOut();
    const res = await POST(saveRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(authorizedDriveClient).not.toHaveBeenCalled();
    expect(createDoc).not.toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("503s when Drive isn't configured, before touching the form body (AC-C22a)", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await POST(saveRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("drive_unconfigured");
    expect(authorizedDriveClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------
describe("request validation", () => {
  it("400s when the file part is missing", async () => {
    const res = await POST(saveRequest({ noFile: true }));
    expect(res.status).toBe(400);
  });

  it("400s when meta is missing or unparsable", async () => {
    const res = await POST(saveRequest({ noMeta: true }));
    expect(res.status).toBe(400);
  });

  it("400s on an invalid scope, and never reaches persistence — the 'coverLetter' defect this feature already shipped once (WAVE2-SEAMS.md MAJOR-5)", async () => {
    const res = await POST(saveRequest({ meta: baseMeta({ scope: "coverLetter" }) }));
    expect(res.status).toBe(400);
    expect(createDoc).not.toHaveBeenCalled();
    expect(upsertDriveDocument).not.toHaveBeenCalled();
  });

  it("accepts every real DOCX_SCOPES value (positive control for the scope check)", async () => {
    for (const scope of ["resume", "cover"]) {
      vi.clearAllMocks();
      signedIn();
      authorizedDriveClient.mockResolvedValue({ ok: true, drive: {}, connection: { folder_id: "FOLDER1" } });
      ensureAppFolder.mockResolvedValue("FOLDER1");
      resolvePositionId.mockResolvedValue("pos-1");
      listDriveDocuments.mockResolvedValue({ documents: {}, error: null });
      upsertDriveDocument.mockResolvedValue({ document: { id: "row-1" }, error: null });
      createDoc.mockResolvedValue(docFile());
      const res = await POST(saveRequest({ meta: baseMeta({ scope }) }));
      expect(res.status).toBe(200);
    }
  });

  it("400s when name is blank", async () => {
    const res = await POST(saveRequest({ meta: baseMeta({ name: "  " }) }));
    expect(res.status).toBe(400);
  });

  it("400s when the uploaded file is empty, before ever touching Drive (WAVE4-SEAMS.md GAP 2)", async () => {
    const res = await POST(saveRequest({ file: makeFile({ bytes: [] }) }));
    expect(res.status).toBe(400);
    expect(authorizedDriveClient).not.toHaveBeenCalled();
    expect(createDoc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Size guard (AC-S22b / AC-S25) — the shared DRIVE_UPLOAD_MAX_BYTES constant
// ---------------------------------------------------------------------------
describe("size guard", () => {
  it("413s payload_too_large above DRIVE_UPLOAD_MAX_BYTES, naming 4 MB, before any Drive call", async () => {
    const res = await POST(saveRequest({ file: makeFile({ size: DRIVE_UPLOAD_MAX_BYTES + 1 }) }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("payload_too_large");
    expect(body.limitBytes).toBe(DRIVE_UPLOAD_MAX_BYTES);
    expect(body.message).toMatch(/4 MB/);
    expect(authorizedDriveClient).not.toHaveBeenCalled();
  });

  it("does not reject a file exactly at the limit (positive control)", async () => {
    const res = await POST(saveRequest({ file: makeFile({ size: DRIVE_UPLOAD_MAX_BYTES }) }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Connection gates (AC-E4a, §9.5/AC-C4)
// ---------------------------------------------------------------------------
describe("Drive connection gates", () => {
  it("401 not_connected when there is no stored connection", async () => {
    authorizedDriveClient.mockResolvedValue({ ok: false, reason: "not_connected", error: null });
    const res = await POST(saveRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("not_connected");
  });

  it("503 (never not_connected) when the token store itself errors — e.g. an unapplied migration", async () => {
    authorizedDriveClient.mockResolvedValue({ ok: false, reason: "storage_unavailable", error: "42P01" });
    const res = await POST(saveRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("drive_storage_unavailable");
  });

  it("503 (never not_connected) when listDriveDocuments itself errors", async () => {
    listDriveDocuments.mockResolvedValue({ documents: null, error: "boom" });
    const res = await POST(saveRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("drive_storage_unavailable");
  });
});

// ---------------------------------------------------------------------------
// Create path (no existing reference) — ARCH.md §7.2
// ---------------------------------------------------------------------------
describe("create path", () => {
  it("creates via driveClient.createDoc with the resolved folder and name, and persists the row", async () => {
    const res = await POST(saveRequest());
    expect(res.status).toBe(200);
    expect(createDoc).toHaveBeenCalledWith(
      { __fake: true },
      { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: expect.any(Buffer) },
    );
    expect(updateDoc).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toMatchObject({
      scope: "resume",
      fileId: "FILE1",
      created: true,
      replaced: false,
      persisted: true,
    });
    expect(upsertDriveDocument).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "pos-1",
      "resume",
      expect.objectContaining({ driveFileId: "FILE1", driveContentHash: "hash-abc" }),
    );
  });

  it("in-session only (no resolvable position id): creates, but never persists (AC-P13/AC-P14)", async () => {
    resolvePositionId.mockResolvedValue(null);
    const res = await POST(saveRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.persisted).toBe(false);
    expect(upsertDriveDocument).not.toHaveBeenCalled();
    // and it never even looked up an existing durable row
    expect(listDriveDocuments).not.toHaveBeenCalled();
  });

  it("uses the in-session knownRef instead of a durable lookup when there's no position id", async () => {
    resolvePositionId.mockResolvedValue(null);
    getDocMeta.mockResolvedValue({
      id: "KNOWN1",
      mimeType: DOCS_MIME,
      trashed: false,
      explicitlyTrashed: false,
      version: "9",
      name: "Acme - SWE - Resume",
      webViewLink: "https://docs.google.com/document/d/KNOWN1/edit",
    });
    updateDoc.mockResolvedValue(docFile({ id: "KNOWN1", version: "10" }));
    const res = await POST(
      saveRequest({
        meta: baseMeta({ knownRef: { fileId: "KNOWN1", version: "9" }, clientVersion: "9" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(getDocMeta).toHaveBeenCalledWith({ __fake: true }, "KNOWN1");
    expect(updateDoc).toHaveBeenCalledWith({ __fake: true }, { fileId: "KNOWN1", docxBuffer: expect.any(Buffer) });
    expect(createDoc).not.toHaveBeenCalled();
  });

  it("persists with a null contentHash rather than a bogus string when meta.contentHash is absent", async () => {
    const res = await POST(saveRequest({ meta: baseMeta({ contentHash: undefined }) }));
    expect(res.status).toBe(200);
    expect(upsertDriveDocument).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "pos-1",
      "resume",
      expect.objectContaining({ driveContentHash: null }),
    );
  });

  it("writes the resolved folder id back onto the connection when it differs from the cached one", async () => {
    ensureAppFolder.mockResolvedValue("FOLDER2");
    await POST(saveRequest());
    expect(saveDriveTokens).toHaveBeenCalledWith("user-1", undefined, { folderId: "FOLDER2" });
  });

  it("does not re-write the folder id when it is unchanged", async () => {
    await POST(saveRequest()); // ensureAppFolder resolves "FOLDER1", same as connection.folder_id
    expect(saveDriveTokens).not.toHaveBeenCalled();
  });

  it("WAVE4-SEAMS.md GAP 3/MAJOR-8: blocks the response on the folder-id write-back settling, rather than letting it float", async () => {
    ensureAppFolder.mockResolvedValue("FOLDER2");
    let releaseWriteBack;
    const gate = new Promise((resolve) => {
      releaseWriteBack = resolve;
    });
    saveDriveTokens.mockImplementation(async () => {
      await gate;
      return { connection: {}, error: null };
    });

    const postPromise = POST(saveRequest());

    // Race the real response promise against a real timer, rather than
    // counting a fixed number of microtask turns — draining microtasks by
    // hand is not a reliable proxy for "every other await in the handler
    // has settled" (there are several: upsertDriveDocument, etc.), so an
    // undercounted drain can make a fire-and-forget write-back look awaited
    // by accident. A real macrotask boundary is not fooled by that.
    const STILL_PENDING = Symbol("still-pending");
    const raced = await Promise.race([
      postPromise,
      new Promise((resolve) => setTimeout(() => resolve(STILL_PENDING), 50)),
    ]);
    // A fire-and-forget `void saveDriveTokens(...)` would let the response
    // resolve well inside 50ms regardless of the gate; an awaited call must
    // still be pending here, because the gate has not been released.
    expect(raced).toBe(STILL_PENDING);

    releaseWriteBack();
    const res = await postPromise;
    expect(res.status).toBe(200);
  });

  it("a folder-id write-back failure never fails the save itself (best-effort, awaited only for completion)", async () => {
    ensureAppFolder.mockResolvedValue("FOLDER2");
    saveDriveTokens.mockRejectedValue(new Error("storage hiccup"));
    const res = await POST(saveRequest());
    expect(res.status).toBe(200);
  });

  // WAVE4-REVERIFY.md MAJOR-1's twin: `saveDriveTokens` RESOLVES
  // `{ connection: null, error }` on every realistic storage failure — it
  // does not throw. A bare try/catch around the await alone would never see
  // this shape, so the ordinary failure this guard exists for would stay
  // silently discarded even though nothing THROWS. This is the resolved
  // shape, not the rejection above.
  it("MAJOR-1 twin: a resolved (not thrown) folder-id write-back error is logged, not silently discarded", async () => {
    ensureAppFolder.mockResolvedValue("FOLDER2");
    saveDriveTokens.mockResolvedValue({ connection: null, error: "insert failed" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(saveRequest());
    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0].join(" ")).toContain("insert failed");
    consoleErrorSpy.mockRestore();
  });

  it("a save whose persistence failed, followed by a reload and a second save, still results from one createDoc call each time (createDoc's own dup guard is what prevents a second Doc — ARCH.md §8.2)", async () => {
    upsertDriveDocument.mockResolvedValue({ document: null, error: "insert failed" });
    const first = await POST(saveRequest());
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.persisted).toBe(false); // AC-P9a: the Doc still saved
    // "reload": no durable row exists (persistence never landed), so the
    // second save again finds existing === null and calls createDoc again —
    // createDoc's OWN files.list-by-name guard (driveClient.js) is what
    // adopts rather than duplicates; this route makes no second, weaker
    // copy of that guard.
    listDriveDocuments.mockResolvedValue({ documents: {}, error: null });
    const second = await POST(saveRequest());
    expect(second.status).toBe(200);
    expect(createDoc).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Update-in-place path — ARCH.md §7.4
// ---------------------------------------------------------------------------
describe("update path", () => {
  function withExisting(row = { drive_file_id: "FILE1", drive_file_version: "1" }) {
    listDriveDocuments.mockResolvedValue({ documents: { resume: row }, error: null });
  }

  it("updates in place when versions all agree (positive control for AC-S14)", async () => {
    withExisting();
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(res.status).toBe(200);
    expect(getDocMeta).toHaveBeenCalledWith({ __fake: true }, "FILE1");
    expect(updateDoc).toHaveBeenCalledWith({ __fake: true }, { fileId: "FILE1", docxBuffer: expect.any(Buffer) });
    expect(createDoc).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.created).toBe(false);
    expect(body.replaced).toBe(false);
  });

  it("AC-E7/E9a/E10: a deleted target (404 from getDocMeta) creates a replacement and reports replaced:true", async () => {
    withExisting();
    getDocMeta.mockRejectedValue(driveError({ status: 404, reason: "notFound" }));
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(res.status).toBe(200);
    expect(createDoc).toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.replaced).toBe(true);
  });

  it("BLOCKER-1(b): the replacement create always disables adoption, so createDoc's own guard can't PATCH the stale target back into a Doc — but a gone (404) target gets NO disambiguating suffix (WAVE4-REVERIFY.md MINOR-3: a 404'd id can't be found by createDoc's by-name lookup, so there's nothing to disambiguate from)", async () => {
    withExisting();
    getDocMeta.mockRejectedValue(driveError({ status: 404, reason: "notFound" }));
    await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(createDoc).toHaveBeenCalledWith(
      { __fake: true },
      { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: expect.any(Buffer), adopt: false },
    );
  });

  // WAVE4-REVERIFY.md MINOR-3: the ONE replacement case that can actually
  // collide with createDoc's by-name lookup — the target is still live, in
  // the folder, and simply no longer a native Doc — is the only one that
  // should get the suffix.
  it("MINOR-3: a target that's no longer a native Doc DOES get the disambiguating suffix — it's still findable by name", async () => {
    withExisting();
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: "application/pdf", trashed: false, explicitlyTrashed: false, version: "1",
      name: "X", webViewLink: "Y",
    });
    await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(createDoc).toHaveBeenCalledWith(
      { __fake: true },
      { name: "Acme - SWE - Resume (recovered)", folderId: "FOLDER1", docxBuffer: expect.any(Buffer), adopt: false },
    );
  });

  it("AC-E13: a trashed target (trashed:true from the pre-update get) is treated as deleted, not updated into the Trash — and gets NO suffix, excluded by createDoc's own trashed=false filter (MINOR-3)", async () => {
    withExisting();
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: DOCS_MIME, trashed: true, explicitlyTrashed: false, version: "1",
      name: "X", webViewLink: "Y",
    });
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(res.status).toBe(200);
    expect(createDoc).toHaveBeenCalledWith(
      { __fake: true },
      { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: expect.any(Buffer), adopt: false },
    );
    expect(updateDoc).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.replaced).toBe(true);
  });

  it("explicitlyTrashed also triggers the replacement path, also with no suffix (MINOR-3)", async () => {
    withExisting();
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: true, version: "1",
      name: "X", webViewLink: "Y",
    });
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(res.status).toBe(200);
    expect(createDoc).toHaveBeenCalledWith(
      { __fake: true },
      { name: "Acme - SWE - Resume", folderId: "FOLDER1", docxBuffer: expect.any(Buffer), adopt: false },
    );
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("never PATCHes a file that is no longer a native Doc — creates a replacement instead (OQ-ANSWERS Q1(d)(1))", async () => {
    withExisting();
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: "application/pdf", trashed: false, explicitlyTrashed: false, version: "1",
      name: "X", webViewLink: "Y",
    });
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(res.status).toBe(200);
    expect(createDoc).toHaveBeenCalled();
    expect(updateDoc).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.replaced).toBe(true);
  });

  it("AC-S13: files.update never receives a name — a Google-Docs rename survives the save", async () => {
    withExisting();
    await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    const [, args] = updateDoc.mock.calls[0];
    expect(Object.prototype.hasOwnProperty.call(args, "name")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Three-way conflict compare — ARCH.md §7.5 / AC-S14
// ---------------------------------------------------------------------------
describe("conflict detection", () => {
  function withExisting(row = { drive_file_id: "FILE1", drive_file_version: "1" }) {
    listDriveDocuments.mockResolvedValue({ documents: { resume: row }, error: null });
  }

  it("409 conflict_session when another app session saved since this one hydrated (clientVersion !== rowVersion)", async () => {
    withExisting({ drive_file_id: "FILE1", drive_file_version: "2" }); // tab A already saved -> row now 2
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: false, version: "2",
      name: "Acme - SWE - Resume", webViewLink: "https://docs.google.com/document/d/FILE1/edit",
    });
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) })); // tab B hydrated at 1
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("conflict_session");
    expect(updateDoc).not.toHaveBeenCalled();
    expect(createDoc).not.toHaveBeenCalled();
  });

  it("409 conflict_foreign when the Doc was edited directly in Google Docs (rowVersion !== driveVersion)", async () => {
    withExisting({ drive_file_id: "FILE1", drive_file_version: "1" });
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: false, version: "7",
      name: "Acme - SWE - Resume", webViewLink: "https://docs.google.com/document/d/FILE1/edit",
    });
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("conflict_foreign");
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("a genuinely two-way-only compare would miss the session conflict — this app's own concurrency case (ARCH.md §7.5's tab-A/tab-B example)", async () => {
    // rowVersion === driveVersion (no foreign edit), but clientVersion is
    // stale relative to the row — a two-way compare (drive vs row only)
    // would see no divergence at all and silently overwrite tab A's save.
    withExisting({ drive_file_id: "FILE1", drive_file_version: "5" });
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: false, version: "5",
      name: "Acme - SWE - Resume", webViewLink: "https://docs.google.com/document/d/FILE1/edit",
    });
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1" }) }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("conflict_session");
  });

  it("onConflict:'overwrite' bypasses the compare and updates in place", async () => {
    withExisting({ drive_file_id: "FILE1", drive_file_version: "1" });
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: false, version: "7",
      name: "Acme - SWE - Resume", webViewLink: "https://docs.google.com/document/d/FILE1/edit",
    });
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1", onConflict: "overwrite" }) }));
    expect(res.status).toBe(200);
    expect(updateDoc).toHaveBeenCalledWith({ __fake: true }, { fileId: "FILE1", docxBuffer: expect.any(Buffer) });
  });

  it("onConflict:'new' bypasses the compare and creates a new Doc instead of touching the conflicted one", async () => {
    withExisting({ drive_file_id: "FILE1", drive_file_version: "1" });
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: false, version: "7",
      name: "Acme - SWE - Resume", webViewLink: "https://docs.google.com/document/d/FILE1/edit",
    });
    const res = await POST(saveRequest({ meta: baseMeta({ clientVersion: "1", onConflict: "new" }) }));
    expect(res.status).toBe(200);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(createDoc).toHaveBeenCalled();
    const body = await res.json();
    expect(body.created).toBe(true);
  });

  // WAVE4-SEAMS.md BLOCKER-1. This is the whole point of the button: the
  // conflicted Doc (FILE1) must never be PATCHed, and the mock-level
  // assertion above ("updateDoc not called") is not enough to prove that —
  // the REAL defect was `createDoc` itself PATCHing FILE1 internally via its
  // own adoption lookup, invisible to a test that mocks driveClient.js
  // wholesale. This test at least pins that the route asks createDoc for
  // non-adopting behaviour and a name FILE1 does not share; route.wire.test.js
  // proves it end to end through the real driveClient.
  it("onConflict:'new' disables createDoc's adoption guard and gives the new Doc a name distinct from the conflicted one", async () => {
    withExisting({ drive_file_id: "FILE1", drive_file_version: "1" });
    getDocMeta.mockResolvedValue({
      id: "FILE1", mimeType: DOCS_MIME, trashed: false, explicitlyTrashed: false, version: "7",
      name: "Acme - SWE - Resume", webViewLink: "https://docs.google.com/document/d/FILE1/edit",
    });
    await POST(saveRequest({ meta: baseMeta({ clientVersion: "1", onConflict: "new" }) }));
    expect(createDoc).toHaveBeenCalledWith(
      { __fake: true },
      { name: "Acme - SWE - Resume (new copy)", folderId: "FOLDER1", docxBuffer: expect.any(Buffer), adopt: false },
    );
  });
});

// ---------------------------------------------------------------------------
// The post-write assertion — ARCH.md §8.1
// ---------------------------------------------------------------------------
describe("post-write conversion assertion", () => {
  it("a create that comes back NOT converted is never reported as a success and is never persisted", async () => {
    createDoc.mockResolvedValue(docFile({ mimeType: "application/octet-stream" }));
    const res = await POST(saveRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("drive_not_converted");
    expect(upsertDriveDocument).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error classification + retry — AC-E8, AC-E9, AC-E10
// ---------------------------------------------------------------------------
describe("error classification and retry", () => {
  it("a transient failure is retried and a save that ultimately succeeds yields exactly one createDoc round", async () => {
    createDoc
      .mockRejectedValueOnce(driveError({ status: 503 }))
      .mockResolvedValueOnce(docFile());
    const res = await POST(saveRequest());
    expect(res.status).toBe(200);
    expect(createDoc).toHaveBeenCalledTimes(2); // one failure, one retry — never a second Doc
  });

  it("gives up after two retries and reports drive_transient", async () => {
    createDoc.mockRejectedValue(driveError({ status: 429 }));
    const res = await POST(saveRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("drive_transient");
    expect(createDoc).toHaveBeenCalledTimes(3); // 1 try + 2 retries
  });

  it("a 401 during the write maps to not_connected, not a generic error", async () => {
    createDoc.mockRejectedValue(driveError({ status: 401 }));
    const res = await POST(saveRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_connected");
  });

  it("403 storageQuotaExceeded classifies as drive_storage_full, never reconnect (AC-E9)", async () => {
    createDoc.mockRejectedValue(driveError({ status: 403, reason: "storageQuotaExceeded" }));
    const res = await POST(saveRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("drive_storage_full");
  });

  it("403 insufficientFilePermissions classifies as drive_refused, with a different message from storage-full (AC-E10)", async () => {
    createDoc.mockRejectedValue(driveError({ status: 403, reason: "insufficientFilePermissions" }));
    const res = await POST(saveRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("drive_refused");
  });

  it("is not retried for a non-transient failure (storage-full doesn't get a second attempt)", async () => {
    createDoc.mockRejectedValue(driveError({ status: 403, reason: "storageQuotaExceeded" }));
    await POST(saveRequest());
    expect(createDoc).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Response never carries a token (AC-C4) — paired with a positive control
// ---------------------------------------------------------------------------
describe("no secret ever reaches the response body", () => {
  it("strips a token even if one somehow ended up on the write result (defense in depth)", async () => {
    createDoc.mockResolvedValue(docFile({ access_token: "should-never-appear", refresh_token: "nope" }));
    const res = await POST(saveRequest());
    const text = await res.text();
    expect(text).not.toContain("should-never-appear");
    expect(text).not.toContain("nope");
  });

  it("positive control: an ordinary field with 'token' absent from its name DOES survive the serializer", async () => {
    createDoc.mockResolvedValue(docFile({ webViewLink: "https://docs.google.com/document/d/FILE1/edit" }));
    const res = await POST(saveRequest());
    const body = await res.json();
    expect(body.webViewLink).toBe("https://docs.google.com/document/d/FILE1/edit");
  });
});
