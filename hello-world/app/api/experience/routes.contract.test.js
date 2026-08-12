import { describe, it, expect, vi, beforeEach } from "vitest";

// Route-level contract for the Professional Experience knowledge base.
// Written before the routes exist. The subject here is the SECURITY surface of
// chunk 1 - who the row belongs to, and what a caller learns about rows that are
// not theirs - which a green unit-test run over lib/experience/tree.js says
// nothing about.
//
// The data layer is mocked so these assertions pin observable route behavior
// (status codes, and exactly what the route asks the store to do) rather than a
// Supabase query chain. lib/experience/tree.js is deliberately NOT mocked: the
// move route's rejection path is a real integration between the two.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({
  listPages: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  applyMoves: vi.fn(),
  deletePage: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import * as store from "@/lib/supabase/experiencePages";
import { GET, POST } from "./route.js";
import { PATCH, DELETE } from "./pages/[id]/route.js";
import { POST as MOVE } from "./move/route.js";

const T = "2026-08-01T00:00:00.000Z";

function signedIn(userId = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
}

function signedOut() {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  });
}

function jsonRequest(body, url = "http://localhost/api/experience") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id) => ({ params: Promise.resolve({ id }) });

function page(id, parentId, position, extra = {}) {
  return {
    id,
    user_id: "user-1",
    parent_id: parentId,
    title: extra.title ?? id.toUpperCase(),
    body: extra.body ?? "",
    position,
    archived_at: null,
    created_at: extra.created_at ?? T,
    updated_at: extra.updated_at ?? T,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authentication", () => {
  it("refuses every route without a session, and never reaches the data layer", async () => {
    signedOut();
    const responses = await Promise.all([
      GET(new Request("http://localhost/api/experience")),
      POST(jsonRequest({ title: "x" })),
      PATCH(jsonRequest({ title: "x" }), params("p1")),
      DELETE(new Request("http://localhost/api/experience/pages/p1", { method: "DELETE" }), params("p1")),
      MOVE(jsonRequest({ id: "p1", newParentId: null, newIndex: 0 })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    for (const fn of Object.values(store)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("serves the session user's own pages when there is a session", async () => {
    // Positive control for the test above: a dead route that 401s unconditionally
    // would pass that one and fail this one.
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("p1", null, 0)], error: null });
    const res = await GET(new Request("http://localhost/api/experience"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pages: [page("p1", null, 0)] });
    expect(store.listPages).toHaveBeenCalledWith(expect.anything(), "user-1");
  });
});

describe("POST /api/experience", () => {
  it("takes the owner from the session and ignores a user_id in the body", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [], error: null });
    store.createPage.mockResolvedValue({ page: page("new", null, 0), error: null });

    const res = await POST(jsonRequest({ title: "Migration", user_id: "someone-else" }));

    expect(res.status).toBe(200);
    expect(store.createPage).toHaveBeenCalledWith(expect.anything(), "user-1", {
      title: "Migration",
      parentId: null,
    });
    // The forged id must not reach the data layer under any argument.
    expect(JSON.stringify(store.createPage.mock.calls)).not.toContain("someone-else");
  });

  it("answers 404, not 403, for a parent the caller does not own", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("mine", null, 0)], error: null });

    const denied = await POST(jsonRequest({ title: "x", parent_id: "not-mine" }));
    expect(denied.status).toBe(404);
    expect(store.createPage).not.toHaveBeenCalled();

    // Positive control: the same call with a parent the caller does own goes
    // through, so 404 is a decision about ownership and not the only answer the
    // route knows how to give.
    store.createPage.mockResolvedValue({ page: page("new", "mine", 0), error: null });
    const allowed = await POST(jsonRequest({ title: "x", parent_id: "mine" }));
    expect(allowed.status).toBe(200);
    expect(store.createPage).toHaveBeenCalledWith(expect.anything(), "user-1", {
      title: "x",
      parentId: "mine",
    });
  });
});

describe("PATCH /api/experience/pages/[id]", () => {
  it("updates the caller's own page", async () => {
    signedIn("user-1");
    const updated = page("p1", null, 0, { body: "# notes", updated_at: "2026-08-12T00:00:00.000Z" });
    store.updatePage.mockResolvedValue({ page: updated, error: null });

    const res = await PATCH(jsonRequest({ title: "P1", body: "# notes" }), params("p1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ page: updated });
    expect(store.updatePage).toHaveBeenCalledWith(expect.anything(), "user-1", "p1", {
      title: "P1",
      body: "# notes",
    });
  });

  it("answers 404 when the page is not the caller's", async () => {
    signedIn("user-1");
    store.updatePage.mockResolvedValue({ page: null, error: null });
    const res = await PATCH(jsonRequest({ title: "x" }), params("someone-elses"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/experience/pages/[id]", () => {
  it("deletes the caller's own page and reports 404 when nothing was theirs to delete", async () => {
    signedIn("user-1");
    store.deletePage.mockResolvedValue({ deleted: 1, error: null });
    const ok = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), params("p1"));
    expect(ok.status).toBe(200);
    expect(store.deletePage).toHaveBeenCalledWith(expect.anything(), "user-1", "p1");

    store.deletePage.mockResolvedValue({ deleted: 0, error: null });
    const missing = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), params("nope"));
    expect(missing.status).toBe(404);
  });
});

describe("POST /api/experience/move", () => {
  const TREE = [page("a", null, 0), page("b", "a", 0), page("c", null, 1)];

  it("applies a legal move", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: TREE, error: null });
    store.applyMoves.mockResolvedValue({ pages: TREE, error: null });

    const res = await MOVE(jsonRequest({ id: "c", newParentId: "a", newIndex: 0 }));

    expect(res.status).toBe(200);
    expect(store.applyMoves).toHaveBeenCalledTimes(1);
    const [, userId, updates] = store.applyMoves.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(updates).toContainEqual({ id: "c", parent_id: "a", position: 0 });
  });

  it("refuses a body that omits the newParentId key instead of guessing the top level", async () => {
    // A dropped key silently relocating a page to the top level is the failure
    // mode this rule exists for. The tree layer treats undefined as null on
    // purpose; the route must not let a caller reach that by omission.
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: TREE, error: null });

    const res = await MOVE(jsonRequest({ id: "b", newIndex: 0 }));

    expect(res.status).toBe(400);
    expect(store.applyMoves).not.toHaveBeenCalled();
  });

  it("passes the tree's rejection through with its reason code", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: TREE, error: null });

    // a -> b would put a inside its own child.
    const res = await MOVE(jsonRequest({ id: "a", newParentId: "b", newIndex: 0 }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "cycle" });
    expect(store.applyMoves).not.toHaveBeenCalled();
  });

  it("will not move a page the caller does not own", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: TREE, error: null });

    const res = await MOVE(jsonRequest({ id: "not-in-my-tree", newParentId: null, newIndex: 0 }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "unknown-page" });
    expect(store.applyMoves).not.toHaveBeenCalled();
  });
});
