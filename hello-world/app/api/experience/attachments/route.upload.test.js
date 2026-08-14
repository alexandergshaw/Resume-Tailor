// What POST /api/experience/attachments tells the user when an upload fails.
//
// Written after a real upload of "Centralized PR Standards [Autosaved]
// [Autosaved].pptx" answered "Could not save this attachment." and nothing
// else. Two different causes - a key Supabase Storage refuses, and a bucket
// restriction - produce that identical string, so neither the user nor anyone
// reading the report could tell which had happened.
//
// The masking itself was deliberate and half-right: a failed INSERT can carry
// "duplicate key value violates unique constraint", which is a cross-tenant
// existence oracle for attachment ids. That half stays. A failed UPLOAD is
// about the caller's own file, and saying so is what makes the failure
// actionable.
//
// Only the Supabase boundary is mocked. classifyAttachment and the route
// itself stay real, mirroring app/api/experience/routes.contract.test.js's own
// pattern of mocking the data layer rather than the code under test.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/supabase/experienceAttachments", () => ({
  listAttachments: vi.fn(),
  createAttachment: vi.fn(),
  signedAttachmentUrl: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { listPages } from "@/lib/supabase/experiencePages";
import { createAttachment } from "@/lib/supabase/experienceAttachments";
import { POST } from "./route.js";

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const FILE_NAME = "Centralized PR Standards [Autosaved] [Autosaved].pptx";

function signedIn(userId = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
}

function uploadRequest(name = FILE_NAME, type = PPTX) {
  const form = new FormData();
  form.set("pageId", "page-1");
  form.set("id", "11111111-2222-4333-8444-555555555555");
  form.set("file", new File(["x"], name, { type }));
  return new Request("http://localhost/api/experience/attachments", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  listPages.mockResolvedValue({ pages: [{ id: "page-1" }], error: null });
});

describe("POST /api/experience/attachments failure reporting", () => {
  it("tells the user what storage refused, and about which file", async () => {
    signedIn();
    createAttachment.mockResolvedValue({
      attachment: null,
      error: "Invalid key: user-1/experience/page-1/id-Centralized PR Standards [Autosaved].pptx",
      stage: "upload",
    });

    const res = await POST(uploadRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    // The reason, verbatim - this is the half that was being thrown away.
    expect(body.error).toContain("Invalid key");
    // And which file it was about. A page can be uploading more than one.
    expect(body.error).toContain(FILE_NAME);
    // The old generic sentence must not be what comes back on this path.
    expect(body.error).not.toBe("Could not save this attachment.");
  });

  it("still refuses to leak why an insert failed", async () => {
    // The existence oracle this masking was built for. Postgres answers a
    // colliding id with "duplicate key value violates unique constraint
    // experience_attachments_pkey", which tells a caller that SOMEONE ELSE'S
    // row has that id. It must never reach the client, however useful the
    // upload-stage message now is.
    signedIn();
    createAttachment.mockResolvedValue({
      attachment: null,
      error: 'duplicate key value violates unique constraint "experience_attachments_pkey"',
      stage: "insert",
    });

    const res = await POST(uploadRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Could not save this attachment.");
    expect(body.error).not.toContain("duplicate key");
    expect(body.error).not.toContain("experience_attachments");
  });

  it("keeps genericizing a failure that names no stage at all", async () => {
    // Defensive: a store that returns an error without the new field must not
    // fall through into the new verbatim-reporting branch.
    signedIn();
    createAttachment.mockResolvedValue({ attachment: null, error: "something internal" });

    const res = await POST(uploadRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Could not save this attachment.");
  });

  it("still saves an attachment that uploads cleanly", async () => {
    // Positive control for all three above: a route that answered an error
    // unconditionally would pass every one of them.
    signedIn();
    createAttachment.mockResolvedValue({
      attachment: { id: "a1", name: FILE_NAME, kind: "slides" },
      error: null,
    });

    const res = await POST(uploadRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attachment.name).toBe(FILE_NAME);
    expect(body.error).toBeUndefined();
  });

  it("refuses without a session and never reaches the data layer", async () => {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const res = await POST(uploadRequest());

    expect(res.status).toBe(401);
    expect(createAttachment).not.toHaveBeenCalled();
    expect(listPages).not.toHaveBeenCalled();
  });
});
