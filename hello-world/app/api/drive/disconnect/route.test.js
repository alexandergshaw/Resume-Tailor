import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabase } from "../../../../test/helpers/supabaseMock.js";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/drive/driveOAuth", () => ({ driveConfig: vi.fn() }));
vi.mock("@/lib/drive/driveTokens", () => ({ disconnectDrive: vi.fn() }));

import { DELETE } from "./route.js";
import { createClient } from "@/lib/supabase/server";
import { driveConfig } from "@/lib/drive/driveOAuth";
import { disconnectDrive } from "@/lib/drive/driveTokens";

const USER_ID = "66666666-6666-4666-8666-666666666666";

function signedIn() {
  createClient.mockResolvedValue(makeSupabase({}, { user: { id: USER_ID } }));
}

beforeEach(() => {
  createClient.mockReset();
  driveConfig.mockReset();
  driveConfig.mockReturnValue({ clientId: "id", clientSecret: "secret", configured: true });
  disconnectDrive.mockReset();
  disconnectDrive.mockResolvedValue({ deleted: true, revoked: true, error: null });
});

describe("DELETE /api/drive/disconnect", () => {
  it("returns 401 for an unauthenticated caller and never calls disconnectDrive", async () => {
    createClient.mockResolvedValue(makeSupabase({}, { user: null }));

    const res = await DELETE();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(disconnectDrive).not.toHaveBeenCalled();
  });

  it("returns 503 drive_unconfigured when Google credentials are unset", async () => {
    signedIn();
    driveConfig.mockReturnValue({ clientId: null, clientSecret: null, configured: false });

    const res = await DELETE();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "drive_unconfigured", configured: false });
    expect(disconnectDrive).not.toHaveBeenCalled();
  });

  it("AC-C19c: returns 200 {disconnected:true} only once the local delete is confirmed", async () => {
    signedIn();

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
    expect(disconnectDrive).toHaveBeenCalledWith(USER_ID);
  });

  it("AC-C19b: a failed Google revocation alone does not stop success being reported (disconnectDrive already encodes this; the route trusts its `deleted` field)", async () => {
    signedIn();
    disconnectDrive.mockResolvedValue({ deleted: true, revoked: false, error: null });

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true });
  });

  it("AC-C20d: storage unreachable is 503, NEVER {disconnected:true} over a surviving record", async () => {
    signedIn();
    disconnectDrive.mockResolvedValue({ deleted: false, revoked: false, error: "Could not delete the Drive connection." });

    const res = await DELETE();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "drive_storage_unavailable" });
    expect(body.disconnected).toBe(undefined);
  });

  it("treats deleted:false with no error message as a failure too (never assumes success from an ambiguous result)", async () => {
    signedIn();
    disconnectDrive.mockResolvedValue({ deleted: false, revoked: false, error: null });

    const res = await DELETE();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.disconnected).toBe(undefined);
  });

  it("never leaks a secret-shaped key even if disconnectDrive's result carried one", async () => {
    signedIn();
    disconnectDrive.mockResolvedValue({ deleted: true, revoked: true, error: null, refresh_token: "SECRET-RT" });

    const res = await DELETE();
    const text = await res.text();

    expect(text).not.toContain("SECRET-RT");
    // Positive control: the response is not simply empty — a route that
    // returns nothing at all would satisfy the absence assertion above for
    // the wrong reason.
    expect(text).toContain('"disconnected":true');
  });
});
