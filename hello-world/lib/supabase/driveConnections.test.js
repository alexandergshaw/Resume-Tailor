import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { getDriveConnection, saveDriveConnection, deleteDriveConnection } from "./driveConnections";
import { createAdminClient } from "@/lib/supabase/admin";

// A minimal chainable double, thenable at every step (mirrors the real
// PostgrestFilterBuilder) so a chain ending on `.eq(` or `.select(` with no
// terminal method — as deleteDriveConnection's does — still resolves.
function makeBuilder(result) {
  const calls = { select: [], eq: [], upsert: [], delete: [] };
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
    delete: vi.fn(() => {
      calls.delete.push(true);
      return builder;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return { builder, calls };
}

function makeFakeAdmin(result) {
  const fromCalls = [];
  let lastCalls = null;
  const admin = {
    from: vi.fn((table) => {
      fromCalls.push(table);
      const { builder, calls } = makeBuilder(result);
      lastCalls = calls;
      return builder;
    }),
  };
  return { admin, fromCalls, getCalls: () => lastCalls };
}

describe("getDriveConnection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns an error without creating a client when userId is missing", async () => {
    const result = await getDriveConnection(undefined);
    expect(result).toEqual({ connection: null, error: "Missing user id." });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("scopes the read by user_id and selects an explicit column list, never select(\"*\")", async () => {
    const row = { user_id: "user-1", refresh_token: "rt-1" };
    const { admin, fromCalls, getCalls } = makeFakeAdmin({ data: row, error: null });
    createAdminClient.mockReturnValue(admin);

    const result = await getDriveConnection("user-1");

    expect(result).toEqual({ connection: row, error: null });
    expect(fromCalls).toEqual(["drive_connections"]);
    expect(getCalls().eq).toContainEqual(["user_id", "user-1"]);
    const [selectArg] = getCalls().select[0];
    expect(selectArg).not.toBe("*");
    expect(selectArg).toContain("refresh_token");
  });

  // AC-C4 / ADJUDICATION §A-1: "no rows" and "every other Supabase error"
  // must be distinguishable, because an unapplied migration surfaces as a
  // real error (42P01), and that must never be read as "not connected".
  // These two tests are the positive/negative pair that pins the contract:
  // same falsy `connection`, but only one of them carries an `error`.
  it("[not connected] a genuinely missing row resolves with connection:null and NO error", async () => {
    const { admin } = makeFakeAdmin({ data: null, error: null });
    createAdminClient.mockReturnValue(admin);

    const result = await getDriveConnection("user-1");

    expect(result).toEqual({ connection: null, error: null });
  });

  it("[storage unavailable, AC-C4] a 42P01 (relation missing) resolves with a non-null error, distinct from 'not connected'", async () => {
    const { admin } = makeFakeAdmin({
      data: null,
      error: { code: "42P01", message: 'relation "public.drive_connections" does not exist' },
    });
    createAdminClient.mockReturnValue(admin);

    const result = await getDriveConnection("user-1");

    expect(result.connection).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.error).toBe('relation "public.drive_connections" does not exist');
    // The load-bearing distinction a caller uses to choose 503 over 401:
    expect(result.error).not.toBeNull();
  });

  it("falls back to a generic message when the error has none", async () => {
    const { admin } = makeFakeAdmin({ data: null, error: {} });
    createAdminClient.mockReturnValue(admin);
    const result = await getDriveConnection("user-1");
    expect(result.error).toBe("Could not read the Drive connection.");
  });

  it("lets an unconfigured-store throw from createAdminClient propagate, rather than swallowing it into a result object", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("createAdminClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    });

    await expect(getDriveConnection("user-1")).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("saveDriveConnection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns an error without creating a client when userId is missing", async () => {
    const result = await saveDriveConnection(undefined, { refreshToken: "rt-1" });
    expect(result).toEqual({ connection: null, error: "Missing user id." });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("upserts on user_id (never a bare insert) with every supplied field on first connect", async () => {
    const saved = { user_id: "user-1", refresh_token: "rt-1" };
    const { admin, getCalls } = makeFakeAdmin({ data: saved, error: null });
    createAdminClient.mockReturnValue(admin);

    const result = await saveDriveConnection("user-1", {
      refreshToken: "rt-1",
      accessToken: "at-1",
      expiryDate: 1735689600000,
      scope: "https://www.googleapis.com/auth/drive.file",
      googleEmail: "person@example.com",
      folderId: "folder-1",
    });

    expect(result).toEqual({ connection: saved, error: null });
    const [row, opts] = getCalls().upsert[0];
    expect(opts).toEqual({ onConflict: "user_id" });
    expect(row).toMatchObject({
      user_id: "user-1",
      refresh_token: "rt-1",
      access_token: "at-1",
      expiry_date: 1735689600000,
      scope: "https://www.googleapis.com/auth/drive.file",
      google_email: "person@example.com",
      folder_id: "folder-1",
    });
  });

  // ADJUDICATION §A-1: "merge, never replace" on the library's `tokens`
  // event, because a refresh response carries no refresh_token. A partial
  // upsert (only the columns actually supplied are written) is what makes
  // this true — asserted here by proving the OMITTED field is absent from
  // the row the query builder receives, not merely undefined on the result.
  it("omits refresh_token from the row on a token-refresh-only save (merge, never replace)", async () => {
    const { admin, getCalls } = makeFakeAdmin({ data: { user_id: "user-1" }, error: null });
    createAdminClient.mockReturnValue(admin);

    await saveDriveConnection("user-1", { accessToken: "at-2", expiryDate: 1735689600000 });

    const [row] = getCalls().upsert[0];
    expect(row).not.toHaveProperty("refresh_token");
    expect(row).toMatchObject({ access_token: "at-2", expiry_date: 1735689600000 });
  });

  it("returns the upsert error rather than throwing", async () => {
    const { admin } = makeFakeAdmin({ data: null, error: { message: "constraint violation" } });
    createAdminClient.mockReturnValue(admin);

    const result = await saveDriveConnection("user-1", { refreshToken: "rt-1" });

    expect(result).toEqual({ connection: null, error: "constraint violation" });
  });

  it("lets an unconfigured-store throw propagate", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("unconfigured");
    });
    await expect(saveDriveConnection("user-1", { refreshToken: "rt-1" })).rejects.toThrow("unconfigured");
  });
});

describe("deleteDriveConnection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns an error without creating a client when userId is missing", async () => {
    const result = await deleteDriveConnection(undefined);
    expect(result).toEqual({ deleted: false, error: "Missing user id." });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("scopes the delete by user_id and reports deleted:true only when confirmed", async () => {
    const { admin, getCalls } = makeFakeAdmin({ data: [{ user_id: "user-1" }], error: null });
    createAdminClient.mockReturnValue(admin);

    const result = await deleteDriveConnection("user-1");

    expect(result).toEqual({ deleted: true, error: null });
    expect(getCalls().delete).toEqual([true]);
    expect(getCalls().eq).toContainEqual(["user_id", "user-1"]);
  });

  it("treats deleting an already-absent row as success (idempotent disconnect)", async () => {
    const { admin } = makeFakeAdmin({ data: [], error: null });
    createAdminClient.mockReturnValue(admin);

    const result = await deleteDriveConnection("user-1");

    expect(result).toEqual({ deleted: true, error: null });
  });

  // AC-C19c / AC-C20d: never report {disconnected:true} over a surviving
  // record — the exact gmailClient.js:64-72 defect this table's design was
  // meant to avoid.
  it("never reports deleted:true when the delete itself errors", async () => {
    const { admin } = makeFakeAdmin({ data: null, error: { message: "connection reset" } });
    createAdminClient.mockReturnValue(admin);

    const result = await deleteDriveConnection("user-1");

    expect(result).toEqual({ deleted: false, error: "connection reset" });
  });

  it("lets an unconfigured-store throw propagate", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("unconfigured");
    });
    await expect(deleteDriveConnection("user-1")).rejects.toThrow("unconfigured");
  });
});
