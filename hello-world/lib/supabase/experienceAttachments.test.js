// createAttachment's error contract: WHICH stage failed, not just that
// something did.
//
// This file exists because of a hole its absence created. The route test
// (app/api/experience/attachments/route.upload.test.js) mocks this module and
// hands the route a `stage` of its own invention, so it proves what the route
// does with a stage - and nothing at all about whether this module produces
// the right one. Deleting the `stage: "upload"` tag here, or mislabelling the
// INSERT failure as an upload (which would leak Postgres's duplicate-key text
// straight to the client), left that whole suite green. Two halves tested
// against different assumptions, with the join between them unchecked.
//
// Only the Supabase client is doubled. The module under test is real,
// including its call into storagePathFor.

import { describe, it, expect, vi } from "vitest";
import { createAttachment } from "./experienceAttachments.js";

// A double for exactly the calls createAttachment makes:
// storage.from(BUCKET).upload(...), from(TABLE).insert(...).select().single(),
// and - only on an insert failure - storage.from(BUCKET).remove([...]).
function clientDouble({ uploadError = null, insertError = null, removeError = null, row = { id: "a1" } } = {}) {
  const upload = vi.fn(async () => ({ error: uploadError }));
  const remove = vi.fn(async () => ({ error: removeError }));
  const single = vi.fn(async () => ({ data: insertError ? null : row, error: insertError }));
  return {
    calls: { upload, remove, single },
    storage: { from: vi.fn(() => ({ upload, remove })) },
    from: vi.fn(() => ({ insert: vi.fn(() => ({ select: vi.fn(() => ({ single })) })) })),
  };
}

const args = {
  id: "a1",
  pageId: "p1",
  file: { name: "deck.pptx" },
  name: "deck.pptx",
  mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  bytes: 1024,
  notes: "",
};

describe("createAttachment error stages", () => {
  it("tags a refused upload as the upload stage, and never reaches the insert", async () => {
    const supabase = clientDouble({ uploadError: { message: "Invalid key: u1/experience/p1/a1-deck [x].pptx" } });

    const result = await createAttachment(supabase, "u1", args);

    expect(result.stage).toBe("upload");
    expect(result.attachment).toBeNull();
    // The reason is carried, not swallowed - it is what the route now shows.
    expect(result.error).toContain("Invalid key");
    // A row must not be written for an object that was never stored.
    expect(supabase.calls.single).not.toHaveBeenCalled();
  });

  it("tags a refused insert as the insert stage, and removes the orphaned object", async () => {
    // This is the stage whose message can carry "duplicate key value violates
    // unique constraint", telling a caller that someone else's row holds that
    // id. Mislabelling it "upload" is what would hand that to the client.
    const supabase = clientDouble({
      insertError: { message: 'duplicate key value violates unique constraint "experience_attachments_pkey"' },
    });

    const result = await createAttachment(supabase, "u1", args);

    expect(result.stage).toBe("insert");
    expect(result.attachment).toBeNull();
    expect(supabase.calls.remove).toHaveBeenCalled();
  });

  it("still tags the insert stage when the cleanup fails too", async () => {
    const supabase = clientDouble({
      insertError: { message: "insert exploded" },
      removeError: { message: "storage unreachable" },
    });

    const result = await createAttachment(supabase, "u1", args);

    expect(result.stage).toBe("insert");
    // Both failures survive into the message, which is why this branch exists
    // separately at all - the object may now be orphaned in storage.
    expect(result.error).toContain("insert exploded");
    expect(result.error).toContain("storage unreachable");
  });

  it("tags anything thrown as unknown rather than guessing", async () => {
    // The route reports the upload stage verbatim, so a failure it cannot
    // attribute to the caller's own file must NOT claim to be one.
    const supabase = {
      storage: {
        from: () => {
          throw new Error("network down");
        },
      },
    };

    const result = await createAttachment(supabase, "u1", args);

    expect(result.stage).toBe("unknown");
    expect(result.attachment).toBeNull();
  });

  it("returns the row and no stage at all when everything works", async () => {
    // Positive control: a function that returned an upload-stage error
    // unconditionally would pass the first test and none of this one.
    const supabase = clientDouble({ row: { id: "a1", name: "deck.pptx" } });

    const result = await createAttachment(supabase, "u1", args);

    expect(result.error).toBeNull();
    expect(result.attachment).toEqual({ id: "a1", name: "deck.pptx" });
    expect(result.stage).toBeUndefined();
  });
});
