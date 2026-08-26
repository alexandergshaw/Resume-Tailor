import { describe, it, expect } from "vitest";
import { GoogleGenAI } from "@google/genai";
import { fetchLlmSearchPostings } from "@/lib/feed/llmSearch";
import { captureGeminiRequests, toolsOf } from "@/lib/llm/geminiWireProbe";

// AC-Y8. The AI job-search ingest source actually ASKS for Google Search on
// the wire.
//
// THE DEFECT THIS FILE EXISTS TO CATCH. `GenerateContentParameters` has
// exactly three properties — `model`, `contents`, `config` — and `tools`
// belongs to `GenerateContentConfig`. The SDK's parameter transformer reads
// only those three keys and silently discards everything else before building
// the request body, so a `tools` passed at the TOP LEVEL never reaches Google:
// no error, no warning.
//
// This module's own header states the rule the missing tool breaks: nothing
// the model says is trusted except a URL. `isGroundedHost` is the check, and
// with no tools there is no groundingMetadata, so it is false for every
// candidate and the ingest run yields zero postings per query — forever, on a
// schedule, paying for a grounded call each time. `llmSearch.test.js` calls
// this out in prose ("without the tool the model answers from training data")
// and then asserted it in the position the SDK drops.
//
// WHY THIS DRIVES THE REAL SDK. The sibling suite injects a FAKE client, which
// sees whatever object the caller hands it and cannot observe the layer that
// drops the key. Only the real transformer can catch this, so this file stubs
// `fetch` and reads the bytes. See `lib/llm/geminiWireProbe.js`.

const QUERY = {
  key: "k1",
  query: "remote react jobs",
  keywords: ["react"],
  excludedTitleKeywords: [],
  excludedCompanies: [],
};

const realClient = () => new GoogleGenAI({ apiKey: "test-key" });

describe("the ingest search asks for search on the wire (AC-Y8)", () => {
  it("puts googleSearch in the request body of its real Gemini call", async () => {
    const bodies = await captureGeminiRequests(() =>
      fetchLlmSearchPostings({
        query: QUERY,
        client: realClient(),
        model: "gemini-2.5-flash",
        fetchUrl: async () => ({}),
      }),
    );
    expect(bodies).toHaveLength(1);
    expect(toolsOf(bodies[0])).toEqual([{ googleSearch: {} }]);
  });

  it("does not force a JSON mime type alongside the search tool", async () => {
    // googleSearch is not combinable with response_mime_type on this model,
    // which is why `parsePostings` digs the JSON out of prose.
    const bodies = await captureGeminiRequests(() =>
      fetchLlmSearchPostings({
        query: QUERY,
        client: realClient(),
        model: "gemini-2.5-flash",
        fetchUrl: async () => ({}),
      }),
    );
    expect(bodies[0]?.generationConfig?.responseMimeType).toBeUndefined();
  });
});

describe("the top-level position is pinned as dropped (AC-Y8)", () => {
  it("proves the SDK discards a top-level tools key", async () => {
    // A standing negative control against the shape this call site used. If a
    // future SDK starts honouring the top-level key this goes red — the right
    // outcome: it means the rule changed and every comment about it is stale.
    const bodies = await captureGeminiRequests(() =>
      realClient().models.generateContent({
        model: "gemini-2.5-flash",
        contents: "hi",
        tools: [{ googleSearch: {} }],
        config: { systemInstruction: "sys" },
      }),
    );
    expect(toolsOf(bodies[0])).toBeUndefined();
  });
});
