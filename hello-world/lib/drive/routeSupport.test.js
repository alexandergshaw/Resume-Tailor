import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/driveConnections", () => ({
  getDriveConnection: vi.fn(),
}));

import {
  getAuth,
  unauthorized,
  badRequest,
  notFound,
  configGate,
  notConnected,
  storageUnavailable,
  requireDriveConnection,
  driveJson,
} from "./routeSupport.js";
import * as apiAuth from "@/lib/experience/apiAuth";
import { getDriveConnection } from "@/lib/supabase/driveConnections";

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GOOGLE_CLIENT_ID = "id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "secret-value";
  getDriveConnection.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function readJson(res) {
  return JSON.parse(await res.text());
}

describe("re-exports from lib/experience/apiAuth (ADJUDICATION.md §A-3)", () => {
  // Identity, not just "returns the same shape" -- proves routeSupport.js
  // imports the shared helper rather than shipping a look-alike fourth copy
  // of the same five-line auth block.
  it("getAuth/unauthorized/badRequest/notFound are the EXACT SAME functions apiAuth.js exports", () => {
    expect(getAuth).toBe(apiAuth.getAuth);
    expect(unauthorized).toBe(apiAuth.unauthorized);
    expect(badRequest).toBe(apiAuth.badRequest);
    expect(notFound).toBe(apiAuth.notFound);
  });
});

describe("configGate (AC-C21/AC-C22)", () => {
  it("returns a 503 drive_unconfigured Response when the client id is missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const res = configGate();
    expect(res).not.toBeNull();
    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: "drive_unconfigured", configured: false });
  });

  it("returns a 503 drive_unconfigured Response when the client secret is missing", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const res = configGate();
    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: "drive_unconfigured", configured: false });
  });

  it("positive control: returns null (no gate) when both are set", () => {
    expect(configGate()).toBeNull();
  });
});

describe("notConnected (AC-E4a)", () => {
  it("is exactly 401 { error: \"not_connected\" }", async () => {
    const res = notConnected();
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: "not_connected" });
  });
});

describe("storageUnavailable (AC-C20d/AC-E17/§9.5)", () => {
  it("is exactly 503 { error: \"drive_storage_unavailable\" }", async () => {
    const res = storageUnavailable();
    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: "drive_storage_unavailable" });
  });

  it("is never the same body as notConnected -- a caller cannot confuse the two by shape", async () => {
    const a = await readJson(storageUnavailable());
    const b = await readJson(notConnected());
    expect(a).not.toEqual(b);
  });
});

describe("requireDriveConnection (AC-C4, REQUIRED)", () => {
  it("AC-C4: a genuine store error (42P01, unapplied migration) maps to 503 storage-unavailable, never not_connected", async () => {
    getDriveConnection.mockResolvedValue({
      connection: null,
      error: 'relation "drive_connections" does not exist',
    });

    const result = await requireDriveConnection("user-1");

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(503);
    const body = await readJson(result.response);
    expect(body).toEqual({ error: "drive_storage_unavailable" });
    expect(body.error).not.toBe("not_connected");
  });

  it("no rows (no error, no connection) maps to 401 not_connected -- the ordinary disconnected case", async () => {
    getDriveConnection.mockResolvedValue({ connection: null, error: null });

    const result = await requireDriveConnection("user-1");

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(401);
    expect(await readJson(result.response)).toEqual({ error: "not_connected" });
  });

  it("positive control: a real connection resolves ok:true with the connection attached, no Response built", async () => {
    const connection = { user_id: "user-1", refresh_token: "rt", folder_id: "f1" };
    getDriveConnection.mockResolvedValue({ connection, error: null });

    const result = await requireDriveConnection("user-1");

    expect(result).toEqual({ ok: true, connection });
    expect(result.response).toBeUndefined();
  });

  it("passes the userId through to the store read unchanged", async () => {
    getDriveConnection.mockResolvedValue({ connection: null, error: null });
    await requireDriveConnection("the-exact-user-id");
    expect(getDriveConnection.mock.calls).toEqual([["the-exact-user-id"]]);
  });
});

describe("driveJson (AC-C4 / secret-leakage serializer)", () => {
  it("strips every named secret key at the top level while preserving everything else", async () => {
    const res = driveJson({
      scope: "resume",
      fileId: "1AbC",
      access_token: "SHOULD-NOT-LEAK",
      refresh_token: "SHOULD-NOT-LEAK",
      id_token: "SHOULD-NOT-LEAK",
      client_secret: "SHOULD-NOT-LEAK",
    });

    const body = await readJson(res);
    expect(body).toEqual({ scope: "resume", fileId: "1AbC" });
    expect(Object.keys(body)).not.toContain("access_token");
  });

  it("strips camelCase secret keys too", async () => {
    const res = driveJson({ name: "x", accessToken: "SHOULD-NOT-LEAK", refreshToken: "SHOULD-NOT-LEAK" });
    const body = await readJson(res);
    expect(body).toEqual({ name: "x" });
  });

  it("strips secrets nested inside an object", async () => {
    const res = driveJson({
      ok: true,
      connection: { google_email: "a@example.com", refresh_token: "SHOULD-NOT-LEAK" },
    });
    const body = await readJson(res);
    expect(body).toEqual({ ok: true, connection: { google_email: "a@example.com" } });
  });

  it("strips secrets inside array elements", async () => {
    const res = driveJson({
      rows: [
        { name: "a", access_token: "SHOULD-NOT-LEAK" },
        { name: "b", refresh_token: "SHOULD-NOT-LEAK" },
      ],
    });
    const body = await readJson(res);
    expect(body).toEqual({ rows: [{ name: "a" }, { name: "b" }] });
  });

  it("positive control: a body with no secret keys is passed through unchanged, not emptied", async () => {
    const res = driveJson({ scope: "cover", fileId: "z9", version: "3" });
    const body = await readJson(res);
    expect(body).toEqual({ scope: "cover", fileId: "z9", version: "3" });
  });

  it("passes the init (status code) through to Response.json", async () => {
    const res = driveJson({ error: "conflict_session" }, { status: 409 });
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ error: "conflict_session" });
  });
});
