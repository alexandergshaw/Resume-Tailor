// N151b (4b) — T2 / R1 / R3: the PUT verb that ACTIVATES an existing template by
// id. On HEAD there is no verb to select a template that already exists (only the
// upload POST sets a selection), so route.PUT is undefined and every test here is
// RED by "route.PUT is not a function". GREEN after Step 1.
//
// This file carries the HEADLINE silent-failure instrument (R1). A route that
// drops the OWNERSHIP guard lets a caller activate a template id they do not own;
// getActiveTemplateBytes then gates its template read on user_id (templateSelection
// Store.js:81), finds nothing, and the output silently renders NATIVE formatting
// while the UI shows a selection. So the guard must refuse a foreign id LOUDLY
// (4xx), never set the selection.
//
// Mutations that must RED:
//   R1 — remove the ownership read: a foreign id then reaches setSelection and
//        returns 200. The foreign-id test flips to 200 + setSelection called.
//   R3 — read userId from the body: the attacker-body test then selects for the
//        wrong user.
// No-op CONTROL that must survive: reordering unrelated statements (modelled by
// the owned-id success case, which must stay 200 under any faithful build).
//
// The stores are mocked (setSelection is a spy); the OWNERSHIP read is a direct
// supabase `resume_templates` query per the plan, so the supabase client here is
// a small in-memory fake seeded with exactly one OWNED row — a foreign/absent id
// matches nothing. The assertions are on OBSERVABLE behaviour (status +
// setSelection calls), so a faithful build that checks ownership via a store
// helper instead of a direct read still satisfies them as long as it refuses a
// template the caller does not own.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/document/templateLibraryStore.js", () => ({
  listTemplates: vi.fn(async (_c, { userId, kind }) =>
    OWNED_ROWS.filter((r) => r.user_id === userId && r.kind === kind)),
  registerTemplate: vi.fn(async () => ({ row: { id: "row-new" } })),
  deleteTemplate: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/document/templateSelectionStore.js", () => ({
  setSelection: vi.fn(async () => ({ ok: true })),
  getSelection: vi.fn(async () => null),
  getActiveTemplateBytes: vi.fn(async () => null),
}));

import { createClient } from "@/lib/supabase/server";
import { setSelection } from "@/lib/document/templateSelectionStore.js";
import * as route from "./route.js";

const USER = { id: "user-1" };
// Exactly one template the caller owns. Anything else is foreign/absent.
const OWNED_ROWS = [{ id: "owned-1", user_id: "user-1", kind: "resume", name: "Mine" }];

// A supabase fake that answers the direct ownership read in either shape a
// faithful build might use: `.maybeSingle()` (single-row id+user+kind read) or an
// awaited list filtered by the same `.eq()` columns.
function templatesClient(user = USER, rows = OWNED_ROWS) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    from(table) {
      const eqs = [];
      const run = () => {
        if (table !== "resume_templates") return [];
        return rows.filter((r) => eqs.every(([c, v]) => r[c] === v));
      };
      const builder = {
        select: () => builder,
        order: () => builder,
        eq: (c, v) => { eqs.push([c, v]); return builder; },
        maybeSingle: async () => ({ data: run()[0] || null, error: null }),
        single: async () => ({ data: run()[0] || null, error: run()[0] ? null : { message: "no row" } }),
        then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return builder;
    },
  };
}

function putRequest(body) {
  return new Request("http://localhost/api/templates/library", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Fail loudly, in-test, if the verb is missing (that is the HEAD red reason).
function requirePut() {
  expect(typeof route.PUT, "route.PUT verb does not exist on HEAD").toBe("function");
  return route.PUT;
}

beforeEach(() => {
  vi.clearAllMocks();
  setSelection.mockResolvedValue({ ok: true });
});

describe("PUT activates an OWNED template (T2 / PL-3)", () => {
  it("sets the selection to a template the caller owns and returns 200", async () => {
    createClient.mockResolvedValue(templatesClient(USER));
    const res = await requirePut()(putRequest({ kind: "resume", templateId: "owned-1" }));
    expect(res.status).toBe(200);
    expect(setSelection).toHaveBeenCalledTimes(1);
    const arg = setSelection.mock.calls[0][1];
    expect(arg).toMatchObject({ userId: "user-1", kind: "resume", templateId: "owned-1" });
  });

  it("[control] selecting the owned template succeeds regardless of statement order (no-op control)", async () => {
    createClient.mockResolvedValue(templatesClient(USER));
    const res = await requirePut()(putRequest({ kind: "resume", templateId: "owned-1" }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R1 — the ownership guard. THE headline silent-failure instrument.
// ---------------------------------------------------------------------------
describe("PUT refuses a template the caller does NOT own (T2 / R1)", () => {
  it("a foreign / nonexistent templateId is rejected with 4xx and NEVER sets the selection", async () => {
    createClient.mockResolvedValue(templatesClient(USER));
    const res = await requirePut()(putRequest({ kind: "resume", templateId: "someone-elses-99" }));
    expect(res.status, "a foreign id must be refused, never silently activated").toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(setSelection, "a foreign id reached setSelection — the pointer would be set to bytes that resolve native").not.toHaveBeenCalled();
  });

  it("distinguishes refusal from acceptance: the OWNED id in the same fixture is accepted", async () => {
    // Pairs with the test above so "everything is refused" cannot pass as teeth.
    createClient.mockResolvedValue(templatesClient(USER));
    const ok = await requirePut()(putRequest({ kind: "resume", templateId: "owned-1" }));
    expect(ok.status).toBe(200);
    expect(setSelection).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// R3 — userId from the session, never the body. Kind + auth guards.
// ---------------------------------------------------------------------------
describe("PUT guards: session-scoped userId, kind, auth (T2 / R3)", () => {
  it("derives userId from getUser(), ignoring a user_id / userId in the body", async () => {
    createClient.mockResolvedValue(templatesClient(USER));
    await requirePut()(putRequest({ kind: "resume", templateId: "owned-1", user_id: "attacker-42", userId: "attacker-42" }));
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setSelection.mock.calls[0][1].userId).toBe("user-1");
    expect(setSelection.mock.calls[0][1].userId).not.toBe("attacker-42");
  });

  it("refuses kind='email' with 4xx and never reads ownership or sets a selection", async () => {
    createClient.mockResolvedValue(templatesClient(USER));
    const res = await requirePut()(putRequest({ kind: "email", templateId: "owned-1" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("refuses a missing templateId with 4xx and no selection", async () => {
    createClient.mockResolvedValue(templatesClient(USER));
    const res = await requirePut()(putRequest({ kind: "resume" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("returns 401 and sets NO selection when there is no session", async () => {
    createClient.mockResolvedValue(templatesClient(null));
    const res = await requirePut()(putRequest({ kind: "resume", templateId: "owned-1" }));
    expect(res.status).toBe(401);
    expect(setSelection).not.toHaveBeenCalled();
  });
});
