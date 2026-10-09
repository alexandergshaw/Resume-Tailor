// N151b (4b) — T1 / R2: the library route's GET must also report WHICH template
// is currently active, so the switcher can show it. On HEAD GET returns only
// { templates } (route.js:51); N151b makes it return { templates, selectedId },
// where selectedId is the caller's EXPLICIT selection (template_selections.
// template_id) or null when there is none.
//
// Separate file from route.test.js (which pins the shipped GET contract and must
// keep passing — it asserts body.templates ONLY, so the added field never reds
// it). This file pins only the new field.
//
// RED on HEAD: the GET handler never consults getSelection and returns no
// selectedId, so `body.selectedId` is undefined and `getSelection` is never
// called. GREEN after Step 1.
//
// Mutation that must RED: return a constant `selectedId: null` instead of the
// real selection (R2 — the panel would then always look "nothing selected").
// No-op CONTROL that must survive: a comment-only edit (modelled here as the
// null-selection case still returning an explicit null, not a crash).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/document/templateLibraryStore.js", () => ({
  listTemplates: vi.fn(async () => []),
  registerTemplate: vi.fn(async () => ({ row: { id: "row-new" } })),
  deleteTemplate: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/document/templateSelectionStore.js", () => ({
  getSelection: vi.fn(async () => null),
  setSelection: vi.fn(async () => ({ ok: true })),
  getActiveTemplateBytes: vi.fn(async () => null),
}));

import { createClient } from "@/lib/supabase/server";
import { listTemplates } from "@/lib/document/templateLibraryStore.js";
import { getSelection } from "@/lib/document/templateSelectionStore.js";
import * as route from "./route.js";

const USER = { id: "user-1" };
const TEMPLATES = [
  { id: "tmpl-a", name: "A", kind: "resume" },
  { id: "tmpl-b", name: "B", kind: "resume" },
];

function authedClient(user = USER) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user } })) } };
}
function urlRequest(query = "") {
  return new Request(`http://localhost/api/templates/library${query}`, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  listTemplates.mockResolvedValue(TEMPLATES);
  getSelection.mockResolvedValue(null);
});

describe("GET reports the current selection (T1 / R2 / PL-2)", () => {
  it("returns selectedId = the caller's explicit selection alongside the templates", async () => {
    createClient.mockResolvedValue(authedClient(USER));
    getSelection.mockResolvedValue({ template_id: "tmpl-b" });

    const res = await route.GET(urlRequest("?kind=resume"));
    expect(res.status).toBe(200);
    const body = await res.json();

    // The new field — undefined on HEAD (the whole point of the red).
    expect(body.selectedId, "GET did not report the active selection").toBe("tmpl-b");
    // Backward-compatible: the shipped templates list is still there.
    expect(body.templates).toEqual(TEMPLATES);
    // Read for the acting user + kind (session-scoped, not the body).
    expect(getSelection).toHaveBeenCalledTimes(1);
    expect(getSelection.mock.calls[0][1]).toMatchObject({ userId: "user-1", kind: "resume" });
  });

  it("reports selectedId === null (an EXPLICIT null, not undefined) when there is no selection", async () => {
    // Pins the honest null state: the panel renders "nothing selected", never a
    // guessed effective id. A route that omits the field entirely reds here too.
    createClient.mockResolvedValue(authedClient(USER));
    getSelection.mockResolvedValue(null);

    const res = await route.GET(urlRequest("?kind=resume"));
    const body = await res.json();
    expect(body).toHaveProperty("selectedId");
    expect(body.selectedId).toBeNull();
    expect(body.templates).toEqual(TEMPLATES);
  });

  it("[control] a constant-null mutant is caught: a seeded selection must round-trip, not flatten to null", async () => {
    // This is the discriminator for the R2 mutation (`selectedId: null` constant):
    // with a real selection seeded, the body must carry it, not null.
    createClient.mockResolvedValue(authedClient(USER));
    getSelection.mockResolvedValue({ template_id: "tmpl-a" });
    const res = await route.GET(urlRequest("?kind=resume"));
    const body = await res.json();
    expect(body.selectedId).toBe("tmpl-a");
    expect(body.selectedId).not.toBeNull();
  });
});
