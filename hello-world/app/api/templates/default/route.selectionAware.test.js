// N151a (4b) — T8: the ONE behaviour change to the EXISTING default route
// (plan Step 4). GET ?kind=&bytes=1 must resolve through the selection-aware
// getActiveTemplateBytes (templateSelectionStore) instead of the reserved-only
// getDefaultTemplateBytes (defaultTemplateStore). This is what makes the client
// resolver (and its four UNCHANGED call sites, T12) selection-aware without
// touching the client (design §4.2 / PL-9).
//
// This is a SEPARATE file from route.test.js (which pins the HEAD contract and
// must keep passing): this one pins only the bytes-path edit.
//
// RED on HEAD: the route calls getDefaultTemplateBytes on the bytes path, so
// getActiveTemplateBytes is never called and the SELECTED bytes never reach the
// response. The discriminator: getActiveTemplateBytes is mocked to SELECTED and
// getDefaultTemplateBytes to a DISTINCT RESERVED — a route that still uses the
// reserved path returns RESERVED and reds. (A reference that creates the stores
// but forgets THIS edit also reds here — the test's teeth, proven in the notes.)

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/document/defaultTemplateStore.js", () => ({
  saveDefaultTemplate: vi.fn(async () => ({ row: { id: "row-1" }, replaced: false })),
  getDefaultTemplate: vi.fn(async () => null),
  getDefaultTemplateBytes: vi.fn(async () => null),
  clearDefaultTemplate: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/document/templateSelectionStore.js", () => ({
  getActiveTemplateBytes: vi.fn(async () => null),
  getSelection: vi.fn(async () => null),
  setSelection: vi.fn(async () => ({ ok: true })),
}));

import { createClient } from "@/lib/supabase/server";
import { getDefaultTemplate, getDefaultTemplateBytes } from "@/lib/document/defaultTemplateStore.js";
import { getActiveTemplateBytes } from "@/lib/document/templateSelectionStore.js";
import * as route from "./route.js";

const USER = { id: "user-1" };
const PK = [0x50, 0x4b, 0x03, 0x04];
const SELECTED_BYTES = new Uint8Array([...PK, 0xaa, 0xaa]);
const RESERVED_BYTES = new Uint8Array([...PK, 0xbb, 0xbb]);

function authedClient(user = USER) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user } })) } };
}
function urlRequest(method, query = "") {
  return new Request(`http://localhost/api/templates/default${query}`, { method });
}
async function bodyBytes(res) {
  return new Uint8Array(await res.arrayBuffer());
}

beforeEach(() => {
  vi.clearAllMocks();
  getDefaultTemplate.mockResolvedValue(null);
  getDefaultTemplateBytes.mockResolvedValue(null);
  getActiveTemplateBytes.mockResolvedValue(null);
});

describe("default route GET ?bytes=1 is selection-aware (T8 / R9 / PL-9)", () => {
  it("returns the ACTIVE (selection-aware) bytes, resolved via getActiveTemplateBytes", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    getActiveTemplateBytes.mockResolvedValue({ bytes: SELECTED_BYTES });
    // Reserved store answers with DIFFERENT bytes: a route still on the reserved
    // path would return these and fail the byte assertion below.
    getDefaultTemplateBytes.mockResolvedValue({ bytes: RESERVED_BYTES });

    const res = await route.GET(urlRequest("GET", "?kind=resume&bytes=1"));
    expect(res.status).toBe(200);
    expect(getActiveTemplateBytes, "the bytes path did not consult getActiveTemplateBytes").toHaveBeenCalledTimes(1);
    expect(getActiveTemplateBytes.mock.calls[0][1]).toMatchObject({ userId: "user-1", kind: "resume" });
    expect(Array.from(await bodyBytes(res))).toEqual(Array.from(SELECTED_BYTES));
  });

  it("returns 404 when getActiveTemplateBytes resolves null (no selection AND no reserved)", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    getActiveTemplateBytes.mockResolvedValue(null);
    const res = await route.GET(urlRequest("GET", "?kind=resume&bytes=1"));
    expect(res.status).toBe(404);
  });

  it("still 404s a bytes request for an invalid kind (email) before any resolve", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await route.GET(urlRequest("GET", "?kind=email&bytes=1"));
    expect(res.status).toBe(404);
    expect(getActiveTemplateBytes).not.toHaveBeenCalled();
  });

  it("[control] the non-bytes GET (hasDefault) is UNCHANGED — still uses getDefaultTemplate, not the selection store", async () => {
    // Proves the edit is scoped to the bytes path only; a route that re-routed
    // the hasDefault probe through the selection store would fail this.
    createClient.mockResolvedValue(authedClient(USER));
    getDefaultTemplate.mockResolvedValue({ id: "row-1", updated_at: "2026-10-01T00:00:00Z" });
    const res = await route.GET(urlRequest("GET", "?kind=resume"));
    expect(res.status).toBe(200);
    expect((await res.json()).hasDefault).toBe(true);
    expect(getDefaultTemplate).toHaveBeenCalledTimes(1);
    expect(getActiveTemplateBytes).not.toHaveBeenCalled();
  });
});

// WHAT THIS CANNOT CATCH: the "selection ?? reserved ?? null" precedence lives
// INSIDE getActiveTemplateBytes (mocked here) and is pinned by T2. This file
// only pins that the route's bytes path delegates to it.
