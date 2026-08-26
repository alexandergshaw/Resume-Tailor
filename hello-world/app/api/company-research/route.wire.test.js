import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// AC-Y3. Both of this route's grounded calls actually ASK for their tool on
// the wire: `urlContext` on the blocked-scrape fallback, `googleSearch` on the
// company search.
//
// THE DEFECT THIS FILE EXISTS TO CATCH. `GenerateContentParameters` has
// exactly three properties — `model`, `contents`, `config` — and `tools`
// belongs to `GenerateContentConfig`. The SDK's parameter transformer reads
// only those three keys and silently discards everything else before building
// the request body, so a `tools` passed at the TOP LEVEL never reaches Google:
// no error, no warning.
//
// This route is the grounded-search precedent the rest of the repo was told to
// mirror, and both of its calls had the key in the dropped position. The
// consequences were the two halves of the same silent failure: the urlContext
// fallback asked a model with no fetcher to read a page it could not see (and
// answered from training data or not at all), and the search call produced no
// groundingMetadata, so `extractGroundingSources` returned [] and every
// response carried the "could not confirm these via live search" warning
// forever — while still paying for a full grounded call.
//
// WHY THIS DRIVES THE REAL SDK. `route.test.js` asserts the request shape
// against an INJECTED FAKE client, which sees whatever object the route hands
// it and cannot observe the layer that drops the key. Only the real
// transformer can catch this, so this file stubs `fetch` and reads the bytes.
// See `lib/llm/geminiWireProbe.js`.

vi.mock("@/lib/config/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/llm/geminiClient", () => ({ getGeminiClient: vi.fn() }));
vi.mock("@/lib/scrape/fetchUrlContent", () => ({ fetchUrlContent: vi.fn() }));
vi.mock("@/lib/scrape/webSearch", () => ({ searchPostingUrls: vi.fn(async () => []) }));

import { GoogleGenAI } from "@google/genai";
import { getServerEnv } from "@/lib/config/env";
import { getGeminiClient } from "@/lib/llm/geminiClient";
import { fetchUrlContent } from "@/lib/scrape/fetchUrlContent";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";
import { POST } from "./route.js";

const jsonRequest = (body) =>
  new Request("http://localhost/api/company-research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // wantsEmbedded reads process.env directly, not the mocked getServerEnv.
  vi.stubEnv("Gemini_LLM_API_Key", "test-key");
  getServerEnv.mockReturnValue({ geminiModel: "gemini-2.5-flash" });
  // The REAL client. A fake here would reproduce exactly the blindness that
  // let the defect ship.
  getGeminiClient.mockReturnValue(new GoogleGenAI({ apiKey: "test-key" }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the blocked-scrape fallback asks for urlContext on the wire (AC-Y3)", () => {
  it("puts urlContext in the request body when our own fetch was refused", async () => {
    fetchUrlContent.mockResolvedValue({ error: "Failed to fetch URL (status 403)." });
    const bodies = await captureGeminiRequests(() =>
      POST(jsonRequest({ url: "https://www.si.umich.edu/news/ai", company: "UMSI" })),
    );
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toEqual([{ urlContext: {} }]);
  });
});

describe("the company search asks for googleSearch on the wire (AC-Y3)", () => {
  it("puts googleSearch in the request body of its real Gemini call", async () => {
    const bodies = await captureGeminiRequests(() =>
      POST(jsonRequest({ company: "Acme", jobTitle: "Engineer" })),
    );
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toEqual([{ googleSearch: {} }]);
  });

  it("does not force a JSON mime type alongside the search tool", async () => {
    // googleSearch is not combinable with response_mime_type on this model,
    // which is why `parseArticles` digs the JSON out of prose.
    const bodies = await captureGeminiRequests(() =>
      POST(jsonRequest({ company: "Acme", jobTitle: "Engineer" })),
    );
    expect(bodies[0]?.generationConfig?.responseMimeType).toBeUndefined();
  });
});

describe("the top-level position is pinned as dropped (AC-Y3)", () => {
  it("proves the SDK discards a top-level tools key", async () => {
    // A standing negative control against the shape both call sites used. If a
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
