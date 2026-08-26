import { describe, it, expect, vi, beforeEach } from "vitest";

// Route-level contract for POST /api/experience/research (chunk 9). Mirrors
// app/api/experience/routes.contract.test.js's shape: the data + LLM layers
// are mocked, lib/experience/researchReport.js is NOT mocked (its own gate
// test — lib/experience/researchReport.test.js — already pins its pure
// behavior), so these assertions exercise the real wiring between "what
// Gemini returned" and "what the route actually persists and responds
// with", not a re-statement of a shape the route never produces.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({
  listPages: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
}));
vi.mock("@/lib/supabase/experienceAttachments", () => ({
  listAttachments: vi.fn(),
}));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import * as store from "@/lib/supabase/experiencePages";
import { listAttachments } from "@/lib/supabase/experienceAttachments";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { POST } from "./route.js";

const T = "2026-08-01T00:00:00.000Z";

function page(id, parentId, extra = {}) {
  return {
    id,
    user_id: "user-1",
    parent_id: parentId,
    title: extra.title ?? id.toUpperCase(),
    body: extra.body ?? "",
    position: extra.position ?? 0,
    archived_at: null,
    created_at: extra.created_at ?? T,
    updated_at: extra.updated_at ?? T,
  };
}

// A fake supabase client good for both getAuth() (auth.getUser) and the
// direct, identically-scoped `.from("experience_pages").update(...).eq...eq`
// call the route makes to set generated_kind/generated_at — the two columns
// updatePage's own fixed field list has no room for, and
// lib/supabase/experiencePages.js is outside this chunk's editable files.
function fakeSupabase(userId) {
  const eqEq = vi.fn().mockResolvedValue({ error: null });
  const eq1 = vi.fn(() => ({ eq: eqEq }));
  const update = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ update }));
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from,
    __update: update,
    __eq1: eq1,
    __eqEq: eqEq,
  };
}

function signedIn(userId = "user-1") {
  const supabase = fakeSupabase(userId);
  createClient.mockResolvedValue(supabase);
  return supabase;
}

function signedOut() {
  createClient.mockResolvedValue(fakeSupabase(null));
}

function jsonRequest(body) {
  return new Request("http://localhost/api/experience/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function geminiResponse({ text, chunks = [] }) {
  return {
    text,
    candidates: [{ groundingMetadata: { groundingChunks: chunks } }],
  };
}

function chunk(uri, title = "") {
  return { web: { uri, title } };
}

beforeEach(() => {
  vi.clearAllMocks();
  // wantsEmbedded (called by the route before touching the data layer)
  // reads process.env directly, not the mocked getServerEnv — without a key
  // present it would pick the embedded path for every test that does not
  // pass an explicit engine, exactly as app/api/company-research/route.test.js's
  // own comment explains. The "embedded engine" suite below passes
  // engine: "embedded" explicitly and is unaffected by this.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", geminiApiKey: "key" });
});

describe("authentication and input", () => {
  it("401s without a session and never reaches the data layer", async () => {
    signedOut();
    const res = await POST(jsonRequest({ pageId: "p1" }));
    expect(res.status).toBe(401);
    expect(store.listPages).not.toHaveBeenCalled();
  });

  it("400s when pageId is missing", async () => {
    signedIn();
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(store.listPages).not.toHaveBeenCalled();
  });

  it("400s on invalid JSON", async () => {
    signedIn();
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("404s for a page that is not the caller's own, never reaching Gemini", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("mine", null)], error: null });
    const res = await POST(jsonRequest({ pageId: "not-mine" }));
    expect(res.status).toBe(404);
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(store.createPage).not.toHaveBeenCalled();
  });
});

describe("the embedded engine", () => {
  it("refuses clearly and creates no page, without calling Gemini or the data layer's create/update", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("p1", null)], error: null });

    const res = await POST(jsonRequest({ pageId: "p1", engine: "embedded" }));
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error.toLowerCase()).toContain("gemini");
    expect(getGeminiClient).not.toHaveBeenCalled();
    expect(store.createPage).not.toHaveBeenCalled();
    expect(store.updatePage).not.toHaveBeenCalled();
  });
});

describe("happy path", () => {
  it("builds the prompt from title, body, breadcrumb, child titles and attachment name+notes (never bytes), then creates a titled child page", async () => {
    // The route stamps the report title with the REAL current date
    // (reportTitle(pageTitle, new Date()) in route.js, not this file's fixed
    // `T` fixture — that constant only ever seeds page.created_at/updated_at
    // above). A hardcoded "2026-08-12" here only ever matched by coincidence
    // on the day this test was written, and broke the instant the calendar
    // moved past it — a real, observed failure, not a hypothetical one.
    // Freezing the clock removes the dependency on which day the suite
    // happens to run entirely, rather than merely computing "today" a second
    // way that could still race the route's own `new Date()` across a
    // midnight boundary; the expected title is then derived with the exact
    // same `toISOString().slice(0, 10)` formula reportTitle uses, so this
    // still fails if the route's own formatting ever changes.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T15:00:00.000Z"));
    const expectedTitle = `Research: Payments migration (${new Date().toISOString().slice(0, 10)})`;

    const supabase = signedIn("user-1");
    const parent = page("parent", null, { title: "Payments migration", body: "# Notes\nLegacy processor." });
    const child = page("child", "parent", { title: "Rollout plan" });
    store.listPages.mockResolvedValue({ pages: [parent, child], error: null });
    listAttachments.mockResolvedValue({
      attachments: [{ name: "arch.png", notes: "current topology", storage_path: "u1/x", dataB64: "AAAA" }],
      error: null,
    });

    const generateContent = vi.fn().mockResolvedValue(
      geminiResponse({
        text: "Body only, no links.",
        chunks: [chunk("https://a.example/one", "One")],
      }),
    );
    getGeminiClient.mockReturnValue({ models: { generateContent } });

    store.createPage.mockResolvedValue({ page: page("report1", "parent", { title: expectedTitle }), error: null });
    store.updatePage.mockResolvedValue({ page: page("report1", "parent", { title: expectedTitle, body: "irrelevant" }), error: null });

    const res = await POST(jsonRequest({ pageId: "parent", engine: "gemini" }));
    const json = await res.json();
    vi.useRealTimers();

    expect(res.status).toBe(200);

    // The prompt actually sent to Gemini carries the material the route was
    // asked to gather - this is the wiring test; buildResearchPrompt's own
    // formatting rules are covered by lib/experience/researchReport.test.js.
    const sentPrompt = generateContent.mock.calls[0][0].contents;
    expect(sentPrompt).toContain("Payments migration");
    expect(sentPrompt).toContain("Legacy processor.");
    expect(sentPrompt).toContain("Rollout plan");
    expect(sentPrompt).toContain("arch.png");
    expect(sentPrompt).toContain("current topology");
    expect(sentPrompt).not.toContain("AAAA");
    expect(sentPrompt).not.toContain("u1/x");
    // `config.tools`, NOT the top level. This is an INJECTED FAKE client: it
    // sees whatever object the route hands it and cannot observe the SDK layer
    // that DISCARDS a top-level `tools`, so this line was green against a
    // request that never carried the key. The second assertion stops that
    // shape returning; route.wire.test.js proves it on the actual bytes.
    expect(generateContent.mock.calls[0][0].config?.tools).toEqual([{ googleSearch: {} }]);
    expect(generateContent.mock.calls[0][0].tools).toBeUndefined();

    // The report is created as a CHILD of the researched page, titled per
    // C9.4's exact format.
    expect(store.createPage).toHaveBeenCalledWith(expect.anything(), "user-1", {
      title: expectedTitle,
      parentId: "parent",
    });
    expect(store.updatePage).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "report1",
      expect.objectContaining({ body: expect.any(String) }),
    );

    // The two new columns are set via the direct, identically-scoped write
    // (updatePage's fixed field list has no room for them).
    expect(supabase.from).toHaveBeenCalledWith("experience_pages");
    expect(supabase.__update).toHaveBeenCalledWith(expect.objectContaining({ generated_kind: "research" }));
    expect(supabase.__eq1).toHaveBeenCalledWith("id", "report1");
    expect(supabase.__eqEq).toHaveBeenCalledWith("user_id", "user-1");

    expect(json.page).toBeTruthy();
  });

  it("drops a citation grounding never visited, keeping its text, and keeps one grounding did visit", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("p1", null)], error: null });
    listAttachments.mockResolvedValue({ attachments: [], error: null });

    const modelText =
      "Consider [Postgres logical replication](https://www.postgresql.org/docs/current/logical-replication.html) " +
      "and see [the 2026 benchmark](https://example.com/invented-benchmark) for numbers.";
    const generateContent = vi.fn().mockResolvedValue(
      geminiResponse({
        text: modelText,
        chunks: [chunk("https://www.postgresql.org/docs/current/logical-replication.html", "Logical Replication")],
      }),
    );
    getGeminiClient.mockReturnValue({ models: { generateContent } });

    store.createPage.mockResolvedValue({ page: page("report1", "p1"), error: null });
    let savedBody = "";
    store.updatePage.mockImplementation(async (_s, _u, _id, fields) => {
      savedBody = fields.body;
      return { page: page("report1", "p1", { body: fields.body }), error: null };
    });

    const res = await POST(jsonRequest({ pageId: "p1" }));
    expect(res.status).toBe(200);

    expect(savedBody).toContain("](https://www.postgresql.org/docs/current/logical-replication.html)");
    expect(savedBody).not.toContain("https://example.com/invented-benchmark");
    expect(savedBody).toContain("the 2026 benchmark");
  });

  it("marks the saved report ungrounded when grounding returned nothing, but still creates it", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("p1", null)], error: null });
    listAttachments.mockResolvedValue({ attachments: [], error: null });

    const generateContent = vi.fn().mockResolvedValue(geminiResponse({ text: "Use [this](https://example.com/x).", chunks: [] }));
    getGeminiClient.mockReturnValue({ models: { generateContent } });

    store.createPage.mockResolvedValue({ page: page("report1", "p1"), error: null });
    let savedBody = "";
    store.updatePage.mockImplementation(async (_s, _u, _id, fields) => {
      savedBody = fields.body;
      return { page: page("report1", "p1", { body: fields.body }), error: null };
    });

    const res = await POST(jsonRequest({ pageId: "p1" }));
    expect(res.status).toBe(200);
    expect(savedBody.toLowerCase()).toContain("not grounded");
    expect(savedBody).not.toContain("https://example.com/x");
    expect(store.createPage).toHaveBeenCalled();
  });
});

describe("failure honesty", () => {
  it("502s when Gemini's text comes back empty, and creates no page", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("p1", null)], error: null });
    listAttachments.mockResolvedValue({ attachments: [], error: null });
    getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn().mockResolvedValue(geminiResponse({ text: "" })) } });

    const res = await POST(jsonRequest({ pageId: "p1" }));
    expect(res.status).toBe(502);
    expect(store.createPage).not.toHaveBeenCalled();
  });

  it("502s when the Gemini call itself throws, and creates no page", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("p1", null)], error: null });
    listAttachments.mockResolvedValue({ attachments: [], error: null });
    getGeminiClient.mockReturnValue({ models: { generateContent: vi.fn().mockRejectedValue(new Error("boom")) } });

    const res = await POST(jsonRequest({ pageId: "p1" }));
    expect(res.status).toBe(502);
    expect(store.createPage).not.toHaveBeenCalled();
  });

  it("503s when Gemini is not configured", async () => {
    signedIn("user-1");
    store.listPages.mockResolvedValue({ pages: [page("p1", null)], error: null });
    listAttachments.mockResolvedValue({ attachments: [], error: null });
    getServerEnv.mockImplementation(() => {
      throw new Error("no key");
    });

    const res = await POST(jsonRequest({ pageId: "p1" }));
    expect(res.status).toBe(503);
    expect(store.createPage).not.toHaveBeenCalled();
  });
});
