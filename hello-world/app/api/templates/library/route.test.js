// N151a (4b) — the template LIBRARY route /api/templates/library (plan Step 4).
// idiom = app/api/templates/default/route.test.js: getUser() -> 401 -> store;
// userId NEVER from the body. This route file does not exist on HEAD -> RED by
// module-not-found until Step 4.
//
// Covers T6 (non-docx bytes REFUSED with 4xx — ext + ZIP-magic, R7) and T7
// (on a successful register the route SETS the selection to the new row, P1/R8).
// The stores are MOCKED so this suite tests the route's own contract (auth,
// kind validation, the docx guard, the register->select wiring), not store
// internals (templateLibraryStore.test.js / templateSelectionStore.test.js).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/document/templateLibraryStore.js", () => ({
  listTemplates: vi.fn(async () => []),
  registerTemplate: vi.fn(async () => ({ row: { id: "row-new", kind: "resume", name: "My Template" } })),
  deleteTemplate: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/document/templateSelectionStore.js", () => ({
  setSelection: vi.fn(async () => ({ ok: true })),
  getSelection: vi.fn(async () => null),
  getActiveTemplateBytes: vi.fn(async () => null),
}));

import { createClient } from "@/lib/supabase/server";
import { listTemplates, registerTemplate, deleteTemplate } from "@/lib/document/templateLibraryStore.js";
import { setSelection } from "@/lib/document/templateSelectionStore.js";
import * as route from "./route.js";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const USER = { id: "user-1" };

function authedClient(user = USER) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user } })) } };
}

// A real .docx = ZIP container, first bytes PK\x03\x04.
const PK = [0x50, 0x4b, 0x03, 0x04];
function docxFile(name = "My Template.docx") {
  return new File([new Uint8Array([...PK, 0x14, 0x00])], name, { type: DOCX_MIME });
}
// Bytes that are NOT a zip: a .docx extension spoofed over non-zip content.
function fakeDocxFile(name = "My Template.docx") {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: DOCX_MIME }); // "%PDF"
}
// An honest non-docx extension.
function pdfFile(name = "resume.pdf") {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });
}

function multipart(method, { file, kind, name, extra = {} } = {}) {
  const fd = new FormData();
  if (file !== undefined) fd.append("file", file);
  if (kind !== undefined) fd.append("kind", kind);
  if (name !== undefined) fd.append("name", name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return new Request("http://localhost/api/templates/library", { method, body: fd });
}

function urlRequest(method, query = "") {
  return new Request(`http://localhost/api/templates/library${query}`, { method });
}

const writeHandler = () => route.POST || route.PUT;

beforeEach(() => {
  vi.clearAllMocks();
  registerTemplate.mockResolvedValue({ row: { id: "row-new", kind: "resume", name: "My Template" } });
  setSelection.mockResolvedValue({ ok: true });
  listTemplates.mockResolvedValue([]);
  deleteTemplate.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// auth — userId from the session, never the body.
// ---------------------------------------------------------------------------
describe("auth", () => {
  it("POST returns 401 and registers for NO ONE when there is no user", async () => {
    createClient.mockResolvedValue(authedClient(null));
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume", name: "X" }));
    expect(res.status).toBe(401);
    expect(registerTemplate).not.toHaveBeenCalled();
  });

  it("derives userId from getUser(), NEVER from a body field", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume", name: "X", extra: { user_id: "attacker-42", userId: "attacker-42" } }));
    expect(registerTemplate).toHaveBeenCalledTimes(1);
    expect(registerTemplate.mock.calls[0][1].userId).toBe("user-1");
    expect(registerTemplate.mock.calls[0][1].userId).not.toBe("attacker-42");
  });
});

// ---------------------------------------------------------------------------
// T6 — the .docx-only server guard (R7). Non-docx bytes must be REFUSED, not
// silently stored (a non-docx row renders native output with no error at the
// override).
// ---------------------------------------------------------------------------
describe("non-docx is refused (T6 / R7)", () => {
  it("REFUSES a .docx extension over non-ZIP bytes (spoofed magic) with 4xx and no register", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { file: fakeDocxFile(), kind: "resume", name: "X" }));
    expect(res.status, "spoofed-magic .docx must be refused").toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(registerTemplate).not.toHaveBeenCalled();
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("REFUSES an honest non-docx extension (.pdf) with 4xx and no register", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { file: pdfFile(), kind: "resume", name: "X" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(registerTemplate).not.toHaveBeenCalled();
  });

  it("[control] ACCEPTS a real .docx (ZIP magic + .docx ext) — register fires (proves the refusal is specific)", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume", name: "My Template" }));
    expect(res.status).toBe(200);
    expect(registerTemplate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// kind validation — email structurally excluded.
// ---------------------------------------------------------------------------
describe("kind validation", () => {
  it("REFUSES kind='email' with 4xx and does not call the store", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "email", name: "X" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(registerTemplate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T7 — on success the route SETS the selection to the new row (P1 / R8).
// ---------------------------------------------------------------------------
describe("register sets the selection (T7 / P1 / R8)", () => {
  it("after a successful register, setSelection is called for the SAME user and the NEW row id", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    registerTemplate.mockResolvedValue({ row: { id: "row-new", kind: "resume", name: "My Template" } });
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume", name: "My Template" }));
    expect(res.status).toBe(200);
    expect(setSelection).toHaveBeenCalledTimes(1);
    const arg = setSelection.mock.calls[0][1];
    expect(arg.userId).toBe("user-1");
    expect(arg.kind).toBe("resume");
    expect(arg.templateId).toBe("row-new"); // the just-created row, not some other id
  });

  it("does NOT set a selection when register FAILS (never activate a template that wasn't created)", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    registerTemplate.mockResolvedValue({ error: "You already have a template named \"My Template\"." });
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume", name: "My Template" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("returns the { row } shape on success", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await writeHandler()(multipart("POST", { file: docxFile(), kind: "resume", name: "My Template" }));
    const body = await res.json();
    expect(body.row || body).toBeTruthy();
    expect((body.row || {}).id || body.id).toBe("row-new");
  });
});

// ---------------------------------------------------------------------------
// GET list + DELETE.
// ---------------------------------------------------------------------------
describe("GET list / DELETE", () => {
  it("GET ?kind returns { templates } for the acting user", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    listTemplates.mockResolvedValue([{ id: "a", name: "A", kind: "resume" }]);
    const res = await route.GET(urlRequest("GET", "?kind=resume"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.templates).toEqual([{ id: "a", name: "A", kind: "resume" }]);
    expect(listTemplates.mock.calls[0][1]).toMatchObject({ userId: "user-1", kind: "resume" });
  });

  it("DELETE ?id removes the row for the acting user", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    const res = await route.DELETE(urlRequest("DELETE", "?id=tmpl-1"));
    expect(res.status).toBe(200);
    expect(deleteTemplate).toHaveBeenCalledTimes(1);
    expect(deleteTemplate.mock.calls[0][1]).toMatchObject({ userId: "user-1", id: "tmpl-1" });
  });
});
