// N151c (4b) — S2 / T2 (route half): GET /api/templates/library?kind=&id=&bytes=1
// returns ONE owned template's .docx bytes (plan §E S2, PL-7 / PL-9). The
// existing ?kind= metadata GET (N151a/b) is untouched and backward-compatible.
//
// RED on HEAD: the GET has no bytes-by-id branch, so ?bytes=1 is ignored and the
// metadata JSON is returned instead of docx bytes (the Content-Type assertion
// reds), and getTemplateBytesById is never called (that spy assertion reds).
//
// Guards this suite pins:
//   * bytes come back with a wordprocessingml Content-Type, not JSON — a client
//     that trusts any 200 (S3) would otherwise rebuild onto garbage (§F S2).
//   * userId is ALWAYS from requireUser(), never the query string (PL-9).
//   * a null from the store -> 404, never a 200 with an empty body.
//   * the metadata branch (no bytes param) must NOT call the by-id read — the
//     branch ordering is load-bearing (a bytes branch placed AFTER the metadata
//     return is never reached, §F S2).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/document/templateLibraryStore.js", () => ({
  listTemplates: vi.fn(async () => [{ id: "t1", name: "Clean", kind: "resume" }]),
  registerTemplate: vi.fn(async () => ({ row: { id: "t-new" } })),
  deleteTemplate: vi.fn(async () => ({ ok: true })),
  getTemplateBytesById: vi.fn(async () => null),
}));
vi.mock("@/lib/document/templateSelectionStore.js", () => ({
  getSelection: vi.fn(async () => ({ template_id: "t1" })),
  setSelection: vi.fn(async () => ({ ok: true })),
  getActiveTemplateBytes: vi.fn(async () => null),
}));

import { createClient } from "@/lib/supabase/server";
import { getTemplateBytesById, listTemplates } from "@/lib/document/templateLibraryStore.js";
import * as route from "./route.js";

const USER = { id: "user-1" };
const TEMPLATE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x42, 0x59]); // "BY"

function client(user = USER) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user } })) } };
}

function getRequest(query) {
  return new Request(`http://localhost/api/templates/library${query}`, { method: "GET" });
}

function requireGet() {
  expect(typeof route.GET, "route.GET does not exist").toBe("function");
  return route.GET;
}

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue(client());
  getTemplateBytesById.mockResolvedValue(null);
});

describe("GET ?kind=&id=&bytes=1 returns an owned template's docx bytes (S2 / T2 / PL-7)", () => {
  it("responds with the bytes and a wordprocessingml Content-Type (RED on HEAD: JSON)", async () => {
    getTemplateBytesById.mockResolvedValue({ bytes: TEMPLATE_BYTES });
    const res = await requireGet()(getRequest("?kind=resume&id=t1&bytes=1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "", "bytes response must declare itself a docx").toContain(
      "wordprocessingml",
    );
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(TEMPLATE_BYTES));
  });

  it("asks the store for that id with the SESSION userId and the requested kind (RED on HEAD: never called)", async () => {
    getTemplateBytesById.mockResolvedValue({ bytes: TEMPLATE_BYTES });
    await requireGet()(getRequest("?kind=resume&id=t1&bytes=1"));
    expect(getTemplateBytesById).toHaveBeenCalledTimes(1);
    expect(getTemplateBytesById.mock.calls[0][1]).toMatchObject({ userId: "user-1", id: "t1", kind: "resume" });
  });

  it("userId comes from the session, NEVER the query string (PL-9)", async () => {
    getTemplateBytesById.mockResolvedValue({ bytes: TEMPLATE_BYTES });
    await requireGet()(getRequest("?kind=resume&id=t1&bytes=1&user_id=attacker&userId=attacker"));
    expect(getTemplateBytesById.mock.calls[0][1].userId).toBe("user-1");
    expect(getTemplateBytesById.mock.calls[0][1].userId).not.toBe("attacker");
  });

  it("a store null (foreign/absent/empty) -> 404, never a 200 with an empty body", async () => {
    getTemplateBytesById.mockResolvedValue(null);
    const res = await requireGet()(getRequest("?kind=resume&id=someone-elses&bytes=1"));
    expect(res.status).toBe(404);
  });

  it("bytes=1 with a missing id is refused (4xx) and never reads bytes", async () => {
    const res = await requireGet()(getRequest("?kind=resume&bytes=1"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(getTemplateBytesById).not.toHaveBeenCalled();
  });

  it("bytes=1 with an unsupported kind is refused (4xx) and never reads bytes", async () => {
    const res = await requireGet()(getRequest("?kind=email&id=t1&bytes=1"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(getTemplateBytesById).not.toHaveBeenCalled();
  });

  it("returns 401 and reads no bytes when there is no session", async () => {
    createClient.mockResolvedValue(client(null));
    const res = await requireGet()(getRequest("?kind=resume&id=t1&bytes=1"));
    expect(res.status).toBe(401);
    expect(getTemplateBytesById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Backward-compatibility: the metadata GET is UNCHANGED and must NOT reach the
// by-id read. This is the no-op control for the new branch (survives HEAD and
// impl) and the branch-ordering guard (a bytes branch after the metadata return
// is unreachable).
// ---------------------------------------------------------------------------
describe("the ?kind= metadata GET is unchanged (N151a/b) and skips the by-id read", () => {
  it("returns { templates, selectedId } JSON and never calls getTemplateBytesById", async () => {
    const res = await requireGet()(getRequest("?kind=resume"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "").toContain("application/json");
    const body = await res.json();
    expect(Array.isArray(body.templates)).toBe(true);
    expect(body).toHaveProperty("selectedId");
    expect(listTemplates).toHaveBeenCalledTimes(1);
    expect(getTemplateBytesById).not.toHaveBeenCalled();
  });
});
