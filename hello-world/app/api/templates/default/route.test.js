// N97 (4b) — the promote route /api/templates/default (design §4.2, plan Step 1).
// idiom = saved_searches: getUser() -> 401 -> store; userId NEVER from the body.
// This route file does not exist on HEAD -> RED by module-not-found until Step 1.
//
// Covers: AC-1 write side (kind='email' -> 400, no store write — the structural
// guarantee that no path writes an email template), AC-6 (401 without a user;
// userId derived from getUser(), never the request body), AC-9 shape
// ({ row, replaced }), and the GET/DELETE handlers (the DELETE/clear path ships
// even without a UI control, plan §7 OPEN).
//
// The store is MOCKED so this suite tests the route's own contract (auth, kind
// validation, arg threading), not the store's internals (defaultTemplateStore.test.js).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/document/defaultTemplateStore.js", () => ({
  saveDefaultTemplate: vi.fn(async () => ({ row: { id: "row-1", kind: "resume", name: "Default" }, replaced: false })),
  getDefaultTemplate: vi.fn(async () => null),
  getDefaultTemplateBytes: vi.fn(async () => null),
  clearDefaultTemplate: vi.fn(async () => ({ ok: true })),
}));

import { createClient } from "@/lib/supabase/server";
import {
  saveDefaultTemplate,
  getDefaultTemplate,
  clearDefaultTemplate,
} from "@/lib/document/defaultTemplateStore.js";
import * as route from "./route.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const USER = { id: "user-1" };

function authedClient(user = USER) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user } })) } };
}

function docxFile(name = "r.docx") {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, { type: DOCX_MIME });
}

function multipart(method, { file, kind, extra = {} } = {}) {
  const fd = new FormData();
  if (file !== undefined) fd.append("file", file);
  if (kind !== undefined) fd.append("kind", kind);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return new Request("http://localhost/api/templates/default", { method, body: fd });
}

function urlRequest(method, query = "") {
  return new Request(`http://localhost/api/templates/default${query}`, { method });
}

// The write handler is PUT or POST (design §4.2 lists both). Use whichever the
// route exports so this suite does not dictate the verb.
const writeHandler = () => route.PUT || route.POST;

beforeEach(() => {
  vi.clearAllMocks();
  saveDefaultTemplate.mockResolvedValue({ row: { id: "row-1", kind: "resume", name: "Default" }, replaced: false });
  getDefaultTemplate.mockResolvedValue(null);
  clearDefaultTemplate.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// AC-6 — auth
// ---------------------------------------------------------------------------
describe("auth (AC-6)", () => {
  it("write returns 401 and calls the store for NO ONE when there is no user", async () => {
    createClient.mockResolvedValue(authedClient(null));
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume" }));
    expect(res.status).toBe(401);
    expect(saveDefaultTemplate).not.toHaveBeenCalled();
  });

  it("GET returns 401 with no user", async () => {
    createClient.mockResolvedValue(authedClient(null));
    const res = await route.GET(urlRequest("GET", "?kind=resume"));
    expect(res.status).toBe(401);
  });

  it("derives userId from getUser(), NEVER from a body field (AC-6 — a body user_id is ignored)", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume", extra: { user_id: "attacker-42", userId: "attacker-42" } }));
    expect(saveDefaultTemplate).toHaveBeenCalledTimes(1);
    const arg = saveDefaultTemplate.mock.calls[0][1];
    expect(arg.userId).toBe("user-1");
    expect(arg.userId).not.toBe("attacker-42");
  });
});

// ---------------------------------------------------------------------------
// AC-1 write side + AC-7 — kind validation
// ---------------------------------------------------------------------------
describe("kind validation (AC-1 write side / AC-7)", () => {
  it("REFUSES kind='email' with 4xx and does NOT call the store (no path writes an email template)", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "email" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(saveDefaultTemplate).not.toHaveBeenCalled();
  });

  it("REFUSES an unknown kind with 4xx and does not call the store", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "banana" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(saveDefaultTemplate).not.toHaveBeenCalled();
  });

  it("[control] accepts kind='resume' and passes it to the store (proves the email refusal is specific)", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume" }));
    expect(res.status).toBe(200);
    expect(saveDefaultTemplate).toHaveBeenCalledTimes(1);
    expect(saveDefaultTemplate.mock.calls[0][1].kind).toBe("resume");
  });

  it("passes kind='cover' through when promoting from the cover tab (AC-7)", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    await writeHandler()(multipart("POST", { file: docxFile("c.docx"), kind: "cover" }));
    expect(saveDefaultTemplate.mock.calls[0][1].kind).toBe("cover");
  });
});

// ---------------------------------------------------------------------------
// Write success shape (AC-9) + a missing file is refused.
// ---------------------------------------------------------------------------
describe("write success + input validation", () => {
  it("returns the { row, replaced } shape on success", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    saveDefaultTemplate.mockResolvedValue({ row: { id: "row-9", kind: "resume", name: "Default" }, replaced: true });
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ replaced: true });
    expect(body.row || body).toBeTruthy();
  });

  it("refuses with 4xx (no store call) when no file is supplied", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { kind: "resume" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(saveDefaultTemplate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET hasDefault + DELETE clear.
// ---------------------------------------------------------------------------
describe("GET / DELETE", () => {
  it("GET ?kind reports hasDefault:false when no default is set", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    getDefaultTemplate.mockResolvedValue(null);
    const res = await route.GET(urlRequest("GET", "?kind=resume"));
    expect(res.status).toBe(200);
    expect((await res.json()).hasDefault).toBe(false);
  });

  it("GET ?kind reports hasDefault:true when a default row exists", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    getDefaultTemplate.mockResolvedValue({ id: "row-1", kind: "resume", name: "Default", updated_at: "2026-09-29T00:00:00Z" });
    const res = await route.GET(urlRequest("GET", "?kind=resume"));
    expect((await res.json()).hasDefault).toBe(true);
  });

  it("DELETE ?kind clears the default for the acting user", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await route.DELETE(urlRequest("DELETE", "?kind=resume"));
    expect(res.status).toBe(200);
    expect(clearDefaultTemplate).toHaveBeenCalledTimes(1);
    expect(clearDefaultTemplate.mock.calls[0][1]).toMatchObject({ userId: "user-1", kind: "resume" });
  });
});
