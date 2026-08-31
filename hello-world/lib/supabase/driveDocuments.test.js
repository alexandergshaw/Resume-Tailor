import { describe, it, expect, vi, beforeEach } from "vitest";

import { resolvePositionId, listDriveDocuments, upsertDriveDocument } from "./driveDocuments";

// A minimal chainable double for the two query shapes this module issues:
//   .from(t).select(...).eq(...).maybeSingle()                (resolvePositionId)
//   .from(t).select(...).eq(...).eq(...)                      (listDriveDocuments — thenable, no terminal call)
//   .from(t).upsert(row, opts).select().maybeSingle()          (upsertDriveDocument)
// Every method returns the same builder so calls chain freely, and the
// builder itself is thenable (mirrors the real PostgrestFilterBuilder),
// which is what lets listDriveDocuments `await` a call that ends on `.eq(`
// with no terminal method.
function makeBuilder(result) {
  const calls = { select: [], eq: [], upsert: [] };
  const builder = {
    select: vi.fn((...args) => {
      calls.select.push(args);
      return builder;
    }),
    eq: vi.fn((...args) => {
      calls.eq.push(args);
      return builder;
    }),
    upsert: vi.fn((...args) => {
      calls.upsert.push(args);
      return builder;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return { builder, calls };
}

function makeFakeSupabase(resultsByTable) {
  const fromCalls = [];
  const builders = [];
  const supabase = {
    from: vi.fn((table) => {
      fromCalls.push(table);
      const { builder, calls } = makeBuilder(resultsByTable[table]);
      builders.push({ table, calls });
      return builder;
    }),
  };
  return { supabase, fromCalls, builders };
}

describe("resolvePositionId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null without querying when jobId is falsy", async () => {
    const { supabase } = makeFakeSupabase({});
    expect(await resolvePositionId(supabase, "")).toBeNull();
    expect(await resolvePositionId(supabase, null)).toBeNull();
    expect(await resolvePositionId(supabase, undefined)).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("looks up positions by external_id (coerced to a string) and returns the id", async () => {
    const { supabase, builders } = makeFakeSupabase({
      positions: { data: { id: "pos-1" }, error: null },
    });

    const result = await resolvePositionId(supabase, 12345);

    expect(result).toBe("pos-1");
    expect(supabase.from).toHaveBeenCalledWith("positions");
    expect(builders[0].calls.eq).toContainEqual(["external_id", "12345"]);
  });

  it("returns null when no position matches", async () => {
    const { supabase } = makeFakeSupabase({ positions: { data: null, error: null } });
    expect(await resolvePositionId(supabase, "job-1")).toBeNull();
  });

  it("swallows a lookup error and returns null rather than throwing", async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    expect(await resolvePositionId(supabase, "job-1")).toBeNull();
  });
});

describe("listDriveDocuments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty map without querying when positionId is falsy", async () => {
    const { supabase } = makeFakeSupabase({});
    const result = await listDriveDocuments(supabase, "user-1", null);
    expect(result).toEqual({ documents: {}, error: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("scopes the query by user_id AND position_id, keyed by scope in the result", async () => {
    const rows = [
      { user_id: "user-1", position_id: "pos-1", scope: "resume", drive_file_id: "f-res" },
      { user_id: "user-1", position_id: "pos-1", scope: "cover", drive_file_id: "f-cov" },
    ];
    const { supabase, builders } = makeFakeSupabase({ drive_documents: { data: rows, error: null } });

    const result = await listDriveDocuments(supabase, "user-1", "pos-1");

    expect(supabase.from).toHaveBeenCalledWith("drive_documents");
    expect(builders[0].calls.eq).toContainEqual(["user_id", "user-1"]);
    expect(builders[0].calls.eq).toContainEqual(["position_id", "pos-1"]);
    expect(result).toEqual({
      documents: { resume: rows[0], cover: rows[1] },
      error: null,
    });
  });

  it("returns an empty map (not an error) for a position with no saved documents", async () => {
    const { supabase } = makeFakeSupabase({ drive_documents: { data: [], error: null } });
    const result = await listDriveDocuments(supabase, "user-1", "pos-2");
    expect(result).toEqual({ documents: {}, error: null });
  });

  it("returns the query error distinct from an empty result, without throwing", async () => {
    const { supabase } = makeFakeSupabase({
      drive_documents: { data: null, error: { message: "42P01: relation does not exist" } },
    });
    const result = await listDriveDocuments(supabase, "user-1", "pos-1");
    expect(result).toEqual({ documents: null, error: "42P01: relation does not exist" });
  });

  it("falls back to a generic message when the error has none", async () => {
    const { supabase } = makeFakeSupabase({ drive_documents: { data: null, error: {} } });
    const result = await listDriveDocuments(supabase, "user-1", "pos-1");
    expect(result.error).toBe("Could not load Drive documents.");
  });
});

describe("upsertDriveDocument", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to write without a position id, without querying", async () => {
    const { supabase } = makeFakeSupabase({});
    const result = await upsertDriveDocument(supabase, "user-1", null, "resume", { driveFileId: "f-1" });
    expect(result).toEqual({ document: null, error: "Missing position id." });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("refuses to write without a scope, without querying", async () => {
    const { supabase } = makeFakeSupabase({});
    const result = await upsertDriveDocument(supabase, "user-1", "pos-1", "", { driveFileId: "f-1" });
    expect(result).toEqual({ document: null, error: "Missing scope." });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("refuses to write without a Drive file id, without querying (AC-P8: a row exists only for a Doc that exists)", async () => {
    const { supabase } = makeFakeSupabase({});
    const result = await upsertDriveDocument(supabase, "user-1", "pos-1", "resume", {});
    expect(result).toEqual({ document: null, error: "Missing Drive file id." });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("upserts on the composite primary key, never a bare insert (AC-P13)", async () => {
    const saved = { user_id: "user-1", position_id: "pos-1", scope: "resume", drive_file_id: "f-1" };
    const { supabase, builders } = makeFakeSupabase({ drive_documents: { data: saved, error: null } });

    const result = await upsertDriveDocument(supabase, "user-1", "pos-1", "resume", {
      driveFileId: "f-1",
      driveContentHash: "hash-1",
      driveFileVersion: "42",
      driveWebViewLink: "https://docs.google.com/document/d/f-1/edit",
    });

    expect(result).toEqual({ document: saved, error: null });
    expect(supabase.from).toHaveBeenCalledWith("drive_documents");
    expect(builders[0].calls.upsert).toHaveLength(1);
    const [row, opts] = builders[0].calls.upsert[0];
    expect(opts).toEqual({ onConflict: "user_id,position_id,scope" });
    expect(row).toMatchObject({
      user_id: "user-1",
      position_id: "pos-1",
      scope: "resume",
      drive_file_id: "f-1",
      drive_content_hash: "hash-1",
      drive_file_version: "42",
      drive_web_view_link: "https://docs.google.com/document/d/f-1/edit",
    });
    expect(typeof row.updated_at).toBe("string");
  });

  it("omits optional fields entirely from the row when the caller doesn't supply them, rather than writing null", async () => {
    const { supabase, builders } = makeFakeSupabase({
      drive_documents: { data: { drive_file_id: "f-2" }, error: null },
    });

    await upsertDriveDocument(supabase, "user-1", "pos-2", "cover", { driveFileId: "f-2" });

    const [row] = builders[0].calls.upsert[0];
    expect(row).not.toHaveProperty("drive_content_hash");
    expect(row).not.toHaveProperty("drive_file_version");
    expect(row).not.toHaveProperty("drive_web_view_link");
  });

  it("returns the upsert error rather than throwing", async () => {
    const { supabase } = makeFakeSupabase({
      drive_documents: { data: null, error: { message: "constraint violation" } },
    });

    const result = await upsertDriveDocument(supabase, "user-1", "pos-1", "resume", { driveFileId: "f-1" });

    expect(result).toEqual({ document: null, error: "constraint violation" });
  });

  it("falls back to a generic message when the upsert error has none", async () => {
    const { supabase } = makeFakeSupabase({ drive_documents: { data: null, error: {} } });
    const result = await upsertDriveDocument(supabase, "user-1", "pos-1", "resume", { driveFileId: "f-1" });
    expect(result.error).toBe("Could not save this Drive document.");
  });

  it("catches a thrown error from the client and reports it instead of propagating", async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error("client exploded");
      }),
    };
    const result = await upsertDriveDocument(supabase, "user-1", "pos-1", "resume", { driveFileId: "f-1" });
    expect(result).toEqual({ document: null, error: "client exploded" });
  });
});
