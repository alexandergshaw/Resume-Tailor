import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import {
  deletePracticeAnswer,
  listPracticeAnswers,
  signedVideoUrl,
  savePracticeAnswer,
  LIST_LIMIT,
  MAX_VIDEO_BYTES,
} from "./practiceAnswers";
import { createClient } from "@/lib/supabase/client";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A minimal fake of the Supabase client, scoped to exactly what
// deletePracticeAnswer needs: one auth check, one scoped select (row lookup),
// one storage removal, and one scoped delete. `.from(TABLE)` is called at
// most twice — first for the select, then for the delete — so the query
// builder returned by call #1 logs into `calls.select` and call #2 logs into
// `calls.delete`, keeping the two chains' `.eq()` args distinguishable.
// `calls.order` records "remove"/"delete" in the sequence the mocked methods
// actually fire, which is what the ordering assertions below check.
function makeFakeSupabase({
  user = { id: "user-1" },
  userError = null,
  selectResult = { data: null, error: null },
  deleteResult = { error: null },
  removeResult = { error: null },
} = {}) {
  const calls = {
    from: [],
    select: { eq: [] },
    delete: { eq: [] },
    storageFrom: [],
    storageRemove: [],
    order: [],
  };
  let fromCount = 0;

  function makeQueryBuilder(phase) {
    const log = calls[phase];
    const builder = {
      select: vi.fn(() => builder),
      delete: vi.fn(() => {
        calls.order.push("delete");
        return builder;
      }),
      eq: vi.fn((...args) => {
        log.eq.push(args);
        return builder;
      }),
      maybeSingle: vi.fn(() => Promise.resolve(selectResult)),
      // Lets `await supabase.from(TABLE).delete().eq(...).eq(...)` resolve
      // without a terminal call, same as the real delete-builder shape.
      then: (resolve, reject) => Promise.resolve(deleteResult).then(resolve, reject),
    };
    return builder;
  }

  return {
    calls,
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: userError })),
    },
    from: vi.fn((table) => {
      calls.from.push(table);
      fromCount += 1;
      return makeQueryBuilder(fromCount === 1 ? "select" : "delete");
    }),
    storage: {
      from: vi.fn((bucket) => {
        calls.storageFrom.push(bucket);
        return {
          remove: vi.fn(async (paths) => {
            calls.order.push("remove");
            calls.storageRemove.push(paths);
            return removeResult;
          }),
        };
      }),
    },
  };
}

describe("deletePracticeAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the storage object before deleting the row, in that order, and reports success", async () => {
    const fake = makeFakeSupabase({
      user: { id: "user-1" },
      selectResult: { data: { video_path: "user-1/practice/rec-1.webm" }, error: null },
    });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("rec-1");

    expect(result).toEqual({ error: null });
    // The order matters: the row is the only pointer to the object, so
    // removing the object after the row would strand it unreachable.
    expect(fake.calls.order).toEqual(["remove", "delete"]);
    expect(fake.calls.storageFrom).toEqual(["resumes"]);
    expect(fake.calls.storageRemove).toEqual([["user-1/practice/rec-1.webm"]]);
    expect(fake.calls.delete.eq).toContainEqual(["id", "rec-1"]);
    expect(fake.calls.delete.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("skips the storage removal for a row with no saved video and deletes the row directly", async () => {
    const fake = makeFakeSupabase({
      user: { id: "user-1" },
      selectResult: { data: { video_path: "" }, error: null },
    });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("rec-2");

    expect(result).toEqual({ error: null });
    expect(fake.calls.storageFrom).toHaveLength(0);
    expect(fake.calls.order).toEqual(["delete"]);
  });

  it("keeps the row when the storage removal fails for a real reason, and says it can be retried", async () => {
    const fake = makeFakeSupabase({
      user: { id: "user-1" },
      selectResult: { data: { video_path: "user-1/practice/rec-3.webm" }, error: null },
      removeResult: { error: { message: "storage bucket unreachable" } },
    });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("rec-3");

    expect(result).toEqual({
      error:
        "The video could not be removed, so this entry was kept — you can try deleting it again. (storage bucket unreachable)",
    });
    // The row delete must never have been attempted.
    expect(fake.calls.order).toEqual(["remove"]);
    expect(fake.calls.from).toEqual(["practice_answers"]);
  });

  it("treats an already-gone storage object as success and still deletes the row", async () => {
    const fake = makeFakeSupabase({
      user: { id: "user-1" },
      selectResult: { data: { video_path: "user-1/practice/rec-4.webm" }, error: null },
      removeResult: { error: { message: "Object not found" } },
    });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("rec-4");

    expect(result).toEqual({ error: null });
    expect(fake.calls.order).toEqual(["remove", "delete"]);
  });

  it("reports the row-delete failure after the video was already removed, and invites a retry", async () => {
    const fake = makeFakeSupabase({
      user: { id: "user-1" },
      selectResult: { data: { video_path: "user-1/practice/rec-5.webm" }, error: null },
      deleteResult: { error: { message: "connection reset" } },
    });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("rec-5");

    expect(result).toEqual({
      error:
        "The video was removed, but the history entry itself could not be deleted (connection reset) — try deleting it again.",
    });
    expect(fake.calls.order).toEqual(["remove", "delete"]);
  });

  it("reports a missing row as an error, without touching storage or attempting a delete", async () => {
    const fake = makeFakeSupabase({
      user: { id: "user-1" },
      selectResult: { data: null, error: null },
    });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("does-not-exist");

    expect(result).toEqual({ error: "That recording could not be found." });
    expect(fake.calls.storageFrom).toHaveLength(0);
    expect(fake.calls.order).toEqual([]);
  });

  it("cannot reach a row owned by another user: the lookup is scoped by user_id too, so it reports not-found", async () => {
    // The row exists in the table (for a different owner) but this query is
    // always scoped to the signed-in caller's own id, so it comes back empty
    // exactly as a truly missing row would.
    const fake = makeFakeSupabase({
      user: { id: "user-1" },
      selectResult: { data: null, error: null },
    });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("someone-elses-row");

    expect(result).toEqual({ error: "That recording could not be found." });
    expect(fake.calls.select.eq).toContainEqual(["id", "someone-elses-row"]);
    expect(fake.calls.select.eq).toContainEqual(["user_id", "user-1"]);
  });

  it("reports a database error from the row lookup itself, distinct from a missing row", async () => {
    const fake = makeFakeSupabase({
      user: { id: "user-1" },
      selectResult: { data: null, error: { message: "connection reset" } },
    });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("rec-6");

    expect(result).toEqual({ error: "connection reset" });
    expect(fake.calls.storageFrom).toHaveLength(0);
  });

  it("reports a missing id as an error without ever creating a Supabase client", async () => {
    expect(await deletePracticeAnswer(undefined)).toEqual({ error: "Missing recording id." });
    expect(await deletePracticeAnswer(null)).toEqual({ error: "Missing recording id." });
    expect(await deletePracticeAnswer("")).toEqual({ error: "Missing recording id." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reports a signed-out caller as an error without querying the table or storage", async () => {
    const fake = makeFakeSupabase({ user: null, userError: null });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("rec-7");

    expect(result).toEqual({ error: "You must be signed in to delete a practice answer." });
    expect(fake.from).not.toHaveBeenCalled();
    expect(fake.storage.from).not.toHaveBeenCalled();
  });

  it("reports an auth-lookup failure by its own message, rather than treating it as signed-out", async () => {
    const fake = makeFakeSupabase({ user: null, userError: { message: "session expired" } });
    createClient.mockReturnValue(fake);

    const result = await deletePracticeAnswer("rec-8");

    expect(result).toEqual({ error: "session expired" });
    expect(fake.from).not.toHaveBeenCalled();
  });
});

// Minimal chainable double for
// `supabase.from("practice_answers").select(...).eq(...).order(...).limit(...)`
// — mirrors the real query builder, whose `.limit(...)` call is the terminal
// awaited call (there is no separate `.then()` stage to fake, unlike the
// delete-builder double above).
function makeFakeListSupabase({ user = null, userError = null, data = [], queryError = null } = {}) {
  const calls = { from: [], select: [], eq: [], order: [], limit: [] };
  const builder = {
    select: vi.fn((...args) => {
      calls.select.push(args);
      return builder;
    }),
    eq: vi.fn((...args) => {
      calls.eq.push(args);
      return builder;
    }),
    order: vi.fn((...args) => {
      calls.order.push(args);
      return builder;
    }),
    limit: vi.fn((...args) => {
      calls.limit.push(args);
      return Promise.resolve({ data, error: queryError });
    }),
  };
  return {
    calls,
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: userError })),
    },
    from: vi.fn((table) => {
      calls.from.push(table);
      return builder;
    }),
  };
}

describe("listPracticeAnswers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty list without querying the table when signed out", async () => {
    const fake = makeFakeListSupabase({ user: null, userError: null });
    createClient.mockReturnValue(fake);

    const result = await listPracticeAnswers();

    expect(result).toEqual({ data: [], error: null, truncated: false });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("returns the auth error rather than treating it as signed out", async () => {
    const fake = makeFakeListSupabase({ user: null, userError: { message: "network down" } });
    createClient.mockReturnValue(fake);

    const result = await listPracticeAnswers();

    expect(result).toEqual({ data: null, error: "network down", truncated: false });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("queries the signed-in user's own rows, newest first, with the capped limit", async () => {
    const fake = makeFakeListSupabase({ user: { id: "u1" }, data: [{ id: "a" }, { id: "b" }] });
    createClient.mockReturnValue(fake);

    await listPracticeAnswers();

    expect(fake.from).toHaveBeenCalledWith("practice_answers");
    expect(fake.calls.eq).toContainEqual(["user_id", "u1"]);
    expect(fake.calls.order).toContainEqual(["created_at", { ascending: false }]);
    expect(fake.calls.limit).toContainEqual([LIST_LIMIT + 1]);
  });

  it("returns the query error message and no rows when the query fails", async () => {
    const fake = makeFakeListSupabase({ user: { id: "u1" }, queryError: { message: "constraint boom" } });
    createClient.mockReturnValue(fake);

    const result = await listPracticeAnswers();

    expect(result).toEqual({ data: null, error: "constraint boom", truncated: false });
  });

  it("falls back to a generic message when a query error has no message", async () => {
    const fake = makeFakeListSupabase({ user: { id: "u1" }, queryError: {} });
    createClient.mockReturnValue(fake);

    const result = await listPracticeAnswers();

    expect(result.error).toBe("Could not load your practice history.");
    expect(result.data).toBeNull();
  });

  it("reports no truncation and returns every row when the fetch is exactly at the cap", async () => {
    const rows = Array.from({ length: LIST_LIMIT }, (_, i) => ({ id: `row-${i}` }));
    const fake = makeFakeListSupabase({ user: { id: "u1" }, data: rows });
    createClient.mockReturnValue(fake);

    const result = await listPracticeAnswers();

    expect(result.error).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.data).toHaveLength(LIST_LIMIT);
  });

  it("drops the oldest row past the cap and reports truncated when the fetch returns one over the limit", async () => {
    const rows = Array.from({ length: LIST_LIMIT + 1 }, (_, i) => ({ id: `row-${i}` }));
    const fake = makeFakeListSupabase({ user: { id: "u1" }, data: rows });
    createClient.mockReturnValue(fake);

    const result = await listPracticeAnswers();

    expect(result.truncated).toBe(true);
    expect(result.data).toHaveLength(LIST_LIMIT);
    // The query already returns newest-first, so the row dropped from the
    // LIST_LIMIT+1 fetched is the last (oldest) one, not an arbitrary one.
    expect(result.data.map((r) => r.id)).toEqual(rows.slice(0, LIST_LIMIT).map((r) => r.id));
    expect(result.data.some((r) => r.id === `row-${LIST_LIMIT}`)).toBe(false);
  });
});

describe("signedVideoUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error for an empty path without creating a client", async () => {
    const result = await signedVideoUrl("");

    expect(result).toEqual({ data: null, error: "No recording is saved for this answer." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns an error for a missing path without creating a client", async () => {
    const result = await signedVideoUrl(undefined);

    expect(result).toEqual({ data: null, error: "No recording is saved for this answer." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("surfaces a storage error instead of a signed URL", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: null, error: { message: "object not found" } }));
    createClient.mockReturnValue({ storage: { from: vi.fn(() => ({ createSignedUrl })) } });

    const result = await signedVideoUrl("u1/practice/abc.webm");

    expect(result).toEqual({ data: null, error: "object not found" });
  });

  it("falls back to a generic message when the storage error has no message", async () => {
    const createSignedUrl = vi.fn(async () => ({ data: null, error: {} }));
    createClient.mockReturnValue({ storage: { from: vi.fn(() => ({ createSignedUrl })) } });

    const result = await signedVideoUrl("u1/practice/abc.webm");

    expect(result).toEqual({ data: null, error: "Could not create a playback link." });
  });

  it("returns the signed URL on success", async () => {
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: "https://example.com/signed" },
      error: null,
    }));
    const storageFrom = vi.fn(() => ({ createSignedUrl }));
    createClient.mockReturnValue({ storage: { from: storageFrom } });

    const result = await signedVideoUrl("u1/practice/abc.webm");

    expect(result).toEqual({ data: "https://example.com/signed", error: null });
    expect(storageFrom).toHaveBeenCalledWith("resumes");
    expect(createSignedUrl).toHaveBeenCalledWith("u1/practice/abc.webm", 600);
  });
});

// A double for the calls savePracticeAnswer makes: one auth check, one
// storage upload, one storage remove (only reached on a post-upload insert
// failure), and one or two table inserts (a second only for the FK-retry
// path). `insertErrors` is consumed one entry per insert() call, in order,
// with the last entry repeating past the array's length — that is what lets
// a single fake express "first insert fails, retry succeeds".
function makeFakeSaveSupabase({
  user = { id: "user-1" },
  userError = null,
  uploadError = null,
  removeError = null,
  insertErrors = [null],
} = {}) {
  const insertCalls = [];
  const uploadCalls = [];
  const removeCalls = [];
  let insertCallCount = 0;

  const insert = vi.fn(async (row) => {
    // savePracticeAnswer reuses the SAME row object for its retry (it only
    // mutates row.application_id before re-inserting), so this must snapshot
    // a shallow copy per call rather than storing the live reference — else
    // insertCalls[0] would appear mutated by the second call too.
    insertCalls.push({ ...row });
    const err = insertErrors[Math.min(insertCallCount, insertErrors.length - 1)];
    insertCallCount += 1;
    return { error: err };
  });

  const upload = vi.fn(async (path, blob, opts) => {
    uploadCalls.push({ path, blob, opts });
    return { error: uploadError };
  });

  const remove = vi.fn(async (paths) => {
    removeCalls.push(paths);
    return { error: removeError };
  });

  return {
    insertCalls,
    uploadCalls,
    removeCalls,
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: userError })),
    },
    storage: {
      from: vi.fn(() => ({ upload, remove })),
    },
    from: vi.fn(() => ({ insert })),
  };
}

describe("savePracticeAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("agrees the storage path and inserted row id, using the mime type's extension", async () => {
    const fake = makeFakeSaveSupabase();
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      blob: { size: 1000, type: "video/mp4" },
      mimeType: "video/mp4",
      question: "Tell me about yourself.",
    });

    expect(result.error).toBeNull();
    expect(result.data.videoPath).toBe(`user-1/practice/${result.data.id}.mp4`);
    expect(fake.uploadCalls).toHaveLength(1);
    expect(fake.uploadCalls[0].path).toBe(result.data.videoPath);
    expect(fake.insertCalls[0].id).toBe(result.data.id);
    expect(fake.insertCalls[0].video_path).toBe(result.data.videoPath);
  });

  it("falls back to a webm extension for a non-mp4 mime type", async () => {
    const fake = makeFakeSaveSupabase();
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      blob: { size: 1000, type: "video/webm" },
      mimeType: "video/webm;codecs=vp9",
    });

    expect(result.data.videoPath).toBe(`user-1/practice/${result.data.id}.webm`);
    expect(fake.uploadCalls[0].path).toBe(result.data.videoPath);
  });

  it("still inserts the row with an empty video_path and a videoSkipped note when there is no blob", async () => {
    const fake = makeFakeSaveSupabase();
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      question: "Tell me about yourself.",
      transcript: "I have five years of experience...",
    });

    expect(result.error).toBeNull();
    expect(fake.uploadCalls).toHaveLength(0);
    expect(fake.insertCalls).toHaveLength(1);
    expect(fake.insertCalls[0].video_path).toBe("");
    expect(result.data.videoPath).toBe("");
    expect(result.data.videoSkipped).toMatch(/no recording/i);
    // The rest of the answer is still saved, not silently dropped.
    expect(fake.insertCalls[0].transcript).toBe("I have five years of experience...");
  });

  it("uploads a blob exactly at MAX_VIDEO_BYTES", async () => {
    const fake = makeFakeSaveSupabase();
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      blob: { size: MAX_VIDEO_BYTES, type: "video/webm" },
      mimeType: "video/webm",
    });

    expect(fake.uploadCalls).toHaveLength(1);
    expect(result.data.videoSkipped).toBe("");
    expect(result.data.videoPath).not.toBe("");
  });

  it("skips upload for a blob just one byte over MAX_VIDEO_BYTES, but still saves the rest of the answer and reports the cap", async () => {
    const fake = makeFakeSaveSupabase();
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      blob: { size: MAX_VIDEO_BYTES + 1, type: "video/webm" },
      mimeType: "video/webm",
      question: "Describe a challenge you overcame.",
      transcript: "Once, on a project...",
    });

    expect(result.error).toBeNull();
    expect(fake.uploadCalls).toHaveLength(0);
    expect(result.data.videoPath).toBe("");
    expect(result.data.videoSkipped).toMatch(/limit/i);
    expect(fake.insertCalls).toHaveLength(1);
    expect(fake.insertCalls[0].video_path).toBe("");
    expect(fake.insertCalls[0].video_bytes).toBeNull();
    expect(fake.insertCalls[0].transcript).toBe("Once, on a project...");
    expect(fake.insertCalls[0].question).toBe("Describe a challenge you overcame.");
  });

  it("reports the size-cap skip with different wording than the no-blob skip", async () => {
    const fakeOverCap = makeFakeSaveSupabase();
    createClient.mockReturnValue(fakeOverCap);
    const overCap = await savePracticeAnswer({
      blob: { size: MAX_VIDEO_BYTES + 1, type: "video/webm" },
    });

    const fakeNoBlob = makeFakeSaveSupabase();
    createClient.mockReturnValue(fakeNoBlob);
    const noBlob = await savePracticeAnswer({});

    expect(overCap.data.videoSkipped).not.toBe(noBlob.data.videoSkipped);
  });

  it("inserts no row and returns the error when the upload fails", async () => {
    const fake = makeFakeSaveSupabase({ uploadError: { message: "upload boom" } });
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      blob: { size: 1000, type: "video/webm" },
      mimeType: "video/webm",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("upload boom");
    expect(fake.insertCalls).toHaveLength(0);
  });

  it("removes the just-uploaded object when the row insert fails for a non-FK reason", async () => {
    const fake = makeFakeSaveSupabase({
      insertErrors: [{ code: "23505", message: "duplicate key" }],
    });
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      blob: { size: 1000, type: "video/webm" },
      mimeType: "video/webm",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("duplicate key");
    expect(fake.insertCalls).toHaveLength(1);
    expect(fake.removeCalls).toHaveLength(1);
    expect(fake.removeCalls[0]).toEqual([fake.uploadCalls[0].path]);
  });

  it("folds the cleanup failure into the returned error instead of hiding the orphaned object", async () => {
    const fake = makeFakeSaveSupabase({
      insertErrors: [{ code: "23505", message: "insert boom" }],
      removeError: { message: "remove boom" },
    });
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      blob: { size: 1000, type: "video/webm" },
      mimeType: "video/webm",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "insert boom The uploaded video also could not be cleaned up (remove boom) and may remain in storage without a history entry.",
    );
  });

  it("retries a foreign-key violation on application_id once with application_id cleared", async () => {
    const fake = makeFakeSaveSupabase({
      insertErrors: [{ code: "23503", message: "fk violation" }, null],
    });
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({
      applicationId: "app-1",
      question: "Tell me about yourself.",
    });

    expect(fake.insertCalls).toHaveLength(2);
    expect(fake.insertCalls[0].application_id).toBe("app-1");
    expect(fake.insertCalls[1].application_id).toBeNull();
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
  });

  it("returns an error, without throwing, when the user is signed out", async () => {
    const fake = makeFakeSaveSupabase({ user: null, userError: null });
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({ question: "x" });

    expect(result).toEqual({
      data: null,
      error: "You must be signed in to save practice answers.",
    });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("returns an error, without throwing, when the auth lookup itself errors", async () => {
    const fake = makeFakeSaveSupabase({ user: null, userError: { message: "network down" } });
    createClient.mockReturnValue(fake);

    const result = await savePracticeAnswer({ question: "x" });

    expect(result).toEqual({ data: null, error: "network down" });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("still generates a valid v4 uuid when crypto.randomUUID is unavailable", async () => {
    const fake = makeFakeSaveSupabase();
    createClient.mockReturnValue(fake);

    const originalRandomUUID = crypto.randomUUID;
    crypto.randomUUID = undefined;
    try {
      const result = await savePracticeAnswer({ question: "x" });
      expect(result.data.id).toMatch(UUID_V4_RE);
      expect(fake.insertCalls[0].id).toBe(result.data.id);
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });
});
