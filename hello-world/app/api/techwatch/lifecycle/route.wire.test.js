import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// AC-Y7. The Tech Watch lifecycle top-up actually ASKS for Google Search on
// the wire.
//
// THE DEFECT THIS FILE EXISTS TO CATCH. `GenerateContentParameters` has
// exactly three properties — `model`, `contents`, `config` — and `tools`
// belongs to `GenerateContentConfig`. The SDK's parameter transformer reads
// only those three keys and silently discards everything else before building
// the request body, so a `tools` passed at the TOP LEVEL never reaches Google:
// no error, no warning.
//
// The consequence is exactly zero rows: `parseLifecycleAnswer` drops any row
// whose sourceUrl is not among the grounded hosts, and with no tools there is
// no groundingMetadata, so every row is dropped on every call — a panel that
// silently shows nothing while paying for a grounded search, and caches that
// emptiness against a global key for the full TTL. For support-window dates in
// particular, answering from training data would be worse than answering
// nothing, so the drop is right; the missing tool is the bug.
//
// WHY THIS DRIVES THE REAL SDK. `route.test.js` drives an INJECTED FAKE
// client, which sees whatever object the route hands it and cannot observe the
// layer that drops the key. Only the real transformer can catch this, so this
// file stubs `fetch` and reads the bytes. See `lib/llm/geminiWireProbe.js`.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/techwatch/cache", () => ({
  cached: vi.fn(async (_key, _ttl, producer) => producer()),
  __resetMemoryCache: vi.fn(),
}));

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { cached } from "@/lib/techwatch/cache";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const TECHNOLOGIES = [{ id: "typescript", label: "TypeScript" }];

const request = () =>
  new Request("http://localhost/api/techwatch/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ technologies: TECHNOLOGIES }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  });
  // wantsEmbedded reads process.env directly, not the mocked getServerEnv.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  cached.mockImplementation(async (_key, _ttl, producer) => producer());
  // The REAL client. A fake here would reproduce exactly the blindness that
  // let the defect ship.
  getGeminiClient.mockReturnValue(new GoogleGenAI({ apiKey: "test-key" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the lifecycle lookup asks for search on the wire (AC-Y7)", () => {
  it("puts googleSearch in the request body of its real Gemini call", async () => {
    const bodies = await captureGeminiRequests(() => POST(request()), { text: "[]" });
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toEqual([{ googleSearch: {} }]);
  });

  it("does not force a JSON mime type alongside the search tool", async () => {
    // googleSearch is not combinable with response_mime_type on this model,
    // which is why the rows are parsed defensively out of prose.
    const bodies = await captureGeminiRequests(() => POST(request()), { text: "[]" });
    expect(bodies[0]?.generationConfig?.responseMimeType).toBeUndefined();
  });
});

describe("the top-level position is pinned as dropped (AC-Y7)", () => {
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
