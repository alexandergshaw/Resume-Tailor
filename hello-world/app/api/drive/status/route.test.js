import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/drive/driveOAuth", () => ({ driveConfig: vi.fn() }));
vi.mock("@/lib/drive/driveTokens", () => ({
  loadDriveTokens: vi.fn(),
  authorizedDriveClient: vi.fn(),
}));

import { GET } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { driveConfig } from "@/lib/drive/driveOAuth";
import { loadDriveTokens, authorizedDriveClient } from "@/lib/drive/driveTokens";

const USER_ID = "55555555-5555-4555-8555-555555555555";

function signedIn() {
  createClient.mockResolvedValue(makeSupabase({}, { user: { id: USER_ID } }));
}

function statusRequest(query = "") {
  return GET(new Request(`http://localhost:3000/api/drive/status${query}`));
}

beforeEach(() => {
  createClient.mockReset();
  driveConfig.mockReset();
  driveConfig.mockReturnValue({ clientId: "id", clientSecret: "secret", configured: true });
  loadDriveTokens.mockReset();
  authorizedDriveClient.mockReset();
});

describe("GET /api/drive/status", () => {
  it("AC-C1: returns 401 for an unauthenticated caller", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));

    const res = await statusRequest();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(loadDriveTokens).not.toHaveBeenCalled();
  });

  describe("AC-C21's deliberate exception: status alone returns 200 configured:false, and never calls configGate", () => {
    it("returns 200 {connected:false, configured:false} for a signed-in caller when Google credentials are unset", async () => {
      signedIn();
      driveConfig.mockReturnValue({ clientId: null, clientSecret: null, configured: false });

      const res = await statusRequest();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ connected: false, configured: false });
      expect(loadDriveTokens).not.toHaveBeenCalled();
    });

    it("positive control: configured:true in the same shape when credentials ARE set and there is no stored connection", async () => {
      signedIn();
      loadDriveTokens.mockResolvedValue({ connection: null, error: null });

      const res = await statusRequest();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ connected: false, configured: true });
    });
  });

  describe("AC-C2: a plain GET is a pure store read — never a network call to Google", () => {
    it("returns {connected:true} for a stored credential with zero calls to authorizedDriveClient", async () => {
      signedIn();
      loadDriveTokens.mockResolvedValue({ connection: { user_id: USER_ID, google_email: null }, error: null });

      const res = await statusRequest();

      expect(await res.json()).toEqual({ connected: true, configured: true });
      expect(authorizedDriveClient).not.toHaveBeenCalled();
    });
  });

  describe("google_email -> email: DriveButton.js reads data.email, the DB column is google_email", () => {
    it("renames google_email to email on the plain GET path", async () => {
      signedIn();
      loadDriveTokens.mockResolvedValue({
        connection: { user_id: USER_ID, google_email: "person@example.com" },
        error: null,
      });

      const res = await statusRequest();
      const body = await res.json();

      expect(body.email).toBe("person@example.com");
      expect(body.google_email).toBe(undefined);
      expect(JSON.stringify(body)).not.toContain("google_email");
    });

    it("renames google_email to email on the ?verify=1 path too", async () => {
      signedIn();
      authorizedDriveClient.mockResolvedValue({
        ok: true,
        drive: {},
        auth: {},
        connection: { user_id: USER_ID, google_email: "verified@example.com" },
      });

      const res = await statusRequest("?verify=1");
      const body = await res.json();

      expect(body.email).toBe("verified@example.com");
      expect(JSON.stringify(body)).not.toContain("google_email");
    });

    it("omits the email key entirely when there is none, rather than emitting an empty string under either name", async () => {
      signedIn();
      loadDriveTokens.mockResolvedValue({ connection: { user_id: USER_ID, google_email: null }, error: null });

      const res = await statusRequest();
      const body = await res.json();

      expect(Object.prototype.hasOwnProperty.call(body, "email")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(body, "google_email")).toBe(false);
    });
  });

  describe("AC-C3: ?verify=1 refreshes and reflects a failed refresh as disconnected", () => {
    it("returns {connected:false} when authorizedDriveClient reports not_connected (e.g. invalid_grant on refresh)", async () => {
      signedIn();
      authorizedDriveClient.mockResolvedValue({ ok: false, reason: "not_connected", error: null });

      const res = await statusRequest("?verify=1");

      expect(await res.json()).toEqual({ connected: false, configured: true });
    });

    it("positive control: a successful verify returns {connected:true}", async () => {
      signedIn();
      authorizedDriveClient.mockResolvedValue({
        ok: true,
        drive: {},
        auth: {},
        connection: { user_id: USER_ID, google_email: null },
      });

      const res = await statusRequest("?verify=1");

      expect(await res.json()).toEqual({ connected: true, configured: true });
    });

    it("passes a redirectUri built from this request's own origin", async () => {
      signedIn();
      authorizedDriveClient.mockResolvedValue({ ok: false, reason: "not_connected", error: null });

      await statusRequest("?verify=1");

      expect(authorizedDriveClient).toHaveBeenCalledWith(USER_ID, "http://localhost:3000/api/drive/oauth2callback");
    });
  });

  describe("AC-C4: any store error other than 'no rows' is 503 storage-unavailable, never not_connected", () => {
    it("maps a 42P01-shaped error to 503 on the plain GET path", async () => {
      signedIn();
      loadDriveTokens.mockResolvedValue({ connection: null, error: 'relation "drive_connections" does not exist' });

      const res = await statusRequest();
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toBe("drive_storage_unavailable");
      expect(body.error).not.toBe("not_connected");
      expect(body.connected).toBe(undefined);
    });

    it("maps a storage_unavailable reason to 503 on the ?verify=1 path", async () => {
      signedIn();
      authorizedDriveClient.mockResolvedValue({
        ok: false,
        reason: "storage_unavailable",
        error: 'relation "drive_connections" does not exist',
      });

      const res = await statusRequest("?verify=1");
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.error).toBe("drive_storage_unavailable");
    });
  });

  it("never leaks a secret-shaped key even if a connection object carried one", async () => {
    signedIn();
    loadDriveTokens.mockResolvedValue({
      connection: { user_id: USER_ID, google_email: "e@x.com", refresh_token: "SECRET-RT", access_token: "SECRET-AT" },
      error: null,
    });

    const res = await statusRequest();
    const text = await res.text();

    expect(text).not.toContain("SECRET-RT");
    expect(text).not.toContain("SECRET-AT");
    // Positive control: the email (a genuinely non-secret field) DOES survive.
    expect(text).toContain("e@x.com");
  });
});
