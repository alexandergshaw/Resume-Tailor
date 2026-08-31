import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/drive/driveTokens", () => ({ authorizedDriveClient: vi.fn() }));
vi.mock("@/lib/drive/driveClient", () => ({ exportDocx: vi.fn() }));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { authorizedDriveClient } from "@/lib/drive/driveTokens";
import { exportDocx } from "@/lib/drive/driveClient";
import { DOCX_MIME } from "@/lib/drive/driveMime";
import { DRIVE_EXPORT_MAX_BYTES } from "@/lib/drive/driveSize";

const ROUTE_PATH = fileURLToPath(new URL("./route.js", import.meta.url));

function driveError({ status, reason } = {}) {
  const err = new Error("drive error");
  if (typeof status === "number") err.status = status;
  if (reason) err.response = { data: { error: { errors: [{ reason }] } } };
  return err;
}

function exportRequest(fileId = "FILE1") {
  const url = new URL("http://localhost/api/drive/export");
  if (fileId !== null) url.searchParams.set("fileId", fileId);
  return { url: url.toString() };
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

const PK_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "shh-secret";
  signedIn();
  authorizedDriveClient.mockResolvedValue({ ok: true, drive: { __fake: true }, connection: { folder_id: "FOLDER1" } });
  exportDocx.mockResolvedValue(PK_BYTES);
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("[src] the route never writes drive.files.* itself", () => {
  it("contains no drive.files. call", () => {
    const src = readFileSync(ROUTE_PATH, "utf8");
    expect(src).not.toMatch(/\bdrive\.files\.\w+\(/);
  });
});

describe("gates", () => {
  it("401s when unauthenticated (AC-D9)", async () => {
    signedOut();
    const res = await GET(exportRequest());
    expect(res.status).toBe(401);
    expect(authorizedDriveClient).not.toHaveBeenCalled();
  });

  it("503s when Drive isn't configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await GET(exportRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("drive_unconfigured");
  });

  it("400s with no fileId", async () => {
    const res = await GET(exportRequest(null));
    expect(res.status).toBe(400);
    expect(exportDocx).not.toHaveBeenCalled();
  });

  it("401 not_connected with no stored connection", async () => {
    authorizedDriveClient.mockResolvedValue({ ok: false, reason: "not_connected", error: null });
    const res = await GET(exportRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_connected");
  });

  it("503 (never not_connected) when the token store errors", async () => {
    authorizedDriveClient.mockResolvedValue({ ok: false, reason: "storage_unavailable", error: "42P01" });
    const res = await GET(exportRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("drive_storage_unavailable");
  });
});

describe("export (AC-D3)", () => {
  it("calls exportDocx with the caller's own fileId and returns the bytes verbatim, PK header intact", async () => {
    const res = await GET(exportRequest("FILE1"));
    expect(res.status).toBe(200);
    expect(exportDocx).toHaveBeenCalledWith({ __fake: true }, "FILE1");
    expect(res.headers.get("Content-Type")).toBe(DOCX_MIME);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
    expect(buf.length).toBeGreaterThan(0);
  });

  it("a Blob mis-read (positive control's inverse) would NOT produce this header — sanity on the fixture itself", () => {
    // The fixture used above is a real PK-prefixed buffer, not a
    // stand-in — this asserts the fixture itself isn't accidentally empty.
    expect(PK_BYTES.length).toBeGreaterThan(0);
    expect(PK_BYTES.slice(0, 2).toString("latin1")).toBe("PK");
  });
});

describe("errors (AC-D8b / AC-E11 / AC-E12)", () => {
  it("404 drive_gone for a deleted/inaccessible file — never a downloaded file on disk", async () => {
    exportDocx.mockRejectedValue(driveError({ status: 404, reason: "notFound" }));
    const res = await GET(exportRequest());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("drive_gone");
  });

  it("401 not_connected on a rejected token mid-export", async () => {
    exportDocx.mockRejectedValue(driveError({ status: 401 }));
    const res = await GET(exportRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_connected");
  });

  it("is never retried by this route's own code — files.export is a GET, gaxios already retries it (AC-E8c)", async () => {
    exportDocx.mockRejectedValue(driveError({ status: 503 }));
    await GET(exportRequest());
    expect(exportDocx).toHaveBeenCalledTimes(1);
  });
});

describe("export size guard (AC-D6a / AC-D9)", () => {
  it("413s above DRIVE_EXPORT_MAX_BYTES, naming 10 MB, and never invents a truncated file", async () => {
    exportDocx.mockResolvedValue(Buffer.alloc(DRIVE_EXPORT_MAX_BYTES + 1, 1));
    const res = await GET(exportRequest());
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("payload_too_large");
    expect(body.limitBytes).toBe(DRIVE_EXPORT_MAX_BYTES);
    expect(body.message).toMatch(/10 MB/);
  });

  it("does not reject a file exactly at the limit (positive control)", async () => {
    exportDocx.mockResolvedValue(Buffer.alloc(DRIVE_EXPORT_MAX_BYTES, 1));
    const res = await GET(exportRequest());
    expect(res.status).toBe(200);
  });
});
