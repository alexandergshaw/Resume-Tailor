import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- googleapis: a controllable OAuth2 double -------------------------
// This has to be good enough to drive driveOAuth.js's REAL code
// (createDriveOAuthClient / revokeToken, both unmocked below) and to
// simulate the one library behaviour AC-C18 is entirely about: a
// transparent refresh emitting `'tokens'`. `box` is `vi.hoisted` because
// the mock factory runs before these declarations otherwise.
const box = vi.hoisted(() => ({
  instances: [],
  driveInstances: [],
  getAccessTokenImpl: null,
  revokeTokenImpl: async () => ({ data: { success: true } }),
}));

vi.mock("googleapis", () => {
  class FakeOAuth2 {
    constructor(...args) {
      this.__ctorArgs = args;
      this._listeners = {};
      this.credentials = {};
      this.revokeToken = vi.fn((...a) => box.revokeTokenImpl(...a));
      this.generateAuthUrl = vi.fn(() => "https://accounts.google.com/mock");
      this.getToken = vi.fn(async () => ({ tokens: {} }));
      box.instances.push(this);
    }
    setCredentials(creds) {
      this.credentials = { ...this.credentials, ...creds };
    }
    on(event, cb) {
      (this._listeners[event] ||= []).push(cb);
      return this;
    }
    emit(event, payload) {
      for (const cb of this._listeners[event] || []) cb(payload);
    }
    async getAccessToken() {
      const impl = box.getAccessTokenImpl || (async () => ({ token: this.credentials.access_token || null }));
      return impl(this);
    }
  }
  const drive = vi.fn((opts) => {
    const instance = { __opts: opts, files: {} };
    box.driveInstances.push(instance);
    return instance;
  });
  return { google: { auth: { OAuth2: FakeOAuth2 }, drive } };
});

// --- @/lib/supabase/admin: an in-memory Postgres/PostgREST double -----
// Faithful to the ONE behaviour this whole feature leans on: PostgREST's
// upsert only SETs columns present in the payload on a conflict, so a
// payload missing `refresh_token` leaves the stored value untouched. This
// is the real mechanism `lib/supabase/driveConnections.js`'s own header
// documents -- reproduced here rather than assumed, so a test that relies
// on it is proving the real interaction, not a convenient fiction.
function makeSupabaseAdmin(seed = {}) {
  const store = {};
  for (const [k, v] of Object.entries(seed)) store[k] = { ...v };
  let forceReadBackNull = false;

  function builder() {
    let mode = null;
    let eqValue;
    let upsertRow;
    const b = {
      select() {
        if (!mode) mode = "select";
        return b;
      },
      eq(_field, value) {
        eqValue = value;
        return b;
      },
      upsert(row) {
        mode = "upsert";
        upsertRow = row;
        return b;
      },
      delete() {
        mode = "delete";
        return b;
      },
      maybeSingle() {
        if (mode === "select") {
          if (forceReadBackNull) return Promise.resolve({ data: null, error: null });
          const row = store[eqValue];
          return Promise.resolve({ data: row ? { ...row } : null, error: null });
        }
        if (mode === "upsert") {
          const existing = store[upsertRow.user_id] || {};
          const merged = { ...existing, ...upsertRow };
          store[upsertRow.user_id] = merged;
          return Promise.resolve({ data: { ...merged }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve, reject) {
        if (mode === "delete") {
          const existed = Boolean(store[eqValue]);
          delete store[eqValue];
          return Promise.resolve({ data: existed ? [{ user_id: eqValue }] : [], error: null }).then(
            resolve,
            reject,
          );
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return b;
  }

  const admin = { from: vi.fn(() => builder()) };
  return {
    admin,
    store,
    setForceReadBackNull: (v) => {
      forceReadBackNull = v;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

// `saveDriveConnection` is wrapped (not replaced) around its real
// implementation, so every test below still exercises the REAL merge/
// upsert/read-back-shape logic of driveConnections.js -- the only thing
// this adds is the ability to inspect exactly what field object
// driveTokens.js handed it, which is the correct unit boundary for
// proving 3A's OWN merge logic (as opposed to 2C's, which has its own
// test file).
vi.mock("@/lib/supabase/driveConnections", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, saveDriveConnection: vi.fn(actual.saveDriveConnection) };
});

import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveDriveConnection } from "@/lib/supabase/driveConnections";
import {
  loadDriveTokens,
  saveDriveTokens,
  deleteDriveTokens,
  disconnectDrive,
  authorizedDriveClient,
} from "./driveTokens.js";

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
let savedEnv = {};
let sb; // { admin, store, setForceReadBackNull }

const CONNECTED_ROW = {
  user_id: "user-1",
  refresh_token: "stored-refresh-token",
  access_token: "stored-access-token",
  expiry_date: 1_700_000_000_000,
  scope: "https://www.googleapis.com/auth/drive.file",
  google_email: "person@example.com",
  folder_id: null,
};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "shh-secret";

  box.instances = [];
  box.driveInstances = [];
  box.getAccessTokenImpl = null;
  box.revokeTokenImpl = async () => ({ data: { success: true } });

  sb = makeSupabaseAdmin();
  createAdminClient.mockReturnValue(sb.admin);
  saveDriveConnection.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ---------------------------------------------------------------------
// loadDriveTokens
// ---------------------------------------------------------------------

describe("loadDriveTokens", () => {
  it("returns the stored connection unmodified", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    const result = await loadDriveTokens("user-1");
    expect(result).toEqual({ connection: { ...CONNECTED_ROW }, error: null });
  });

  it("returns connection:null, error:null when nothing is stored (not connected)", async () => {
    const result = await loadDriveTokens("user-1");
    expect(result).toEqual({ connection: null, error: null });
  });
});

// ---------------------------------------------------------------------
// saveDriveTokens -- AC-C18's merge, and AC-C17's read-back guard
// ---------------------------------------------------------------------

describe("saveDriveTokens", () => {
  it("writes every field on a first connect (refresh_token included) and reads it back", async () => {
    const tokens = {
      access_token: "at-1",
      refresh_token: "rt-1",
      expiry_date: 1_800_000_000_000,
      scope: "https://www.googleapis.com/auth/drive.file",
      token_type: "Bearer",
    };

    const result = await saveDriveTokens("user-1", tokens, { googleEmail: "a@b.com" });

    expect(result.error).toBeNull();
    expect(result.connection).toMatchObject({
      user_id: "user-1",
      refresh_token: "rt-1",
      access_token: "at-1",
      expiry_date: 1_800_000_000_000,
      google_email: "a@b.com",
    });
  });

  // THE core AC-C18 merge proof. A refresh response carries no
  // `refresh_token` key at all -- the mutation table's #2 entry mutates
  // `tokenFieldsPresent` to include it anyway, and this is the test that
  // catches that.
  it("MERGE, never replace: a refresh-shaped save never sends refreshToken to storage, and the stored refresh_token survives", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };

    const refreshOnlyTokens = { access_token: "new-access-token", expiry_date: 1_900_000_000_000 };
    const result = await saveDriveTokens("user-1", refreshOnlyTokens);

    // Unit-boundary assertion: driveTokens.js itself never even offers a
    // refreshToken key to storage on a refresh-shaped save.
    const call = saveDriveConnection.mock.calls.find((c) => c[0] === "user-1");
    expect(call).toBeTruthy();
    expect(call[1]).not.toHaveProperty("refreshToken");

    // End-to-end assertion (through the REAL driveConnections.js and the
    // faithful partial-upsert double): the original refresh_token is
    // still there, and the new access_token/expiry_date landed.
    expect(result.error).toBeNull();
    expect(result.connection.refresh_token).toBe("stored-refresh-token");
    expect(result.connection.access_token).toBe("new-access-token");
    expect(result.connection.expiry_date).toBe(1_900_000_000_000);
  });

  // Paired positive control for the merge test above (test-quality rule
  // #2): a save that legitimately DOES carry a new refresh_token (e.g. a
  // fresh consent grant replacing an old one) DOES overwrite it. Proves
  // the merge test isn't passing merely because nothing is ever written.
  it("positive control: a save that legitimately carries a new refresh_token does overwrite it", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };

    const result = await saveDriveTokens("user-1", {
      access_token: "at-2",
      refresh_token: "brand-new-refresh-token",
      expiry_date: 2_000_000_000_000,
    });

    expect(result.error).toBeNull();
    expect(result.connection.refresh_token).toBe("brand-new-refresh-token");
  });

  it("supports a token-less save that only carries `extra` (e.g. caching folder_id)", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };

    const result = await saveDriveTokens("user-1", undefined, { folderId: "folder-abc" });

    expect(result.error).toBeNull();
    expect(result.connection.folder_id).toBe("folder-abc");
    expect(result.connection.refresh_token).toBe("stored-refresh-token");
    const call = saveDriveConnection.mock.calls.at(-1);
    expect(call[1]).not.toHaveProperty("refreshToken");
    expect(call[1]).not.toHaveProperty("accessToken");
  });

  // AC-C17. The mutation table's #3 entry removes this check entirely; this
  // is the test that catches it. Simulates a write that the upsert itself
  // reports as accepted, but an independent re-read cannot see (eventual
  // consistency, a phantom write) -- the exact shape of the Gmail defect
  // this guard exists to close (F-2: a completed consent flow landing on
  // "not connected" with nothing logged).
  it("AC-C17: a write whose independent read-back cannot find the row reports failure, not success", async () => {
    sb.setForceReadBackNull(true);

    const result = await saveDriveTokens("user-1", {
      access_token: "at-1",
      refresh_token: "rt-1",
      expiry_date: 1_800_000_000_000,
    });

    expect(result.connection).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("propagates a genuine write error without attempting the read-back's success path", async () => {
    createAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: () => ({
          select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "constraint violation" } }) }),
        }),
      }),
    });

    const result = await saveDriveTokens("user-1", { access_token: "at", refresh_token: "rt" });
    expect(result).toEqual({ connection: null, error: "constraint violation" });
  });

  it("returns an error without writing when userId is missing", async () => {
    const result = await saveDriveTokens(undefined, { access_token: "at" });
    expect(result).toEqual({ connection: null, error: "Missing user id." });
    expect(saveDriveConnection).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// deleteDriveTokens
// ---------------------------------------------------------------------

describe("deleteDriveTokens", () => {
  it("deletes the stored row and reports deleted:true", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    const result = await deleteDriveTokens("user-1");
    expect(result).toEqual({ deleted: true, error: null });
    expect(sb.store["user-1"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// disconnectDrive -- AC-C19a/b/c
// ---------------------------------------------------------------------

describe("disconnectDrive", () => {
  it("AC-C19a: revokes the stored token at Google, then deletes the local record", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    box.revokeTokenImpl = vi.fn(async () => ({ data: { success: true } }));

    const result = await disconnectDrive("user-1");

    expect(box.revokeTokenImpl).toHaveBeenCalledWith("stored-refresh-token");
    expect(result).toEqual({ deleted: true, error: null, revoked: true });
    expect(sb.store["user-1"]).toBeUndefined();
  });

  // AC-C19b. Positive control is the test above (a successful revoke also
  // deletes) -- this proves the delete is NOT conditioned on revoke
  // succeeding.
  it("AC-C19b: a failed revocation still deletes the local record", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    box.revokeTokenImpl = async () => {
      throw new Error("revoke endpoint unreachable");
    };

    const result = await disconnectDrive("user-1");

    expect(result.revoked).toBe(false);
    expect(result.deleted).toBe(true);
    expect(sb.store["user-1"]).toBeUndefined();
  });

  // AC-C19c / AC-C20d -- the exact gmailClient.js:64-71 defect (a delete
  // whose response status nothing inspects, so a failure reports success).
  it("AC-C19c: a storage failure on delete is never reported as deleted:true", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    createAdminClient.mockReturnValue({
      from: (table) => {
        if (table !== "drive_connections") throw new Error("unexpected table");
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { ...CONNECTED_ROW }, error: null }) }),
          }),
          delete: () => ({
            eq: () => ({
              select: () => Promise.resolve({ data: null, error: { message: "connection reset" } }),
            }),
          }),
        };
      },
    });

    const result = await disconnectDrive("user-1");

    expect(result.deleted).toBe(false);
    expect(result.error).toBe("connection reset");
  });

  it("disconnecting an already-disconnected user is a no-op success, not an error", async () => {
    const result = await disconnectDrive("user-1");
    expect(result).toEqual({ deleted: true, error: null, revoked: false });
  });
});

// ---------------------------------------------------------------------
// authorizedDriveClient -- AC-C18 (subscribe + merge), AC-E6 (proactive
// refresh), and the not_connected / storage_unavailable distinction §9.5.
// ---------------------------------------------------------------------

describe("authorizedDriveClient", () => {
  it("not_connected: no stored row", async () => {
    const result = await authorizedDriveClient("user-1", "https://app/cb");
    expect(result).toEqual({ ok: false, reason: "not_connected", error: null });
  });

  // Paired with the test above per test-quality rule #2, and this is the
  // pair the mutation table's #4 entry (a store error collapsed into
  // "not connected") targets directly.
  it("storage_unavailable: a genuine storage error (e.g. 42P01) is NEVER reported as not_connected", async () => {
    createAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: 'relation "public.drive_connections" does not exist' },
            }),
          }),
        }),
      }),
    });

    const result = await authorizedDriveClient("user-1", "https://app/cb");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("storage_unavailable");
    expect(result.reason).not.toBe("not_connected");
    expect(result.error).toBeTruthy();
  });

  it("builds the client from the stored credentials and returns a ready-to-use drive instance", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };

    const result = await authorizedDriveClient("user-1", "https://app/cb");

    expect(result.ok).toBe(true);
    expect(box.instances[0].credentials).toMatchObject({
      access_token: "stored-access-token",
      refresh_token: "stored-refresh-token",
      expiry_date: 1_700_000_000_000,
    });
    expect(result.drive).toBe(box.driveInstances[0]);
    expect(box.driveInstances[0].__opts.auth).toBe(box.instances[0]);
    expect(result.connection.user_id).toBe("user-1");
  });

  // THE core AC-C18 proof for the live client path. The mutation table's
  // #1 entry removes the `.on("tokens", ...)` subscription; this is the
  // test that catches it -- a refresh the LIBRARY triggers transparently
  // (simulated here via getAccessToken emitting 'tokens', exactly as the
  // real oauth2client.js does internally) must be persisted, merged, not
  // replaced.
  it("AC-C18: a token the library refreshes transparently during getAccessToken() is persisted, merged onto the stored row", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };

    box.getAccessTokenImpl = async function (client) {
      // Mirrors the real library: a refresh response carries no
      // refresh_token, and the 'tokens' event fires with only what
      // actually changed.
      const refreshed = { access_token: "silently-refreshed-token", expiry_date: 9_999_999_999_999 };
      client.setCredentials(refreshed);
      client.emit("tokens", refreshed);
      return { token: refreshed.access_token };
    };

    const result = await authorizedDriveClient("user-1", "https://app/cb");
    expect(result.ok).toBe(true);

    // saveDriveTokens is fired-and-forgotten inside the listener; wait for
    // the real async write+read-back chain to actually settle.
    await vi.waitFor(() => {
      expect(sb.store["user-1"]?.access_token).toBe("silently-refreshed-token");
    });

    expect(sb.store["user-1"].refresh_token).toBe("stored-refresh-token"); // never wiped
    expect(sb.store["user-1"].expiry_date).toBe(9_999_999_999_999);
  });

  it("AC-E6: getAccessToken() is awaited before the client is handed back (proactive refresh happens before any upload)", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    let getAccessTokenResolved = false;
    box.getAccessTokenImpl = async () => {
      await Promise.resolve();
      getAccessTokenResolved = true;
      return { token: "t" };
    };

    const result = await authorizedDriveClient("user-1", "https://app/cb");

    expect(getAccessTokenResolved).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("a refresh that fails with invalid_grant classifies as reconnect-needed, not a thrown error", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    box.getAccessTokenImpl = async () => {
      const err = new Error("Invalid grant, don't match the string");
      err.response = { data: { error: "invalid_grant" } };
      throw err;
    };

    const result = await authorizedDriveClient("user-1", "https://app/cb");
    expect(result).toEqual({ ok: false, reason: "not_connected", error: null });
  });

  it("a 401 during the proactive refresh also classifies as reconnect-needed", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    box.getAccessTokenImpl = async () => {
      const err = new Error("some rewritten message the library produced");
      err.status = 401;
      throw err;
    };

    const result = await authorizedDriveClient("user-1", "https://app/cb");
    expect(result.reason).toBe("not_connected");
  });

  // Never a message-string match (the classifier's whole reason for
  // existing, per driveErrors.js and this feature's FACTS doc): an error
  // whose message happens to contain "invalid_grant" but isn't actually
  // shaped that way (no matching status, no matching response.data.error)
  // must NOT be treated as reconnect-needed.
  it("a transient failure during refresh (not 401, not invalid_grant) is rethrown, not swallowed as a state", async () => {
    sb.store["user-1"] = { ...CONNECTED_ROW };
    box.getAccessTokenImpl = async () => {
      const err = new Error("the message happens to mention invalid_grant but this is not that shape");
      err.status = 500;
      throw err;
    };

    await expect(authorizedDriveClient("user-1", "https://app/cb")).rejects.toThrow(/invalid_grant/);
  });

  it("returns an error result without constructing a client when userId is missing", async () => {
    const result = await authorizedDriveClient(undefined, "https://app/cb");
    expect(result.ok).toBe(false);
    expect(box.instances.length).toBe(0);
  });
});

// ---------------------------------------------------------------------
// Production-shaped call (test-quality rule #3): authorizedDriveClient
// called with exactly the two arguments a route passes it -- nothing
// injected, nothing DI'd, only the true network boundary (googleapis'
// transport and Supabase's admin client) replaced. Every other function
// in this file (driveOAuth.js, driveConnections.js, driveErrors.js) is
// the REAL, unmocked module.
// ---------------------------------------------------------------------

describe("production-shaped call", () => {
  it("a full connect -> save -> authorizedDriveClient cycle, calling every function exactly as the routes will", async () => {
    // 1. oauth2callback route's shape: saveDriveTokens(userId, exchangeCode's raw tokens).
    const firstConnect = await saveDriveTokens("user-42", {
      access_token: "at-initial",
      refresh_token: "rt-initial",
      expiry_date: 1_800_000_000_000,
      scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
      token_type: "Bearer",
    });
    expect(firstConnect.error).toBeNull();
    expect(firstConnect.connection.refresh_token).toBe("rt-initial");

    // 2. save/export route's shape: authorizedDriveClient(userId, redirectUri) -- two
    // positional arguments, nothing else.
    const authResult = await authorizedDriveClient("user-42", "https://app.example.com/api/drive/oauth2callback");
    expect(authResult.ok).toBe(true);
    expect(typeof authResult.drive).toBe("object");

    // 3. disconnect route's shape: disconnectDrive(userId).
    const disconnectResult = await disconnectDrive("user-42");
    expect(disconnectResult.deleted).toBe(true);

    const afterDisconnect = await authorizedDriveClient("user-42", "https://app.example.com/api/drive/oauth2callback");
    expect(afterDisconnect).toEqual({ ok: false, reason: "not_connected", error: null });
  });
});
