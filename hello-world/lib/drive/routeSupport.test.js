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
  // WAVE4-SEAMS.md MAJOR-4: `stripSecrets` (the function `driveJson` calls
  // internally) is not exported, so `driveJson` -- its one and only caller
  // in this codebase -- IS the direct test surface for it. The reviewer
  // proved that deleting the strip entirely left every one of the seven
  // Drive routes' 118 tests green, because each route builds its response
  // body from explicitly named fields and the secret never enters
  // `driveJson` in the first place. The tests below close that gap by
  // constructing bodies that DO carry every named secret key -- something
  // no real route currently does, which is exactly why route-level tests
  // could never catch the strip's removal.

  // The complete SECRET_KEYS set from routeSupport.js, kept as its own
  // array (not re-derived from the module) so a mutation that drops one
  // entry from that set is caught by the per-key assertions below rather
  // than by a single all-or-nothing equality check that could pass even
  // with one key silently missing.
  const ALL_SECRET_KEYS = [
    "access_token",
    "refresh_token",
    "id_token",
    "accessToken",
    "refreshToken",
    "idToken",
    "client_secret",
    "clientSecret",
    "secret",
  ];

  it("strips every one of the nine named secret keys individually -- each assertion fails on its own if that ONE key is ever dropped from SECRET_KEYS", async () => {
    for (const key of ALL_SECRET_KEYS) {
      const res = driveJson({ scope: "resume", fileId: "1AbC", [key]: "SHOULD-NOT-LEAK" });
      const body = await readJson(res);
      expect(body, `key "${key}" was not stripped`).not.toHaveProperty(key);
      expect(body).toEqual({ scope: "resume", fileId: "1AbC" });
    }
  });

  it("strips all nine secret keys at once while preserving every non-secret sibling", async () => {
    const res = driveJson({
      scope: "resume",
      fileId: "1AbC",
      access_token: "SHOULD-NOT-LEAK",
      refresh_token: "SHOULD-NOT-LEAK",
      id_token: "SHOULD-NOT-LEAK",
      accessToken: "SHOULD-NOT-LEAK",
      refreshToken: "SHOULD-NOT-LEAK",
      idToken: "SHOULD-NOT-LEAK",
      client_secret: "SHOULD-NOT-LEAK",
      clientSecret: "SHOULD-NOT-LEAK",
      secret: "SHOULD-NOT-LEAK",
    });

    const body = await readJson(res);
    expect(body).toEqual({ scope: "resume", fileId: "1AbC" });
    for (const key of ALL_SECRET_KEYS) expect(Object.keys(body)).not.toContain(key);
  });

  it("strips secrets nested inside an object, at any depth, while preserving the non-secret fields alongside them", async () => {
    const res = driveJson({
      ok: true,
      connection: {
        google_email: "a@example.com",
        refresh_token: "SHOULD-NOT-LEAK",
        deeper: { name: "kept", secret: "SHOULD-NOT-LEAK", idToken: "SHOULD-NOT-LEAK" },
      },
    });
    const body = await readJson(res);
    expect(body).toEqual({
      ok: true,
      connection: { google_email: "a@example.com", deeper: { name: "kept" } },
    });
  });

  it("strips secrets inside array elements, including a secret nested inside an object nested inside an array element", async () => {
    const res = driveJson({
      rows: [
        { name: "a", access_token: "SHOULD-NOT-LEAK" },
        { name: "b", refresh_token: "SHOULD-NOT-LEAK", nested: { name: "c", clientSecret: "SHOULD-NOT-LEAK" } },
      ],
    });
    const body = await readJson(res);
    expect(body).toEqual({
      rows: [{ name: "a" }, { name: "b", nested: { name: "c" } }],
    });
  });

  // The paired positive control MAJOR-4 asked for: proves the non-secret
  // fields survive BYTE-IDENTICAL (via JSON round-trip), including a field
  // whose name merely CONTAINS "secret" or "token" as a substring, so this
  // suite cannot be satisfied by a function that returns `{}` for any input
  // (that would fail this control) OR by one that strips anything whose key
  // name loosely resembles a secret (that would also fail this control).
  it("positive control: a body with no secret keys -- including near-miss key names -- survives byte-identical, not emptied and not over-stripped", async () => {
    const input = {
      scope: "cover",
      fileId: "z9",
      version: "3",
      webViewLink: "https://docs.google.com/document/d/z9",
      // Near-miss names: contain "secret"/"token" as a substring but are
      // NOT exact SECRET_KEYS entries, so they must survive too -- proves
      // the strip matches by exact key name, not substring.
      secretNote: "not a real secret key",
      tokenCount: 3,
      nested: { name: "kept", tokenType: "Bearer" },
      rows: [{ name: "a", tokenized: true }],
    };
    const res = driveJson(input);
    const body = await readJson(res);
    expect(body).toEqual(input);
    expect(JSON.stringify(body)).toBe(JSON.stringify(input));
  });

  it("passes the init (status code) through to Response.json", async () => {
    const res = driveJson({ error: "conflict_session" }, { status: 409 });
    expect(res.status).toBe(409);
    expect(await readJson(res)).toEqual({ error: "conflict_session" });
  });
});
