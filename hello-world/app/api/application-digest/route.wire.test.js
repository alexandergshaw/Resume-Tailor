import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// AC-Y2. The tracking table's researched digest actually ASKS for Google
// Search on the wire.
//
// THE DEFECT THIS FILE EXISTS TO CATCH. `GenerateContentParameters` has
// exactly three properties — `model`, `contents`, `config` — and `tools`
// belongs to `GenerateContentConfig`. The SDK's parameter transformer reads
// only those three keys and silently discards everything else before building
// the request body, so a `tools` passed at the TOP LEVEL never reaches Google:
// no error, no warning.
//
// Downstream the failure is total and invisible: no tools -> no search -> no
// groundingMetadata -> `extractGroundingSources` returns [] -> the digest's
// citation reconciliation strips every link and stores a claim-only digest,
// while still paying for a full grounded call. It looks exactly like a model
// that found nothing.
//
// WHY THIS DRIVES THE REAL SDK. `route.test.js` asserts the request shape
// against an INJECTED FAKE client, which sees whatever object the route hands
// it and cannot observe the layer that drops the key — that assertion was
// green for months against a request that never carried `tools`. Only the real
// transformer can catch this, so this file stubs `fetch` and reads the bytes.
// See `lib/llm/geminiWireProbe.js`.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/supabase/applicationDigests", () => ({
  listDigests: vi.fn(),
  upsertDigest: vi.fn(),
}));

import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { getServerEnv } from "@/lib/config/env";
import { listDigests, upsertDigest } from "@/lib/supabase/applicationDigests";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";

const POSITION = {
  id: "p1",
  company: "Acme Robotics",
  title: "Senior Platform Engineer",
  location: "Remote (US)",
  description: "Own our Kubernetes estate.",
};

const request = () =>
  new Request("http://localhost/api/application-digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId: APP_ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: APP_ID, user_id: "user-1", positions: POSITION },
      error: null,
    }),
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: vi.fn(() => chain),
  });
  // wantsEmbedded reads process.env directly, not the mocked getServerEnv.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  listDigests.mockResolvedValue({ digests: {}, error: null });
  upsertDigest.mockImplementation(async (_s, _u, id, fields) => ({
    digest: { application_id: id, ...fields },
    error: null,
  }));
  // The REAL client. A fake here would reproduce exactly the blindness that
  // let the defect ship.
  getGeminiClient.mockReturnValue(new GoogleGenAI({ apiKey: "test-key" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the digest asks for search on the wire (AC-Y2)", () => {
  it("puts googleSearch in the request body of its real Gemini call", async () => {
    const bodies = await captureGeminiRequests(() => POST(request()), { text: "## What they do\n\nRobots." });
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toEqual([{ googleSearch: {} }]);
  });

  it("does not force a JSON mime type alongside the search tool", async () => {
    // googleSearch is not combinable with response_mime_type on this model,
    // which is why the digest is parsed defensively out of markdown prose.
    const bodies = await captureGeminiRequests(() => POST(request()), { text: "## What they do\n\nRobots." });
    expect(bodies[0]?.generationConfig?.responseMimeType).toBeUndefined();
  });
});

describe("the top-level position is pinned as dropped (AC-Y2)", () => {
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
