import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/driveDocuments", () => ({
  resolvePositionId: vi.fn(),
  listDriveDocuments: vi.fn(),
}));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { resolvePositionId, listDriveDocuments } from "@/lib/supabase/driveDocuments";

function docsRequest(jobId) {
  const url = new URL("http://localhost/api/drive/documents");
  if (jobId !== undefined) url.searchParams.set("jobId", jobId);
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "shh-secret";
  signedIn();
  resolvePositionId.mockResolvedValue("pos-1");
  listDriveDocuments.mockResolvedValue({ documents: {}, error: null });
});

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("gates", () => {
  it("401s when unauthenticated", async () => {
    signedOut();
    const res = await GET(docsRequest("job-1"));
    expect(res.status).toBe(401);
    expect(resolvePositionId).not.toHaveBeenCalled();
  });

  it("503s when Drive isn't configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = await GET(docsRequest("job-1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("drive_unconfigured");
  });
});

describe("no jobId / no resolvable position (AC-P14/AC-P15)", () => {
  it("returns an empty map at 200 when jobId is absent, rather than a 400", async () => {
    const res = await GET(docsRequest(undefined));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documents: {} });
    expect(resolvePositionId).not.toHaveBeenCalled();
  });

  it("returns an empty map at 200 for a jobId with no matching position (a posting that predates this feature — AC-P15)", async () => {
    resolvePositionId.mockResolvedValue(null);
    const res = await GET(docsRequest("job-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documents: {} });
    expect(listDriveDocuments).not.toHaveBeenCalled();
  });
});

describe("hydrating the per-scope reference", () => {
  it("maps every scope's row into {fileId, contentHash, version, webViewLink} (camelCase, not the raw columns)", async () => {
    listDriveDocuments.mockResolvedValue({
      documents: {
        resume: {
          drive_file_id: "FILE1",
          drive_content_hash: "hash-1",
          drive_file_version: "3",
          drive_web_view_link: "https://docs.google.com/document/d/FILE1/edit",
        },
        cover: {
          drive_file_id: "FILE2",
          drive_content_hash: null,
          drive_file_version: null,
          drive_web_view_link: "https://docs.google.com/document/d/FILE2/edit",
        },
      },
      error: null,
    });
    const res = await GET(docsRequest("job-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.documents.resume).toEqual({
      fileId: "FILE1",
      contentHash: "hash-1",
      version: "3",
      webViewLink: "https://docs.google.com/document/d/FILE1/edit",
    });
    expect(body.documents.cover).toEqual({
      fileId: "FILE2",
      contentHash: null,
      version: null,
      webViewLink: "https://docs.google.com/document/d/FILE2/edit",
    });
  });

  it("resolves positionId from the external jobId and queries only this user's rows", async () => {
    await GET(docsRequest("job-42"));
    expect(resolvePositionId).toHaveBeenCalledWith(expect.anything(), "job-42");
    expect(listDriveDocuments).toHaveBeenCalledWith(expect.anything(), "user-1", "pos-1");
  });
});

describe("storage failure (AC-C4)", () => {
  it("503s (never an empty map masquerading as success) when listDriveDocuments errors", async () => {
    listDriveDocuments.mockResolvedValue({ documents: null, error: "boom" });
    const res = await GET(docsRequest("job-1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("drive_storage_unavailable");
  });
});
