import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// AC-Y4. The Experience research report actually ASKS for Google Search on
// the wire.
//
// THE DEFECT THIS FILE EXISTS TO CATCH. `GenerateContentParameters` has
// exactly three properties — `model`, `contents`, `config` — and `tools`
// belongs to `GenerateContentConfig`. The SDK's parameter transformer reads
// only those three keys and silently discards everything else before building
// the request body, so a `tools` passed at the TOP LEVEL never reaches Google:
// no error, no warning.
//
// Downstream the failure is total and invisible here: no tools -> no search ->
// no groundingMetadata -> `reconcileCitations` has nothing to reconcile
// against and strips every link the model wrote, so a report whose entire
// premise is "current technologies, cited" is stored as uncited prose invented
// from training data — while still paying for a full grounded call.
//
// WHY THIS DRIVES THE REAL SDK. `route.test.js` asserts the request shape
// against an INJECTED FAKE client, which sees whatever object the route hands
// it and cannot observe the layer that drops the key. Only the real
// transformer can catch this, so this file stubs `fetch` and reads the bytes.
// See `lib/llm/geminiWireProbe.js`.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({
  listPages: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
}));
vi.mock("@/lib/supabase/experienceAttachments", () => ({ listAttachments: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import * as store from "@/lib/supabase/experiencePages";
import { listAttachments } from "@/lib/supabase/experienceAttachments";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const T = "2026-08-01T00:00:00.000Z";

function page(id, parentId, extra = {}) {
  return {
    id,
    user_id: "user-1",
    parent_id: parentId,
    title: extra.title ?? id.toUpperCase(),
    body: extra.body ?? "",
    position: 0,
    archived_at: null,
    created_at: T,
    updated_at: T,
  };
}

const jsonRequest = (body) =>
  new Request("http://localhost/api/experience/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  const eqEq = vi.fn().mockResolvedValue({ error: null });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(() => ({ update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: eqEq })) })) })),
  });
  // wantsEmbedded reads process.env directly, not the mocked getServerEnv.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash", geminiApiKey: "key" });
  store.listPages.mockResolvedValue({
    pages: [page("parent", null, { title: "Payments migration", body: "# Notes\nLegacy processor." })],
    error: null,
  });
  listAttachments.mockResolvedValue({ attachments: [], error: null });
  store.createPage.mockResolvedValue({ page: page("report1", "parent"), error: null });
  store.updatePage.mockResolvedValue({ page: page("report1", "parent"), error: null });
  // The REAL client. A fake here would reproduce exactly the blindness that
  // let the defect ship.
  getGeminiClient.mockReturnValue(new GoogleGenAI({ apiKey: "test-key" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the research report asks for search on the wire (AC-Y4)", () => {
  it("puts googleSearch in the request body of its real Gemini call", async () => {
    const bodies = await captureGeminiRequests(
      () => POST(jsonRequest({ pageId: "parent", engine: "gemini" })),
      { text: "## Findings\n\nSomething current." },
    );
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toEqual([{ googleSearch: {} }]);
  });

  it("does not force a JSON mime type alongside the search tool", async () => {
    // googleSearch is not combinable with response_mime_type on this model,
    // which is why the report is read back as markdown prose.
    const bodies = await captureGeminiRequests(
      () => POST(jsonRequest({ pageId: "parent", engine: "gemini" })),
      { text: "## Findings\n\nSomething current." },
    );
    expect(bodies[0]?.generationConfig?.responseMimeType).toBeUndefined();
  });
});

describe("the top-level position is pinned as dropped (AC-Y4)", () => {
  it("proves the SDK discards a top-level tools key", async () => {
    // A standing negative control against the shape this call site used. If a
    // future SDK starts honouring the top-level key this goes red — the right
    // outcome: it means the rule changed and every comment about it is stale.
    const bodies = await captureGeminiRequests(() =>
      new GoogleGenAI({ apiKey: "test-key" }).models.generateContent({
        model: "gemini-2.5-flash",
        contents: "hi",
        tools: [{ googleSearch: {} }],
        config: { systemInstruction: "sys" },
      }),
    );
    expect(toolsOf(bodies[0])).toBeUndefined();
  });
});
