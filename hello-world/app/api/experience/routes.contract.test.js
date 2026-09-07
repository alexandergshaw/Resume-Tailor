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
// The knowledge routes' own edges. Additive: nothing above this line uses
// them, so the eleven cases that predate T1-T6 are unaffected.
vi.mock("@/lib/experience/knowledgeLoad", () => ({ loadScopeInput: vi.fn() }));
vi.mock("@/lib/supabase/experienceKnowledge", () => ({
  QUESTION_PAGE_SIZE: 50,
  getSummary: vi.fn(),
  upsertSummary: vi.fn(),
  listQuestions: vi.fn(),
  insertQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  clearQuestions: vi.fn(),
}));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import * as store from "@/lib/supabase/experiencePages";
import { loadScopeInput } from "@/lib/experience/knowledgeLoad";
import * as knowledgeStore from "@/lib/supabase/experienceKnowledge";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { GET, POST } from "./route.js";
import { PATCH, DELETE } from "./pages/[id]/route.js";
import { POST as MOVE } from "./move/route.js";
import { GET as KB_GET, POST as KB_POST } from "./knowledge/route.js";
import { POST as ASK_POST, DELETE as ASK_DELETE } from "./knowledge/question/route.js";

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

// ---------------------------------------------------------------------------
// T1-T6 — the same security surface, extended over the two knowledge routes.
//
// These live HERE rather than only in each route's own test file because the
// property being pinned is a property of the DIRECTORY: every route under
// /api/experience takes its owner from the session, answers 404 rather than
// 403 about rows that are not the caller's, and never puts a caller-supplied
// id or a model-supplied string into an error body. A per-route file can go
// green while a new sibling route quietly breaks the set.
// ---------------------------------------------------------------------------

const KB_TREE = [page("kb-root", null, 0, { body: "Real notes about the payments migration and what it cost." })];

function kbRequest(body, method = "POST") {
  return new Request("http://localhost/api/experience/knowledge", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function kbSignedIn(userId = "user-1") {
  signedIn(userId);
  loadScopeInput.mockResolvedValue({ pages: KB_TREE, pageRowCount: 1, truncatedRead: false, error: null });
  knowledgeStore.getSummary.mockResolvedValue({ summary: null, error: null });
  knowledgeStore.listQuestions.mockResolvedValue({ questions: [], hasMore: false, error: null });
  knowledgeStore.upsertSummary.mockImplementation(async (_c, _u, payload) => ({ summary: { id: "s1", ...payload }, error: null }));
  knowledgeStore.insertQuestion.mockImplementation(async (_c, _u, payload) => ({ question: { id: "q1", ...payload }, error: null }));
  knowledgeStore.deleteQuestion.mockResolvedValue({ ok: true, error: null });
  knowledgeStore.clearQuestions.mockResolvedValue({ cleared: 0, error: null });
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  const generateContent = vi.fn().mockResolvedValue({
    candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: '{"answer":"An overview."}' }] } }],
    text: '{"answer":"An overview."}',
  });
  getGeminiClient.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

describe("T1-T6 — knowledge routes share the directory's tenancy contract", () => {
  it("T1: takes the owner from the session and ignores a user_id in the body", async () => {
    kbSignedIn("user-1");
    await KB_POST(kbRequest({ scopePageId: null, engine: "gemini", user_id: "someone-else" }));
    await ASK_POST(kbRequest({ scopePageId: null, question: "What shipped?", engine: "gemini", user_id: "someone-else" }));
    await ASK_DELETE(kbRequest({ id: "q1", user_id: "someone-else" }, "DELETE"));

    for (const fn of [knowledgeStore.getSummary, knowledgeStore.upsertSummary, knowledgeStore.insertQuestion, knowledgeStore.deleteQuestion]) {
      expect(fn).toHaveBeenCalled();
      for (const call of fn.mock.calls) expect(call[1]).toBe("user-1");
      expect(JSON.stringify(fn.mock.calls)).not.toContain("someone-else");
    }
  });

  it("T2: answers 404, not 403, for a scope page the caller does not own", async () => {
    kbSignedIn("user-1");
    const summary = await KB_POST(kbRequest({ scopePageId: "not-mine", engine: "gemini" }));
    const ask = await ASK_POST(kbRequest({ scopePageId: "not-mine", question: "What shipped?", engine: "gemini" }));
    expect([summary.status, ask.status]).toEqual([404, 404]);
    expect(knowledgeStore.upsertSummary).not.toHaveBeenCalled();
    expect(knowledgeStore.insertQuestion).not.toHaveBeenCalled();

    // Positive control: the page the caller DOES own goes through, so 404 is a
    // decision about ownership rather than the only answer these routes give.
    const allowed = await KB_POST(kbRequest({ scopePageId: "kb-root", engine: "gemini" }));
    expect(allowed.status).toBe(200);
  });

  it("T3: passes the session user explicitly on every read and delete", async () => {
    // Asserted on the recorded call chain, never on returned rows: this repo's
    // own fake supabase does not filter on .eq(), so a tenancy test written
    // against returned data passes with the filter deleted.
    kbSignedIn("user-1");
    await KB_GET(new Request("http://localhost/api/experience/knowledge?scopePageId=kb-root"));
    await ASK_DELETE(kbRequest({ scopePageId: "kb-root", all: true }, "DELETE"));

    expect(knowledgeStore.getSummary).toHaveBeenCalledWith(expect.anything(), "user-1", "kb-root");
    expect(knowledgeStore.listQuestions).toHaveBeenCalledWith(expect.anything(), "user-1", "kb-root", expect.anything());
    expect(knowledgeStore.clearQuestions).toHaveBeenCalledWith(expect.anything(), "user-1", "kb-root");
  });

  it("T4: produces one case per status in the vocabulary — 401, 400, 404, 500, 502, 503", async () => {
    signedOut();
    expect((await KB_POST(kbRequest({ scopePageId: null, engine: "gemini" }))).status).toBe(401);

    kbSignedIn("user-1");
    const badJson = new Request("http://localhost/api/experience/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{oops",
    });
    expect((await KB_POST(badJson)).status).toBe(400);
    expect((await KB_POST(kbRequest({ scopePageId: "not-mine", engine: "gemini" }))).status).toBe(404);
    expect((await KB_POST(kbRequest({ scopePageId: null, engine: "embedded" }))).status).toBe(503);

    loadScopeInput.mockResolvedValue({ pages: [], pageRowCount: 0, truncatedRead: false, error: "boom" });
    expect((await KB_POST(kbRequest({ scopePageId: null, engine: "gemini" }))).status).toBe(500);

    loadScopeInput.mockResolvedValue({ pages: KB_TREE, pageRowCount: 1, truncatedRead: false, error: null });
    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("upstream")) },
    });
    expect((await KB_POST(kbRequest({ scopePageId: null, engine: "gemini" }))).status).toBe(502);
  });

  it("T5: no error body echoes a caller-supplied id or a model-supplied string", async () => {
    kbSignedIn("user-1");
    const notFoundBody = await (await KB_POST(kbRequest({ scopePageId: "CALLERSUPPLIEDID", engine: "gemini" }))).json();
    expect(JSON.stringify(notFoundBody)).not.toContain("CALLERSUPPLIEDID");

    getGeminiClient.mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error("MODELSUPPLIEDSTRING")) },
    });
    const failedBody = await (await KB_POST(kbRequest({ scopePageId: null, engine: "gemini" }))).json();
    expect(JSON.stringify(failedBody)).not.toContain("MODELSUPPLIEDSTRING");

    const askBody = await (
      await ASK_POST(kbRequest({ scopePageId: "CALLERSUPPLIEDID", question: "q?", engine: "gemini" }))
    ).json();
    expect(JSON.stringify(askBody)).not.toContain("CALLERSUPPLIEDID");
  });

  it("T6: the feature introduces no GET that writes", async () => {
    // The one request shape SameSite=Lax does not cover.
    const generateContent = kbSignedIn("user-1");
    const res = await KB_GET(new Request("http://localhost/api/experience/knowledge"));
    expect(res.status).toBe(200);
    expect(knowledgeStore.upsertSummary).not.toHaveBeenCalled();
    expect(knowledgeStore.insertQuestion).not.toHaveBeenCalled();
    expect(knowledgeStore.deleteQuestion).not.toHaveBeenCalled();
    expect(knowledgeStore.clearQuestions).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
    expect(loadScopeInput).not.toHaveBeenCalled();
  });
});
