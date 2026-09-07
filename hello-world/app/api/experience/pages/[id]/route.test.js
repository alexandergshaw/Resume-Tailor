import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// DELETE /api/experience/pages/[id] — the ONE server path every page delete
// goes through (a single delete from DeletePageDialog and each iteration of
// ExperienceTab's bulk delete both call it), and therefore the one place the
// half of the owner's purge ruling that no database can do has to live.
//
// supabase/migrations/20260906010000_experience_knowledge.sql's header names
// this file's job explicitly: the FK cascade covers the deleted page's own
// scope and its descendants; "application code — the page-delete path ... MUST
// separately purge every ANCESTOR scope's summary and question rows (walking
// up from the deleted page to the root, including the root scope itself)".
//
// The purge itself is unit-tested in lib/supabase/experienceKnowledgePurge.
// This file tests the WIRING and the ORDERING, which is where a correct purge
// module still ships as a no-op: read the tree BEFORE the delete (a breadcrumb
// cannot be computed from a page that is already gone), purge BEFORE the
// delete, and never let a purge failure swallow the delete or vice versa.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({
  listPages: vi.fn(),
  updatePage: vi.fn(),
  deletePage: vi.fn(),
}));
vi.mock("@/lib/supabase/experienceKnowledgePurge", () => ({ purgeAncestorScopes: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { listPages, deletePage } from "@/lib/supabase/experiencePages";
import { purgeAncestorScopes } from "@/lib/supabase/experienceKnowledgePurge";
import { DELETE } from "./route.js";

const USER_ID = "user-1";

function page(id, parentId, position = 0) {
  return {
    id,
    parent_id: parentId,
    user_id: USER_ID,
    title: `Title ${id}`,
    body: "",
    position,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const PAGES = [page("root", null), page("mid", "root"), page("leaf", "mid")];

// Records the order in which the collaborators were called, because the whole
// correctness argument here is an ordering one.
let order;

function signedIn(userId = USER_ID) {
  const supabase = { auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) } };
  createClient.mockResolvedValue(supabase);
  return supabase;
}

function params(id) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  order = [];
  listPages.mockImplementation(async () => {
    order.push("listPages");
    return { pages: PAGES, error: null };
  });
  purgeAncestorScopes.mockImplementation(async () => {
    order.push("purge");
    return { scopeKeys: ["mid", "root", "00000000-0000-0000-0000-000000000000"], summariesDeleted: 3, questionsDeleted: 7, error: null };
  });
  deletePage.mockImplementation(async () => {
    order.push("deletePage");
    return { deleted: true, error: null };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/experience/pages/[id] purges the ancestor scopes no cascade can reach", () => {
  it("[control] the happy path still deletes the page and returns ok", async () => {
    signedIn();
    const res = await DELETE(new Request("http://x/api/experience/pages/leaf", { method: "DELETE" }), params("leaf"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(deletePage).toHaveBeenCalledWith(expect.anything(), USER_ID, "leaf");
  });

  it("calls the ancestor purge at all - the assertion that goes red the day somebody concludes the FK cascade is enough", async () => {
    signedIn();
    await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));
    expect(purgeAncestorScopes).toHaveBeenCalledTimes(1);
  });

  it("hands the purge the page id and the PRE-DELETE page list, scoped to the caller's own user id", async () => {
    signedIn();
    await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));

    const [, userId, args] = purgeAncestorScopes.mock.calls[0];
    expect(userId).toBe(USER_ID);
    expect(args.pageId).toBe("leaf");
    expect(args.pages).toBe(PAGES);
  });

  it("reads the tree BEFORE the delete - after it, the deleted page is gone and its ancestors are unknowable", async () => {
    signedIn();
    await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));
    expect(order.indexOf("listPages")).toBeLessThan(order.indexOf("deletePage"));
  });

  it("purges BEFORE the delete, so a crash between the two leaves a regenerable gap rather than stale prose about a page that no longer exists", async () => {
    signedIn();
    await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));
    expect(order).toEqual(["listPages", "purge", "deletePage"]);
  });

  it("still deletes the page when the purge fails, and says so in the response rather than silently", async () => {
    // Refusing the delete would make a derived-data outage into "you cannot
    // delete your own content", which is a worse failure than the one it
    // prevents. Silence is the third option and the only unacceptable one.
    signedIn();
    purgeAncestorScopes.mockResolvedValue({ scopeKeys: [], summariesDeleted: 0, questionsDeleted: 0, error: "boom" });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));

    expect(deletePage).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.knowledgePurgeError).toContain("boom");
  });

  it("says nothing about the purge on the happy path - a field that is always there is a field nobody reads", async () => {
    signedIn();
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));
    expect(await res.json()).not.toHaveProperty("knowledgePurgeError");
  });

  it("still deletes the page when the tree read fails, and reports that too", async () => {
    signedIn();
    listPages.mockResolvedValue({ pages: null, error: "read failed" });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));

    expect(deletePage).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect((await res.json()).knowledgePurgeError).toContain("read failed");
  });

  it("does not purge when the caller is signed out - a 401 must not delete anything belonging to anyone", async () => {
    signedIn(null);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));

    expect(res.status).toBe(401);
    expect(purgeAncestorScopes).not.toHaveBeenCalled();
    expect(deletePage).not.toHaveBeenCalled();
  });

  it("500s on a failed delete and does not claim ok", async () => {
    signedIn();
    deletePage.mockResolvedValue({ deleted: false, error: "delete failed" });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params("leaf"));
    expect(res.status).toBe(500);
  });

  it("404s - never 403 - when the page is not the caller's own", async () => {
    signedIn();
    deletePage.mockResolvedValue({ deleted: false, error: null });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), params("someone-elses"));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("someone-elses");
  });
});
